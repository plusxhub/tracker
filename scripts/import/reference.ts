// Reference data derived from Sheet A's header rows and Key tab.
import type { Overrides } from './overrides.ts';
import { eraForYear, mapEra, type EraSlug } from './normalize.ts';
import type { GlossaryRow, TimelineRow } from './rows.ts';
import { slugify, squash } from './text.ts';

export const ERAS: { slug: EraSlug; name: string; sort: number }[] = [
  { slug: 'spinnin', name: "Spinnin' Records", sort: 1 },
  { slug: 'pre-stmpd', name: 'Pre-STMPD', sort: 2 },
  { slug: 'stmpd', name: 'STMPD RCRDS', sort: 3 },
  { slug: 'unknown', name: 'Unknown era', sort: 4 },
];

export interface TimelineEvent {
  year: number;
  era: EraSlug;
  kind: 'event' | 'blurb';
  dateText: string | null;
  body: string;
}

/** "2012 (14 May 1996 ) Born in Amstelveen\n(9 April 2012) Itsa was released" -> events. */
export function parseTimeline(rows: TimelineRow[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const r of rows) {
    if (r.year == null) continue;
    const era = mapEra(r.era) ?? eraForYear(r.year);
    const rest = r.events.replace(/^\s*\d{4}(\.0)?/, '');
    for (const m of rest.matchAll(/\(([^)]*)\)\s*([^\n(]*)/g)) {
      const inside = squash(m[1]!);
      const after = squash(m[2]!);
      if (/\d{4}/.test(inside) && after) out.push({ year: r.year, era, kind: 'event', dateText: inside, body: after });
      else out.push({ year: r.year, era, kind: 'event', dateText: null, body: squash(`${inside} ${after}`) });
    }
    if (r.blurb) {
      let body = squash(
        r.blurb
          .replace(/\[\d+\]/g, '')
          .replace(/\[(?=[A-Z])/g, ' ') // opening bracket of a citation whose number was lost
          .replace(/\*/g, '')
          .replace(/\.(?=[A-Z])/g, '. '),
      );
      if (!/[.!?]$/.test(body)) body += '.';
      out.push({ year: r.year, era, kind: 'blurb', dateText: null, body });
    }
  }
  return out;
}

export interface GlossaryEntry {
  category: string;
  slug: string;
  term: string;
  definition: string;
}

const EVIDENCE = new Set(['confirmed', 'rumored', 'conflicting sources']);
const SLUG: Record<string, string> = {
  'og file': 'og_file', 'low quality': 'low', 'high quality': 'high', 'cd quality': 'cd',
  'ref track': 'ref_track', 'album track': 'album_track',
  '⭐': 'best_of', '🏆': 'grail', '🥇': 'wanted', '🗑️': 'worst_of', '🤖': 'ai',
};

/** Map the Key tab onto the site's vocabulary. The tab is a generic template, so clean it up. */
export function parseGlossary(rows: GlossaryRow[], ov: Overrides): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const r of rows) {
    const key = r.term.toLowerCase();
    if (/wu-tang/i.test(r.definition) || key === 'not available') continue;
    let category = r.heading.toLowerCase();
    let term = r.term;
    if (category === 'portion') category = EVIDENCE.has(key) ? 'evidence' : 'availability';
    else if (category === 'track tags') {
      const quoted = /^"([^"]+)"/.exec(r.definition);
      const emoji = !/[a-z?]/i.test(term);
      category = emoji ? 'tag' : 'credit';
      if (quoted) term = quoted[1]!;
      else if (/^\?+\.?$/.test(term)) continue;
    }
    const slug = SLUG[key] ?? slugify(term).replace(/-/g, '_');
    const definition = r.definition
      .replace(/\[Artist\]/g, 'Martin Garrix')
      .replace(/^"[^"]+",\s*/, '')
      .replace(/^./, (c) => c.toUpperCase());
    out.push({ category, slug, term, definition });
  }
  for (const g of ov.glossary_extra) {
    const at = out.findIndex((x) => x.category === g.category && x.slug === g.slug);
    if (at >= 0) out[at] = g;
    else out.push(g);
  }
  return out;
}
