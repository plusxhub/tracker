// The whole catalogue fits comfortably in memory, so every page renders from
// one snapshot that is refreshed at most once a minute. An edit made in
// Postgres is live within that window, with no rebuild.
import { db } from './db';
import { AVAILABILITY, isPlaceholder } from './labels';
import type { Artist, Catalogue, Credit, Entry, Era, Source, Track } from './types';

const TTL_MS = 60_000;
let cache: Catalogue | undefined;
let loading: Promise<Catalogue> | undefined;

export async function getCatalogue(): Promise<Catalogue> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache;
  loading ??= load()
    .then((c) => (cache = c))
    .catch((err) => {
      // Keep serving the last good snapshot if the database blips.
      if (cache) {
        console.error('catalogue refresh failed, serving stale data:', err.message);
        cache.loadedAt = Date.now() - TTL_MS / 2;
        return cache;
      }
      throw err;
    })
    .finally(() => (loading = undefined));
  return loading;
}

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
};

async function load(): Promise<Catalogue> {
  const sql = db();
  const [eraRows, trackRows, entryRows, creditRows, sourceRows, artistRows, timelineRows, glossaryRows] =
    await Promise.all([
      sql`select id, slug, name from eras order by sort`,
      sql`select id, slug, title, aka, released_as, notes, created_at from tracks`,
      sql`select id, track_id, title, version_label, kind, era_id, year, type, availability, evidence,
                 quality, status, variation, tags, notes, created_at
          from entries order by sort, id`,
      sql`select ea.entry_id, ea.role, ea.credited_as, ea.uncertain, a.slug, a.name
          from entry_artists ea join artists a on a.id = ea.artist_id
          order by ea.entry_id, ea.position`,
      sql`select entry_id, kind, label, url from sources where entry_id is not null order by entry_id, sort, id`,
      sql`select slug, name, aliases from artists`,
      sql`select year, kind, date_text, body from timeline_events where year is not null order by year, sort`,
      sql`select category, slug, term, definition from glossary order by sort, id`,
    ]);

  const eras = new Map<number, Era>(eraRows.map((e) => [e.id, { slug: e.slug, name: e.name }]));
  const credits = new Map<number, Credit[]>();
  for (const c of creditRows) {
    const list = credits.get(c.entry_id) ?? [];
    list.push({ slug: c.slug, name: c.name, role: c.role, creditedAs: c.credited_as, uncertain: c.uncertain });
    credits.set(c.entry_id, list);
  }
  const sources = new Map<number, Source[]>();
  for (const s of sourceRows) {
    const list = sources.get(s.entry_id) ?? [];
    list.push({ kind: s.kind, label: s.label, url: s.url, host: host(s.url) });
    sources.set(s.entry_id, list);
  }

  const entriesByTrack = new Map<number, Entry[]>();
  for (const e of entryRows) {
    const list = entriesByTrack.get(e.track_id) ?? [];
    list.push({
      id: e.id, title: e.title, versionLabel: e.version_label, kind: e.kind,
      era: eras.get(e.era_id) ?? null, year: e.year, type: e.type, availability: e.availability,
      evidence: e.evidence, quality: e.quality, status: e.status, variation: e.variation,
      tags: e.tags, notes: e.notes, credits: credits.get(e.id) ?? [], sources: sources.get(e.id) ?? [],
      createdAt: new Date(e.created_at).toISOString(),
    });
    entriesByTrack.set(e.track_id, list);
  }

  const tracks: Track[] = [];
  for (const t of trackRows) {
    const entries = entriesByTrack.get(t.id) ?? [];
    if (!entries.length) continue;
    const dated = entries.filter((e) => e.year != null);
    const first = dated[0] ?? entries[0]!;
    const best = entries.reduce((a, e) => (AVAILABILITY[e.availability].rank > AVAILABILITY[a].rank ? e.availability : a), 'none' as Track['best']);
    tracks.push({
      id: t.id, slug: t.slug, title: t.title, aka: t.aka, releasedAs: t.released_as, notes: t.notes,
      entries, year: first.year, era: first.era, credits: first.credits,
      tags: [...new Set(entries.flatMap((e) => e.tags))], best,
      placeholder: isPlaceholder(t.title),
      createdAt: new Date(t.created_at).toISOString(),
    });
  }
  // Chronological, undated last, stable by first entry id.
  tracks.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.entries[0]!.id - b.entries[0]!.id);

  const artistMap = new Map<string, Artist>(
    artistRows.map((a) => [a.slug, { slug: a.slug, name: a.name, aliases: a.aliases, trackSlugs: [], entryCount: 0 }]),
  );
  for (const t of tracks)
    for (const e of t.entries)
      for (const c of e.credits) {
        const a = artistMap.get(c.slug);
        if (!a) continue;
        a.entryCount++;
        if (!a.trackSlugs.includes(t.slug)) a.trackSlugs.push(t.slug);
      }
  const artists = [...artistMap.values()]
    .filter((a) => a.trackSlugs.length)
    .sort((a, b) => b.trackSlugs.length - a.trackSlugs.length || a.name.localeCompare(b.name));

  const allEntries = tracks.flatMap((t) => t.entries);
  const years = allEntries.map((e) => e.year).filter((y): y is number => y != null);
  const unreleased = tracks.filter((t) => t.entries.some((e) => e.kind === 'track'));

  return {
    tracks,
    bySlug: new Map(tracks.map((t) => [t.slug, t])),
    artists,
    artistBySlug: new Map(artists.map((a) => [a.slug, a])),
    eras: [...eras.values()],
    timeline: timelineRows.map((r) => ({ year: r.year, kind: r.kind, dateText: r.date_text, body: r.body })),
    glossary: glossaryRows.map((g) => ({ category: g.category, slug: g.slug, term: g.term, definition: g.definition })),
    stats: {
      tracks: tracks.length,
      entries: allEntries.length,
      full: unreleased.filter((t) => AVAILABILITY[t.best].rank >= AVAILABILITY.full.rank).length,
      unheard: unreleased.filter((t) => t.best === 'none').length,
      collaborators: artists.filter((a) => a.slug !== 'martin-garrix').length,
      firstYear: Math.min(...years),
      lastYear: Math.max(...years),
    },
    loadedAt: Date.now(),
  };
}
