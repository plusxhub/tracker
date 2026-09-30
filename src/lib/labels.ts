// Display vocabulary shared by Astro components and React islands.
import type { Availability, Credit, Role } from './types';

export const AVAILABILITY: Record<Availability, { label: string; short: string; rank: number }> = {
  og_file: { label: 'Original file', short: 'OG file', rank: 5 },
  full: { label: 'Full', short: 'Full', rank: 4 },
  partial: { label: 'Partial', short: 'Partial', rank: 3 },
  snippet: { label: 'Snippet', short: 'Snippet', rank: 2 },
  circulating: { label: 'Circulating', short: 'Circulating', rank: 1 },
  none: { label: 'Not circulating', short: 'Unheard', rank: 0 },
};

export const QUALITY: Record<string, string> = {
  lossless: 'Lossless',
  cd: 'CD quality',
  high: 'High quality',
  low: 'Low quality',
  abysmal: 'Abysmal',
  recording: 'Recording',
};

export const TYPE: Record<string, string> = {
  demo: 'Demo',
  ref_track: 'Ref track',
  og: 'OG',
  throwaway: 'Throwaway',
  production: 'Production',
  feature: 'Feature',
  remix: 'Remix',
  album_track: 'Album track',
  other: 'Other',
  unknown: 'Unknown type',
};

export const KIND: Record<string, string> = {
  track: 'Track',
  stems: 'Stems',
  instrumental: 'Instrumental',
  acapella: 'Acapella',
  session: 'Session',
  multitrack: 'Multitrack',
  tv_track: 'TV track',
};

export const STATUS: Record<string, string> = {
  unknown: 'Status unknown',
  cancelled: 'Cancelled',
  in_progress: 'In the works',
  released: 'Released',
};

export const EVIDENCE: Record<string, string> = {
  confirmed: 'Confirmed to exist',
  rumored: 'Rumoured',
};

export const TAG: Record<string, string> = {
  grail: 'Grail',
  best_of: 'Best of',
  wanted: 'Wanted',
};

const ROLE_PREFIX: Partial<Record<Role, string>> = {
  feat: 'feat.',
  prod: 'prod.',
  with: 'with',
  remixer: 'remix by',
  vocalist: 'vocals by',
};

const list = (names: string[]) =>
  names.length <= 2 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;

const shown = (c: Credit) => `${c.creditedAs ?? c.name}${c.uncertain ? ' (?)' : ''}`;

/** "Martin Garrix & Avicii · feat. Simon Aldred" */
export function byline(credits: Credit[]): string {
  const lead = credits.filter((c) => c.role === 'main' || c.role === 'original_artist' || c.role === 'unknown');
  const parts = lead.length ? [list(lead.map(shown))] : [];
  for (const role of ['remixer', 'feat', 'vocalist', 'prod', 'with'] as Role[]) {
    const group = credits.filter((c) => c.role === role);
    if (group.length) parts.push(`${ROLE_PREFIX[role]} ${list(group.map(shown))}`);
  }
  return parts.join(' · ');
}

/** Grouped credits for rendering with links. */
export function creditGroups(credits: Credit[]): { prefix: string | null; credits: Credit[] }[] {
  const out: { prefix: string | null; credits: Credit[] }[] = [];
  const lead = credits.filter((c) => c.role === 'main' || c.role === 'original_artist' || c.role === 'unknown');
  if (lead.length) out.push({ prefix: null, credits: lead });
  for (const role of ['remixer', 'feat', 'vocalist', 'prod', 'with'] as Role[]) {
    const group = credits.filter((c) => c.role === role);
    if (group.length) out.push({ prefix: ROLE_PREFIX[role]!, credits: group });
  }
  return out;
}

const PLACEHOLDER = /^(id(\s*\d+)?|\?+|untitled\b.*|aviciicollab\d*)$/i;
export const isPlaceholder = (title: string) => PLACEHOLDER.test(title.trim());

/** What to call one version of a song in a list. */
export function versionName(e: { title: string; versionLabel: string | null; kind: string }, trackTitle: string): string {
  const own = e.title.toLowerCase() !== trackTitle.toLowerCase() ? e.title : null;
  const parts = [own, e.versionLabel].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return e.kind !== 'track' ? KIND[e.kind] ?? e.kind : 'Untitled version';
}
