import type { APIRoute } from 'astro';
import { getCatalogue } from '../lib/catalogue';

export const GET: APIRoute = async ({ site }) => {
  const cat = await getCatalogue();
  const paths = [
    '/', '/tracks', '/timeline', '/artists', '/key', '/about',
    ...cat.tracks.map((t) => `/tracks/${t.slug}`),
    ...cat.artists.map((a) => `/artists/${a.slug}`),
  ];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${new URL(p, site)}</loc></url>`).join('\n') +
    `\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
