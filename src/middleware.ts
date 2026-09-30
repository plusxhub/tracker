import { defineMiddleware } from 'astro:middleware';

// Pages render from a snapshot that is at most a minute old, so browsers and
// the CDN may hold them for the same minute.
export const onRequest = defineMiddleware(async (_context, next) => {
  const res = await next();
  const type = res.headers.get('content-type') ?? '';
  if (res.status === 200 && type.includes('text/html') && !res.headers.has('cache-control')) {
    res.headers.set('cache-control', 'public, max-age=60, stale-while-revalidate=300');
  }
  return res;
});
