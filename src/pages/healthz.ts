import type { APIRoute } from 'astro';
import { getCatalogue } from '../lib/catalogue';

export const GET: APIRoute = async () => {
  try {
    const cat = await getCatalogue();
    return Response.json({ ok: true, tracks: cat.stats.tracks, ageSeconds: Math.round((Date.now() - cat.loadedAt) / 1000) });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
};
