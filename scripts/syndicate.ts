#!/usr/bin/env tsx
/**
 * Syndicates newly-added blog posts to Hashnode (GraphQL) and Dev.to (REST).
 * Substack has no public publishing API — handled separately by the GH Action's
 * send-mail step, which mails the rendered HTML to Substack's publish-by-email
 * address. Medium dropped here entirely: their integration token API no longer
 * issues new tokens. If you want Medium, do it manually or via Playwright.
 *
 * Idempotent via .syndicated.json ledger. Only posts whose slug is missing
 * from the ledger entry for a given target get re-published.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';

const SITE = process.env.SITE_URL ?? 'https://ajaykandakatla.dev';
const LEDGER_PATH = '.syndicated.json';
const BLOG_DIR = 'src/content/blog';

type SyndicationEntry = { hashnode?: string; substack?: string; devto?: string };
type Ledger = Record<string, SyndicationEntry>;

async function loadLedger(): Promise<Ledger> {
  try {
    return JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function saveLedger(ledger: Ledger): Promise<void> {
  await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
}

function getChangedPosts(): string[] {
  const before = process.env.GITHUB_BEFORE;
  const range = before && before !== '0000000000000000000000000000000000000000'
    ? `${before}..HEAD`
    : 'HEAD~1..HEAD';
  try {
    const diff = execSync(
      `git diff --name-only --diff-filter=AM ${range} -- ${BLOG_DIR}`,
      { encoding: 'utf8' },
    );
    return diff
      .split('\n')
      .map((s) => s.trim())
      .filter((f) => f.endsWith('.mdx') || f.endsWith('.md'));
  } catch (e) {
    console.warn('git diff failed, falling back to all posts:', (e as Error).message);
    return [];
  }
}

async function markdownToHtml(md: string): Promise<string> {
  const { unified } = await import('unified');
  const remarkParse = (await import('remark-parse')).default;
  const remarkRehype = (await import('remark-rehype')).default;
  const rehypeStringify = (await import('rehype-stringify')).default;
  const out = await unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(md);
  return String(out);
}

async function postToHashnode(args: {
  title: string;
  description: string;
  tags: string[];
  markdown: string;
  canonical: string;
  coverUrl?: string;
}): Promise<string> {
  const token = process.env.HASHNODE_TOKEN;
  const publicationId = process.env.HASHNODE_PUBLICATION_ID;
  if (!token) throw new Error('HASHNODE_TOKEN not set');
  if (!publicationId) throw new Error('HASHNODE_PUBLICATION_ID not set');

  const mutation = `
    mutation PublishPost($input: PublishPostInput!) {
      publishPost(input: $input) {
        post { id slug url }
      }
    }
  `;

  const body = args.markdown +
    `\n\n---\n\n*Originally published at [${args.canonical}](${args.canonical}).*`;

  const input: Record<string, unknown> = {
    title: args.title,
    contentMarkdown: body,
    publicationId,
    originalArticleURL: args.canonical,
    metaTags: { description: args.description },
    tags: args.tags
      .slice(0, 5)
      .map((t) => ({ name: t, slug: t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })),
  };
  if (args.coverUrl) {
    input.coverImageOptions = { coverImageURL: args.coverUrl };
  }

  const res = await fetch('https://gql.hashnode.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });
  const json = (await res.json()) as {
    data?: { publishPost?: { post?: { url?: string } } };
    errors?: Array<{ message: string }>;
  };
  if (!res.ok || json.errors || !json.data?.publishPost?.post?.url) {
    const msg = json.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`Hashnode publish failed: ${msg}`);
  }
  return json.data.publishPost.post.url;
}

async function postToDevto(args: {
  title: string;
  description: string;
  tags: string[];
  markdown: string;
  canonical: string;
  coverUrl?: string;
}): Promise<string> {
  const key = process.env.DEVTO_API_KEY;
  if (!key) throw new Error('DEVTO_API_KEY not set');

  const body =
    args.markdown +
    `\n\n---\n\n*Originally published at [${args.canonical}](${args.canonical}).*`;

  const article: Record<string, unknown> = {
    title: args.title,
    body_markdown: body,
    published: true,
    canonical_url: args.canonical,
    tags: args.tags.map((t) => t.replace(/[^a-z0-9]/gi, '').toLowerCase()).slice(0, 4),
    description: args.description,
  };
  if (args.coverUrl) {
    article.main_image = args.coverUrl;
  }

  const res = await fetch('https://dev.to/api/articles', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ article }),
  });
  const json = (await res.json()) as { url?: string };
  if (!res.ok || !json.url) {
    throw new Error(`Dev.to publish failed: ${JSON.stringify(json)}`);
  }
  return json.url;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main(): Promise<void> {
  const ledger = await loadLedger();
  const changed = getChangedPosts();
  console.log(`Found ${changed.length} changed post(s).`);
  if (changed.length === 0) return;

  for (const file of changed) {
    const raw = await fs.readFile(file, 'utf8');
    const { data, content } = matter(raw);
    if (data.draft) {
      console.log(`Skip draft: ${file}`);
      continue;
    }
    const slug = path.basename(file).replace(/\.(md|mdx)$/, '');
    const canonical = `${SITE}/blog/${slug}/`;
    const cross = data.crossPost ?? {};
    const entry: SyndicationEntry = ledger[slug] ?? {};
    const html = await markdownToHtml(content);

    if (cross.hashnode && !entry.hashnode) {
      try {
        entry.hashnode = await postToHashnode({
          title: data.title,
          description: data.description,
          tags: data.tags ?? [],
          markdown: content,
          canonical,
          coverUrl: data.coverUrl,
        });
        console.log(`✓ Hashnode: ${entry.hashnode}`);
      } catch (e) {
        console.error(`✗ Hashnode failed for ${slug}:`, (e as Error).message);
      }
    }

    if (cross.devto && !entry.devto) {
      try {
        entry.devto = await postToDevto({
          title: data.title,
          description: data.description,
          tags: data.tags ?? [],
          markdown: content,
          canonical,
          coverUrl: data.coverUrl,
        });
        console.log(`✓ Dev.to: ${entry.devto}`);
      } catch (e) {
        console.error(`✗ Dev.to failed for ${slug}:`, (e as Error).message);
      }
    }

    if (cross.substack && !entry.substack) {
      entry.substack = 'pending-email';
      const htmlPath = `.syndicate-out/${slug}.html`;
      await fs.mkdir('.syndicate-out', { recursive: true });
      await fs.writeFile(
        htmlPath,
        `<h1>${escapeHtml(data.title)}</h1>${html}<hr/><p><em>Originally published at <a href="${canonical}">${canonical}</a></em></p>`,
      );
      console.log(`✓ Substack queued for email: ${htmlPath}`);
    }

    ledger[slug] = entry;
  }

  await saveLedger(ledger);
  console.log('Ledger updated.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
