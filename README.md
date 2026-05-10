# ajaykandakatla.dev

Personal site + blog. Astro (SSG) on Vercel. Posts written from `ajay-admin` (private) and committed here.

## Stack

- **Astro 5** with MDX content collections
- **Tailwind** + `@tailwindcss/typography`
- **astro-seo**, `@astrojs/sitemap`, `@astrojs/rss`
- **Vercel** for hosting (via GitHub integration)

## Author flow

Posts get committed to `src/content/blog/*.mdx` from the admin portal. Push to `main` triggers:
1. Vercel rebuild → site live in ~30s.
2. `.github/workflows/syndicate.yml` → cross-posts to Medium / Dev.to / Substack (per the post's `crossPost` frontmatter), updates `.syndicated.json` ledger.

## Local dev

```bash
npm install
npm run dev          # http://localhost:4321
npm run build
npm run preview
```

## Required GitHub secrets (for syndication)

| Secret | Source |
|---|---|
| `MEDIUM_TOKEN` | medium.com/me/settings/security → Integration tokens |
| `DEVTO_API_KEY` | dev.to/settings/extensions → DEV API Keys |
| `SUBSTACK_PUBLISH_EMAIL` | Your Substack publication's "post by email" address |
| `SMTP_USER` / `SMTP_PASS` | Any SMTP account that can send the post (Gmail app password, Mailgun, etc.) |

If a secret is missing, the corresponding fan-out step is skipped — not failed.

## Frontmatter shape

```yaml
---
title: "Post title"
description: "One-sentence summary used for OG/Twitter/RSS/SEO"
publishedAt: 2026-05-10
updatedAt: 2026-05-12          # optional
tags: ["systems", "frontend"]
draft: false                   # set true to keep out of feed/sitemap
crossPost:
  medium: true
  substack: true
  devto: false
---
```
