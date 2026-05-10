#!/usr/bin/env tsx
/**
 * Syndicates newly-added blog posts to Medium / Dev.to.
 * Substack is handled separately by the GH Action's send-mail step
 * (Substack has no public publishing API, only publish-by-email).
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

type SyndicationEntry = { medium?: string; substack?: string; devto?: string };
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
  // GH Action sets GITHUB_BEFORE; locally we fall back to HEAD~1
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

async function postToMedium(args: {
  title: string;
  tags: string[];
  html: string;
  canonical: string;
}): Promise<string> {
  const token = process.env.MEDIUM_TOKEN;
  if (!token) throw new Error('MEDIUM_TOKEN not set');

  const userRes = await fetch('https://api.medium.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw new Error(`Medium /me failed: ${userRes.status} ${await userRes.text()}`);
  const userJson = (await userRes.json()) as { data: { id: string } };

  const content =
    `<h1>${escapeHtml(args.title)}</h1>` +
    args.html +
    `<hr/><p><em>Originally published at <a href="${args.canonical}">${args.canonical}</a></em></p>`;

  const res = await fetch(`https://api.medium.com/v1/users/${userJson.data.id}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: args.title,
      contentFormat: 'html',
      content,
      canonicalUrl: args.canonical,
      tags: args.tags.slice(0, 5),
      publishStatus: 'public',
    }),
  });
  const body = (await res.json()) as { data?: { url: string }; errors?: unknown };
  if (!res.ok || !body.data?.url) {
    throw new Error(`Medium publish failed: ${JSON.stringify(body)}`);
  }
  return body.data.url;
}

async function postToDevto(args: {
  title: string;
  description: string;
  tags: string[];
  markdown: string;
  canonical: string;
}): Promise<string> {
  const key = process.env.DEVTO_API_KEY;
  if (!key) throw new Error('DEVTO_API_KEY not set');

  const body =
    args.markdown +
    `\n\n---\n\n*Originally published at [${args.canonical}](${args.canonical}).*`;

  const res = await fetch('https://dev.to/api/articles', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      article: {
        title: args.title,
        body_markdown: body,
        published: true,
        canonical_url: args.canonical,
        tags: args.tags.map((t) => t.replace(/[^a-z0-9]/gi, '').toLowerCase()).slice(0, 4),
        description: args.description,
      },
    }),
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

    if (cross.medium && !entry.medium) {
      try {
        entry.medium = await postToMedium({
          title: data.title,
          tags: data.tags ?? [],
          html,
          canonical,
        });
        console.log(`✓ Medium: ${entry.medium}`);
      } catch (e) {
        console.error(`✗ Medium failed for ${slug}:`, (e as Error).message);
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
        });
        console.log(`✓ Dev.to: ${entry.devto}`);
      } catch (e) {
        console.error(`✗ Dev.to failed for ${slug}:`, (e as Error).message);
      }
    }

    // Substack handled by GH Action's email step. We just write a marker
    // so the action can pick up which files to mail and the ledger reflects intent.
    if (cross.substack && !entry.substack) {
      entry.substack = 'pending-email';
      // Drop a sidecar HTML file the action can attach/inline.
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
