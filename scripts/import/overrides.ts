import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { Role } from './names.ts';

export interface FixOverride {
  title?: string;
  version_label?: string | null;
  year?: number | null;
  era?: string;
  kind?: string;
  type?: string;
  availability?: string;
  evidence?: string | null;
  quality?: string | null;
  status?: string | null;
  notes?: string | null;
  tags?: string[];
  variation?: string | null;
  /** Replaces the parsed credits. `as` is the alias the credit appeared under. */
  artists?: { name: string; role: Role; as?: string; uncertain?: boolean }[];
}

export interface TrackOverride {
  title: string;
  /** Other names the song is known by; shown on the site and used for grouping. */
  aka?: string[];
  /** Extra titles used for grouping only. */
  match?: string[];
  released_as?: string;
  notes?: string;
  /** Row keys to pull in regardless of title. */
  rows?: string[];
}

export interface Overrides {
  /** Row keys whose citation links are forced public or private. File hosts stay private regardless. */
  links: { public_rows: string[]; private_rows: string[] };
  notes: { redact: { pattern: string; replace: string }[] };
  artists: {
    acts: string[];
    spellings: Record<string, string>;
    vocalists: string[];
    aliases: Record<string, string[]>;
  };
  skip: Record<string, string>;
  same_entry: Record<string, string>;
  distinct: string[];
  fix: Record<string, FixOverride>;
  tracks: TrackOverride[];
  glossary_extra: { category: string; slug: string; term: string; definition: string }[];
}

export function loadOverrides(path: string): Overrides {
  const raw = (parse(readFileSync(path, 'utf8')) ?? {}) as Partial<Overrides>;
  return {
    links: { public_rows: [], private_rows: [], ...raw.links },
    notes: { redact: [], ...raw.notes },
    artists: { acts: [], spellings: {}, vocalists: [], aliases: {}, ...raw.artists },
    skip: raw.skip ?? {},
    same_entry: raw.same_entry ?? {},
    distinct: raw.distinct ?? [],
    fix: raw.fix ?? {},
    tracks: raw.tracks ?? [],
    glossary_extra: raw.glossary_extra ?? [],
  };
}
