// Slim, serialisable shapes handed to React: list rows and the browse island.
import { AVAILABILITY, byline, versionName } from './labels';
import type { Availability, Track } from './types';

export interface RowEntry {
  name: string;
  year: number | null;
  era: string | null;
  kind: string;
  type: string | null;
  availability: Availability;
  quality: string | null;
  evidence: string | null;
  tags: string[];
  artists: string[];
}

export interface RowTrack {
  slug: string;
  title: string;
  byline: string;
  year: number | null;
  era: string | null;
  best: Availability;
  tags: string[];
  released: boolean;
  stemsOnly: boolean;
  entries: RowEntry[];
  /** Lower-cased text the search box matches against. */
  haystack: string;
  addedAt: string;
}

export function toRow(t: Track): RowTrack {
  const first = t.entries[0]!;
  const title = t.placeholder && first.versionLabel ? `${t.title} · ${first.versionLabel}` : t.title;
  const entries: RowEntry[] = t.entries.map((e) => ({
    name: versionName(e, t.title),
    year: e.year,
    era: e.era?.slug ?? null,
    kind: e.kind,
    type: e.type,
    availability: e.availability,
    quality: e.quality,
    evidence: e.evidence,
    tags: e.tags,
    artists: e.credits.map((c) => c.slug),
  }));
  const names = new Set(t.entries.flatMap((e) => e.credits.flatMap((c) => [c.name, c.creditedAs ?? ''])));
  const haystack = [
    t.title, ...t.aka, t.releasedAs ?? '', ...names,
    ...t.entries.flatMap((e) => [e.title, e.versionLabel ?? '', e.notes ?? '', e.variation ?? '']),
  ]
    .join(' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return {
    slug: t.slug, title, byline: byline(t.credits), year: t.year, era: t.era?.slug ?? null,
    best: t.best, tags: t.tags, released: !!t.releasedAs,
    stemsOnly: t.entries.every((e) => e.kind !== 'track'),
    entries, haystack, addedAt: t.createdAt,
  };
}

export const bestOf = (list: Availability[]): Availability =>
  list.reduce((a, b) => (AVAILABILITY[b].rank > AVAILABILITY[a].rank ? b : a), 'none' as Availability);
