import type { APIRoute } from 'astro';
import { getCatalogue } from '../../lib/catalogue';

/** The public catalogue as JSON: everything the site shows, nothing it does not. */
export const GET: APIRoute = async () => {
  const cat = await getCatalogue();
  const body = {
    generatedAt: new Date(cat.loadedAt).toISOString(),
    stats: cat.stats,
    eras: cat.eras,
    tracks: cat.tracks.map((t) => ({
      slug: t.slug,
      title: t.title,
      aka: t.aka,
      releasedAs: t.releasedAs,
      notes: t.notes,
      versions: t.entries.map((e) => ({
        title: e.title,
        versionLabel: e.versionLabel,
        kind: e.kind,
        era: e.era?.slug ?? null,
        year: e.year,
        type: e.type,
        availability: e.availability,
        evidence: e.evidence,
        quality: e.quality,
        status: e.status,
        variation: e.variation,
        tags: e.tags,
        notes: e.notes,
        credits: e.credits.map((c) => ({ artist: c.name, slug: c.slug, role: c.role, creditedAs: c.creditedAs, uncertain: c.uncertain })),
        sources: e.sources.map((s) => ({ kind: s.kind, label: s.label, url: s.url })),
      })),
    })),
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' },
  });
};
