import type { APIRoute } from 'astro';

const body = `User-agent: *
Allow: /

Sitemap: https://ajaykandakatla.dev/sitemap-index.xml
`;

export const GET: APIRoute = () =>
  new Response(body, { headers: { 'Content-Type': 'text/plain' } });
