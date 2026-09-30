// Splits the sheets' packed name cells into artists, title, version label and
// credits. Sheet A writes "⭐Artist & Artist - Title (V2) [ Live ]\n( feat. X )";
// Sheet B keeps the title and the collaborators in separate columns.
import { squash, normKey } from './text.ts';

export type Role =
  | 'main'
  | 'feat'
  | 'prod'
  | 'with'
  | 'remixer'
  | 'original_artist'
  | 'vocalist'
  | 'unknown';

export interface Credit {
  name: string;
  role: Role;
  /** Set when the sheet hedged the credit, e.g. "Blinders(?". */
  uncertain?: boolean;
  /** Name the credit appeared under when it is an alias, e.g. "YTRAM". */
  creditedAs?: string;
}

export interface ParsedName {
  tags: string[];
  artists: Credit[];
  title: string;
  /** Parenthesised and bracketed qualifiers, in order, joined with " · ". */
  versionLabel: string | null;
  /** True when the row had no "Artist - Title" separator. */
  noSeparator: boolean;
}

const TAG_EMOJI: Record<string, string> = {
  '⭐': 'best_of',
  '🏆': 'grail',
  '🥇': 'wanted',
  '🗑': 'worst_of',
  '🤖': 'ai',
};

const CREDIT_PREFIX: [RegExp, Role][] = [
  [/^(?:featt?|ft)\.?\s+/i, 'feat'],
  [/^prod\.?\s+(?:by\s+)?/i, 'prod'],
  [/^with\s+/i, 'with'],
];

/** Qualifiers ending in "Remix" that describe the file, not who remixed it. */
const NOT_A_REMIXER = /^(instrumental|extended|vip|radio|club|original)$/i;

const PLACEHOLDER_TITLE = /^(id(\s*\d+)?|\?+|untitled\b.*|aviciicollab\d*)$/i;

export function isPlaceholderTitle(title: string): boolean {
  return PLACEHOLDER_TITLE.test(title.trim());
}

/**
 * Split "A, B & C / D and E" into names. `acts` lists names that contain a
 * separator themselves ("Matisse & Sadko") and must survive intact.
 */
export function splitArtists(list: string, acts: string[] = []): string[] {
  let s = squash(list);
  const held: string[] = [];
  for (const act of [...acts].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(escapeRe(act).replace(/\\?\s+/g, '\\s*'), 'gi');
    s = s.replace(re, () => {
      held.push(act);
      return `\u0000${held.length - 1}\u0000`;
    });
  }
  return s
    .split(/\s*,\s*|\s*&\s*|\s+\/\s+|\s+and\s+|\s+x\s+/i)
    .map((p) => p.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]!).trim())
    .filter(Boolean);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Pull every top-level (...) and [...] group out of a string. */
function extractGroups(s: string): { rest: string; groups: string[] } {
  const groups: string[] = [];
  let rest = '';
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') {
      if (depth === 0) cur = '';
      else cur += ch;
      depth++;
    } else if ((ch === ')' || ch === ']') && depth > 0) {
      depth--;
      if (depth === 0) groups.push(squash(cur));
      else cur += ch;
    } else if (depth > 0) cur += ch;
    else rest += ch;
  }
  if (depth > 0 && squash(cur)) groups.push(squash(cur)); // unclosed group
  return { rest: squash(rest), groups: groups.filter(Boolean) };
}

export interface TitleParts {
  title: string;
  labels: string[];
  credits: Credit[];
  remixers: string[];
}

/** Separate a title from its qualifiers and inline credits. */
export function parseTitle(raw: string, acts: string[] = []): TitleParts {
  const { rest, groups } = extractGroups(squash(raw));
  const labels: string[] = [];
  const credits: Credit[] = [];
  const remixers: string[] = [];

  for (const g of groups) {
    const credit = CREDIT_PREFIX.find(([re]) => re.test(g));
    if (credit) {
      const [re, role] = credit;
      for (const name of splitArtists(g.replace(re, ''), acts)) credits.push({ name, role });
      continue;
    }
    const remix = /^(.+?)\s+remix$/i.exec(g);
    if (remix && !NOT_A_REMIXER.test(remix[1]!)) {
      remixers.push(...splitArtists(remix[1]!, acts));
      continue;
    }
    labels.push(g);
  }
  return { title: rest, labels, credits, remixers };
}

/** Parse one of Sheet A's packed "Name" cells. */
export function parseName(raw: string, acts: string[] = []): ParsedName {
  let s = raw;
  const tags: string[] = [];
  for (;;) {
    s = s.replace(/^[\s️]+/, '');
    const hit = Object.keys(TAG_EMOJI).find((e) => s.startsWith(e));
    if (!hit) break;
    tags.push(TAG_EMOJI[hit]!);
    s = s.slice(hit.length);
  }
  s = squash(s);

  const sep = /\s+-\s+/.exec(s);
  const artistPart = sep ? s.slice(0, sep.index) : '';
  const titlePart = sep ? s.slice(sep.index + sep[0].length) : s;

  const { title, labels, credits, remixers } = parseTitle(titlePart, acts);
  const leads = splitArtists(artistPart, acts);

  const artists: Credit[] = [];
  if (remixers.length) {
    for (const name of leads) artists.push({ name, role: 'original_artist' });
    for (const name of remixers) artists.push({ name, role: 'remixer' });
  } else {
    for (const name of leads) artists.push({ name, role: 'main' });
  }
  artists.push(...credits);

  return {
    tags,
    artists: dedupeCredits(artists),
    title,
    versionLabel: labels.length ? labels.join(' · ') : null,
    noSeparator: !sep,
  };
}

/** Parse Sheet B's "Artist Feature" cell: names only, no roles. */
export function parseFeatureCell(raw: string, acts: string[] = []): Credit[] {
  const s = squash(raw);
  if (!s || /^(-|n\/d|nd|solo)$/i.test(s.replace(/\(\?$/, ''))) return [];
  return splitArtists(s, acts).map((part) => {
    const uncertain = /\(\?$/.test(part);
    return { name: part.replace(/\(\?$/, '').trim(), role: 'with' as Role, ...(uncertain && { uncertain }) };
  });
}

function dedupeCredits(list: Credit[]): Credit[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${normKey(c.name)}|${c.role}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
