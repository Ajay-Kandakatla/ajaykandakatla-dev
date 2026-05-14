#!/usr/bin/env node
/**
 * One-shot: replace every Pollinations coverUrl with a Draw Things-generated
 * cover committed to public/covers/. Run from the repo root with Draw Things
 * running on the host:
 *
 *   node scripts/regenerate-covers.mjs
 *
 * For each src/content/blog/*.mdx whose coverUrl points at pollinations.ai:
 *   1. Reads coverAlt (the visual prompt) from frontmatter.
 *   2. POSTs to Draw Things' /sdapi/v1/txt2img — FLUX schnell, 1200x630, 4 steps.
 *   3. Writes the PNG to public/covers/<sha256-12>.png.
 *   4. Rewrites the post's coverUrl line to a raw.githubusercontent URL.
 *
 * Then commit + push (the script prints the next-step command).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DRAW_THINGS_URL = process.env.DRAW_THINGS_URL ?? 'http://localhost:7860';
const BLOG_DIR = 'src/content/blog';
const COVERS_DIR = 'public/covers';
const REPO_OWNER = process.env.GITHUB_OWNER ?? 'Ajay-Kandakatla';
const REPO_NAME = process.env.GITHUB_REPO ?? 'ajaykandakatla-dev';
const REPO_BRANCH = process.env.GITHUB_BRANCH ?? 'main';

async function generateImage(prompt) {
  const res = await fetch(`${DRAW_THINGS_URL}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      negative_prompt: 'text, words, letters, watermark, signature, low quality, blurry',
      width: 1200,
      height: 630,
      steps: 4,
      sampler_index: 'Euler a',
      cfg_scale: 1.0,
      seed: -1,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`Draw Things ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const json = await res.json();
  const b64 = json.images?.[0];
  if (!b64) throw new Error('Draw Things returned no image');
  const stripped = b64.startsWith('data:') ? b64.slice(b64.indexOf(',') + 1) : b64;
  return Buffer.from(stripped, 'base64');
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const get = (key) => {
    const re = new RegExp(`^${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'm');
    return fm.match(re)?.[1];
  };
  return {
    title: get('title'),
    coverUrl: get('coverUrl'),
    coverAlt: get('coverAlt'),
  };
}

async function main() {
  await fs.mkdir(COVERS_DIR, { recursive: true });
  const files = (await fs.readdir(BLOG_DIR)).filter((f) => f.endsWith('.mdx'));
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const f of files) {
    const fp = path.join(BLOG_DIR, f);
    let content = await fs.readFile(fp, 'utf8');

    if (!content.includes('pollinations.ai')) {
      console.log(`✓ ${f} — non-Pollinations cover, skip`);
      skipped++;
      continue;
    }

    const fm = extractFrontmatter(content);
    if (!fm) {
      console.warn(`! ${f} — no frontmatter found, skip`);
      skipped++;
      continue;
    }

    const prompt = fm.coverAlt
      ?? `Abstract evocative cover for blog post titled "${fm.title}", cinematic, moody, 35mm`;

    console.log(`→ ${f}`);
    console.log(`   prompt: ${prompt.slice(0, 90)}${prompt.length > 90 ? '…' : ''}`);

    try {
      const bytes = await generateImage(prompt);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      const coverPath = path.join(COVERS_DIR, `${hash}.png`);
      await fs.writeFile(coverPath, bytes);

      const newUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/public/covers/${hash}.png`;
      // Match the coverUrl line containing pollinations.ai and replace the URL only
      content = content.replace(
        /^(coverUrl:\s*")[^"]*pollinations\.ai[^"]*(")/m,
        `$1${newUrl}$2`,
      );
      await fs.writeFile(fp, content);

      console.log(`✓ ${f} → public/covers/${hash}.png (${(bytes.length / 1024).toFixed(0)} KB)`);
      updated++;
    } catch (e) {
      console.error(`✗ ${f} failed: ${e.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`Done. ${updated} regenerated, ${skipped} skipped, ${failed} failed.`);
  if (updated > 0) {
    console.log('');
    console.log('Next: review the changes, then');
    console.log(`  git add public/covers ${BLOG_DIR}`);
    console.log('  git commit -m "fix: regenerate covers via Draw Things"');
    console.log('  git push');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
