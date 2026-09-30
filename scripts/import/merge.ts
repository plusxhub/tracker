// Folds the two sheets into one catalogue: B rows that document a recording
// Sheet A already lists are attached to it, the rest become entries of their
// own, and entries are grouped into songs. Anything the sheets leave ambiguous
// is decided in data/overrides.yaml, not guessed here.
import type { Credit } from './names.ts';
import type { Availability, Draft, DraftFile, DraftSource, EraSlug, Kind } from './normalize.ts';
import type { FixOverride, Overrides, TrackOverride } from './overrides.ts';
import type { RawRow } from './rows.ts';
import { normKey, slugify } from './text.ts';

export interface Conflict {
  field: string;
  a: string;
  b: string;
  chosen: string;
}

export interface EntryOut {
  /** Sheet rows backing this entry; the first is the primary. */
  rows: RawRow[];
  title: string;
  labels: string[];
  versionLabel: string | null;
  placeholder: boolean;
  kind: Kind;
  era: EraSlug | null;
  year: number | null;
  type: string | null;
  availability: Availability;
  evidence: 'confirmed' | 'rumored' | null;
  quality: string | null;
  status: string | null;
  variation: string | null;
  tags: string[];
  notes: string | null;
  artists: Credit[];
  sources: DraftSource[];
  files: (DraftFile & { rowKey: string })[];
  conflicts: Conflict[];
  flags: string[];
  sort: number;
}

export interface TrackOut {
  slug: string;
  title: string;
  aka: string[];
  releasedAs: string | null;
  notes: string | null;
  curated: boolean;
  entries: EntryOut[];
}

export interface MatchRecord {
  b: string;
  a: string;
  how: 'auto' | 'override';
}

export interface MergeResult {
  tracks: TrackOut[];
  skipped: { key: string; reason: string }[];
  matches: MatchRecord[];
  /** B rows that share a title with an A row but could not be matched safely. */
  undecided: { b: string; candidates: string[] }[];
  /** Override keys that no longer exist in the sheets, and similar. */
  problems: string[];
}

const GARRIX = normKey('Martin Garrix');
const TAB_ORDER: Record<string, number> = { 'a.unreleased': 0, 'b.unreleased': 1, 'b.demos': 2, 'a.stems': 3 };

/** Variation values that describe a change rather than name a version. */
const GENERIC_VARIATION = /^(reworked|few changes|other singer|piano variation|changes in .*?)\s*(\(\?)?$/i;

const KIND_LABEL: Partial<Record<Kind, RegExp>> = {
  instrumental: /^instrumental$/i,
  acapella: /^acapella$/i,
};

function collaborators(artists: Credit[]): Set<string> {
  return new Set(artists.map((c) => normKey(c.name)).filter((n) => n !== GARRIX));
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

function applyFix(d: Draft, fix: FixOverride): void {
  if (fix.title !== undefined) d.title = fix.title;
  if (fix.version_label !== undefined) d.labels = fix.version_label ? fix.version_label.split(' · ') : [];
  if (fix.year !== undefined) d.year = fix.year;
  if (fix.era !== undefined) d.era = fix.era as EraSlug;
  if (fix.kind !== undefined) d.kind = fix.kind as Kind;
  if (fix.type !== undefined) d.type = fix.type;
  if (fix.availability !== undefined) d.availability = fix.availability as Availability;
  if (fix.evidence !== undefined) d.evidence = fix.evidence as Draft['evidence'];
  if (fix.quality !== undefined) d.quality = fix.quality;
  if (fix.status !== undefined) d.status = fix.status;
  if (fix.notes !== undefined) d.notes = fix.notes;
  if (fix.tags !== undefined) d.tags = fix.tags;
  if (fix.variation !== undefined) d.variation = fix.variation;
  if (fix.artists !== undefined)
    d.artists = fix.artists.map((a) => ({
      name: a.name,
      role: a.role,
      ...(a.as && { creditedAs: a.as }),
      ...(a.uncertain && { uncertain: true }),
    }));
  d.flags = d.flags.filter((f) => !/separator|no title/.test(f));
}

function toEntry(d: Draft): EntryOut {
  return {
    rows: [d.row], title: d.title, labels: [...d.labels], versionLabel: null,
    placeholder: d.placeholder, kind: d.kind, era: d.era, year: d.year, type: d.type,
    availability: d.availability, evidence: d.evidence, quality: d.quality, status: d.status,
    variation: d.variation, tags: [...d.tags], notes: d.notes, artists: [...d.artists],
    sources: [...d.sources], files: d.files.map((f) => ({ ...f, rowKey: d.row.key })),
    conflicts: [], flags: [...d.flags], sort: 0,
  };
}

/** Attach a Sheet B row to an entry that already exists. Sheet A's wording wins. */
function absorb(e: EntryOut, b: Draft): void {
  e.rows.push(b.row);
  if (!e.status) e.status = b.status;
  if (!e.variation) e.variation = b.variation;
  const usedNote = !e.notes && !!b.notes;
  if (usedNote) e.notes = b.notes;
  if (!e.artists.length) e.artists = [...b.artists];
  for (const s of b.sources) if (!e.sources.some((x) => x.url === s.url)) e.sources.push(s);
  for (const f of b.files)
    if (!e.files.some((x) => x.url === f.url)) e.files.push({ ...f, rowKey: b.row.key });
  for (const f of b.flags) {
    // Flags about B's own title or note only matter if that text ended up on the entry.
    if (/no title/.test(f) || (/^note /.test(f) && !usedNote)) continue;
    if (!e.flags.includes(f)) e.flags.push(f);
  }

  if (e.year != null && b.year != null && e.year !== b.year)
    e.conflicts.push({ field: 'year', a: String(e.year), b: String(b.year), chosen: String(e.year) });
  if (e.year == null && b.year != null) {
    e.year = b.year;
    if (e.era === 'unknown' || e.era == null) e.era = b.era;
  }
  if (e.availability === 'none' && b.files.length) {
    e.conflicts.push({ field: 'availability', a: 'none', b: 'has a file', chosen: 'circulating' });
    e.availability = 'circulating';
  }
}

function tidyVariation(v: string): string {
  const s = v.replace(/\s+/g, ' ').trim();
  if (/\(\?$/.test(s)) return `${tidyVariation(s.replace(/\(\?$/, ''))} (unconfirmed)`;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function finaliseEntry(e: EntryOut, track: { title: string; aka: string[]; match: string[] }): void {
  // Titles that only differ in case, or that exist purely for grouping, take the song's title.
  const own = new Set([track.title, ...track.match].map(normKey));
  if (own.has(normKey(e.title))) e.title = track.title;

  const names = new Set([track.title, ...track.aka, ...track.match].map(normKey));
  const kindRe = KIND_LABEL[e.kind];
  let labels = e.labels.filter((l) => {
    if (names.has(normKey(l))) return false; // "(Carousel)" when Carousel is an aka
    if (/^id$/i.test(l)) return false;
    if (kindRe?.test(l)) return false; // "(Instrumental)" on an instrumental
    return true;
  });
  // Sheet B's Variation column sometimes names the version ("V2 (Tomorrowland)").
  if (e.variation && !GENERIC_VARIATION.test(e.variation)) {
    if (!labels.length) labels = [e.variation.replace(/\s+/g, ' ').trim()];
    e.variation = null;
  }
  if (e.variation) e.variation = tidyVariation(e.variation);
  e.labels = labels;
  e.versionLabel = labels.length ? labels.join(' · ') : null;
}

export function merge(drafts: Draft[], ov: Overrides): MergeResult {
  const problems: string[] = [];
  const byKey = new Map(drafts.map((d) => [d.row.key, d]));
  const known = (key: string, where: string) => {
    if (!byKey.has(key)) problems.push(`${where}: no row with key ${key}`);
    return byKey.has(key);
  };

  for (const [key, fix] of Object.entries(ov.fix)) if (known(key, 'fix')) applyFix(byKey.get(key)!, fix);

  const skipped: MergeResult['skipped'] = [];
  for (const [key, reason] of Object.entries(ov.skip)) if (known(key, 'skip')) skipped.push({ key, reason });
  const skip = new Set(Object.keys(ov.skip));
  const live = drafts.filter((d) => !skip.has(d.row.key));

  // Sheet A rows each become an entry.
  const entries: EntryOut[] = [];
  const entryOf = new Map<string, EntryOut>();
  for (const d of live.filter((x) => x.row.tab.startsWith('a.'))) {
    const e = toEntry(d);
    entries.push(e);
    entryOf.set(d.row.key, e);
  }

  const matches: MatchRecord[] = [];
  const undecided: MergeResult['undecided'] = [];
  const distinct = new Set(ov.distinct);
  for (const k of ov.distinct) known(k, 'distinct');
  const aUnreleased = live.filter((x) => x.row.tab === 'a.unreleased');

  const bRows = live.filter((x) => x.row.tab.startsWith('b.'));
  const pending: Draft[] = [];
  for (const b of bRows) {
    const forced = ov.same_entry[b.row.key];
    if (forced) {
      if (known(forced, `same_entry[${b.row.key}]`)) pending.push(b);
      continue;
    }
    if (distinct.has(b.row.key)) {
      const e = toEntry(b);
      entries.push(e);
      entryOf.set(b.row.key, e);
      continue;
    }
    const bCollab = collaborators(b.artists);
    const sameTitle = aUnreleased.filter((a) => normKey(a.title) === normKey(b.title));
    const safe = sameTitle.filter((a) => {
      const aCollab = collaborators(a.artists);
      if (b.placeholder) {
        return b.year != null && a.year === b.year && bCollab.size > 0 && sameSet(aCollab, bCollab) &&
          normKey(a.labels.join(' ')) === normKey(b.labels.join(' '));
      }
      const subset = [...bCollab].every((x) => aCollab.has(x));
      const labelsOk = !b.labels.length || normKey(a.labels.join(' ')) === normKey(b.labels.join(' '));
      return subset && labelsOk;
    });
    if (safe.length === 1 && (b.placeholder || sameTitle.length === 1)) {
      absorb(entryOf.get(safe[0]!.row.key)!, b);
      matches.push({ b: b.row.key, a: safe[0]!.row.key, how: 'auto' });
      continue;
    }
    if (sameTitle.length && !b.placeholder)
      undecided.push({ b: b.row.key, candidates: sameTitle.map((a) => a.row.key) });
    const e = toEntry(b);
    entries.push(e);
    entryOf.set(b.row.key, e);
  }
  // Forced matches last, so a B row can point at another B row's entry.
  for (const b of pending) {
    const target = ov.same_entry[b.row.key]!;
    const e = entryOf.get(target);
    if (!e) {
      problems.push(`same_entry[${b.row.key}]: target ${target} is skipped or itself merged`);
      continue;
    }
    absorb(e, b);
    entryOf.set(b.row.key, e);
    matches.push({ b: b.row.key, a: target, how: 'override' });
  }

  // Group entries into songs: curated tracks first, then by title.
  const curated: { def: TrackOverride; names: Set<string>; rows: Set<string>; entries: EntryOut[] }[] =
    ov.tracks.map((def) => {
      for (const k of def.rows ?? []) known(k, `tracks[${def.title}].rows`);
      return {
        def,
        names: new Set([def.title, ...(def.aka ?? []), ...(def.match ?? [])].map(normKey)),
        rows: new Set(def.rows ?? []),
        entries: [],
      };
    });
  const auto = new Map<string, EntryOut[]>();
  let solo = 0;
  for (const e of entries) {
    const home =
      curated.find((c) => e.rows.some((r) => c.rows.has(r.key))) ??
      (e.placeholder ? undefined : curated.find((c) => c.names.has(normKey(e.title))));
    if (home) {
      home.entries.push(e);
      continue;
    }
    const k = e.placeholder ? `\u0000${solo++}` : normKey(e.title);
    auto.set(k, [...(auto.get(k) ?? []), e]);
  }

  const order = (a: EntryOut, b: EntryOut) =>
    (a.year ?? 9999) - (b.year ?? 9999) ||
    TAB_ORDER[a.rows[0]!.tab]! - TAB_ORDER[b.rows[0]!.tab]! ||
    a.rows[0]!.n - b.rows[0]!.n;

  const tracks: TrackOut[] = [];
  for (const c of curated) {
    if (!c.entries.length) {
      problems.push(`tracks[${c.def.title}]: no rows matched`);
      continue;
    }
    tracks.push({
      slug: '', title: c.def.title, aka: c.def.aka ?? [], releasedAs: c.def.released_as ?? null,
      notes: c.def.notes ?? null, curated: true, entries: c.entries.sort(order),
    });
    for (const e of c.entries)
      finaliseEntry(e, { title: c.def.title, aka: c.def.aka ?? [], match: c.def.match ?? [] });
  }
  for (const group of auto.values()) {
    group.sort(order);
    const title = group[0]!.title;
    const aka = [...new Set(group.map((e) => e.title))].filter((t) => normKey(t) !== normKey(title));
    tracks.push({ slug: '', title, aka, releasedAs: null, notes: null, curated: false, entries: group });
    for (const e of group) finaliseEntry(e, { title, aka, match: [] });
  }

  tracks.sort((a, b) => order(a.entries[0]!, b.entries[0]!));
  const used = new Set<string>();
  let n = 0;
  for (const t of tracks) {
    const first = t.entries[0]!;
    const who = [...collaborators(first.artists)];
    const parts = first.placeholder
      ? [t.title, ...who, first.versionLabel ?? '', first.year ?? (who.length ? '' : 'undated')]
      : [t.title];
    const base = slugify(parts.filter(Boolean).join(' ')) || 'untitled';
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    used.add(slug);
    t.slug = slug;
    for (const e of t.entries) e.sort = n++;
  }

  return { tracks, skipped, matches, undecided, problems };
}
