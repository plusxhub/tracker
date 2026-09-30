// Interprets a raw sheet row: one Draft per row, in the site's vocabulary.
import { classifyLink, sourceLabel, stripUrls, type SourceKind } from './links.ts';
import { isPlaceholderTitle, parseFeatureCell, parseName, parseTitle, type Credit } from './names.ts';
import type { Overrides } from './overrides.ts';
import type { RawRow } from './rows.ts';
import { normKey, squash } from './text.ts';

export type EraSlug = 'spinnin' | 'pre-stmpd' | 'stmpd' | 'unknown';
export type Availability = 'none' | 'snippet' | 'partial' | 'full' | 'og_file' | 'circulating';
export type Kind = 'track' | 'stems' | 'instrumental' | 'acapella' | 'session' | 'multitrack' | 'tv_track';

export interface DraftSource {
  kind: SourceKind;
  label: string;
  url: string;
}

export interface DraftFile {
  url: string;
  host: string;
  filename: string | null;
  reason: string;
}

export interface Draft {
  row: RawRow;
  kind: Kind;
  title: string;
  labels: string[];
  placeholder: boolean;
  artists: Credit[];
  tags: string[];
  era: EraSlug | null;
  year: number | null;
  type: string | null;
  availability: Availability;
  evidence: 'confirmed' | 'rumored' | null;
  quality: string | null;
  status: string | null;
  variation: string | null;
  notes: string | null;
  sources: DraftSource[];
  files: DraftFile[];
  /** Things a human should look at; surfaced in the import report. */
  flags: string[];
}

const ERA: [RegExp, EraSlug][] = [
  [/pre\s*-?\s*stmpd/i, 'pre-stmpd'],
  [/stmpd/i, 'stmpd'],
  [/spinnin/i, 'spinnin'],
  [/unknown/i, 'unknown'],
];

export function mapEra(raw: string | null | undefined): EraSlug | null {
  if (!raw) return null;
  return ERA.find(([re]) => re.test(raw))?.[1] ?? null;
}

/** Sheet B has no pre-STMPD era, so era for its rows follows the year. */
export function eraForYear(year: number | null): EraSlug {
  if (year == null) return 'unknown';
  if (year <= 2014) return 'spinnin';
  if (year === 2015) return 'pre-stmpd';
  return 'stmpd';
}

const TYPE: Record<string, string> = {
  unknown: 'unknown', demo: 'demo', feature: 'feature', other: 'other', og: 'og',
  'og file': 'og', throwaway: 'throwaway', 'ref track': 'ref_track',
  production: 'production', remix: 'remix', 'album track': 'album_track',
};

const KIND: Record<string, Kind> = {
  stems: 'stems', instrumental: 'instrumental', acapella: 'acapella',
  sessions: 'session', 'studio multitrack': 'multitrack', 'tv track': 'tv_track',
};

const QUALITY: Record<string, string> = {
  recording: 'recording', abysmal: 'abysmal', 'low quality': 'low',
  'high quality': 'high', 'cd quality': 'cd', lossless: 'lossless',
};

const STATUS: [RegExp, string][] = [
  [/on works/i, 'in_progress'],
  [/^released in soundcloud/i, 'released'],
  [/cancelled/i, 'cancelled'],
  [/unknown|released by umg/i, 'unknown'],
];

const LEAK_VENUE = /thesource|discord|group\s?buy|hack|leak(?:ed)?\s+(?:by|on|from|in)|being sold/i;

const cell = (row: RawRow, name: string) => squash(row.cells[name]?.text ?? '');

export class Normalizer {
  private spell = new Map<string, string>();
  private vocalists: Set<string>;
  private publicRows: Set<string>;
  private privateRows: Set<string>;

  constructor(private ov: Overrides) {
    for (const [from, to] of Object.entries(ov.artists.spellings)) this.spell.set(normKey(from), to);
    this.vocalists = new Set(ov.artists.vocalists.map(normKey));
    this.publicRows = new Set(ov.links.public_rows);
    this.privateRows = new Set(ov.links.private_rows);
  }

  canonical(name: string): string {
    const n = squash(name);
    return this.spell.get(normKey(n)) ?? n;
  }

  private credits(list: Credit[]): Credit[] {
    const seen = new Set<string>();
    const out: Credit[] = [];
    for (const c of list) {
      const name = this.canonical(c.name);
      const k = `${normKey(name)}|${c.role}`;
      if (!name || seen.has(k)) continue;
      seen.add(k);
      out.push({ ...c, name });
    }
    return out;
  }

  /** Classify a hyperlink and file it as a public source or a private file. */
  private link(d: Draft, url: string, label: string, filename: string | null): void {
    const key = d.row.key;
    const force = this.privateRows.has(key) ? 'private' : this.publicRows.has(key) ? 'public' : undefined;
    const v = classifyLink(url, label, force);
    if (v.visibility === 'public') {
      if (!d.sources.some((s) => s.url === url))
        d.sources.push({ kind: v.kind, label: sourceLabel(label, url), url });
    } else if (!d.files.some((f) => f.url === url)) {
      d.files.push({ url, host: v.host, filename, reason: v.reason });
      if (!v.anchor) d.flags.push(`link kept private (${v.reason}): ${v.host}`);
    }
  }

  private notes(d: Draft, raw: string): void {
    let text = raw.replace(/\[\d+\]/g, '').trim();
    const { text: cleaned, urls } = stripUrls(text);
    text = cleaned;
    for (const u of urls) this.link(d, u, '', null);
    for (const r of this.ov.notes.redact) text = text.replace(new RegExp(r.pattern, 'gi'), r.replace);
    // Collapse the hard-wrapped bullet lists some cells use.
    text = text
      .split(/\n+/)
      .map((l) => squash(l))
      .filter(Boolean)
      .join('\n')
      .replace(/\n(?![-•])/g, ' ');
    d.notes = text || null;
    if (d.notes && LEAK_VENUE.test(d.notes)) d.flags.push('note mentions how or where it leaked');
  }

  private blank(row: RawRow): Draft {
    return {
      row, kind: 'track', title: '', labels: [], placeholder: false, artists: [], tags: [],
      era: null, year: row.section.year, type: null, availability: 'none', evidence: null,
      quality: null, status: null, variation: null, notes: null, sources: [], files: [], flags: [],
    };
  }

  private portion(d: Draft, raw: string): void {
    switch (raw.toLowerCase()) {
      case 'full': d.availability = 'full'; break;
      case 'partial': d.availability = 'partial'; break;
      case 'snippet': d.availability = 'snippet'; break;
      case 'og file': d.availability = 'og_file'; break;
      case 'confirmed': d.evidence = 'confirmed'; break;
      case 'rumored': d.evidence = 'rumored'; break;
      case '': break;
      default: d.flags.push(`unmapped portion "${raw}"`);
    }
  }

  sheetA(row: RawRow): Draft {
    const d = this.blank(row);
    const p = parseName(row.cells.name?.text ?? '', this.ov.artists.acts);
    d.title = p.title;
    d.labels = p.versionLabel ? p.versionLabel.split(' · ') : [];
    d.artists = this.credits(p.artists);
    d.tags = p.tags;
    if (!d.title) d.flags.push('row has no name');
    else if (p.noSeparator) d.flags.push('no "Artist - Title" separator');

    d.era = mapEra(cell(row, 'era')) ?? mapEra(row.section.era) ?? eraForYear(d.year);
    this.portion(d, cell(row, 'portion'));

    const type = cell(row, 'type').toLowerCase();
    if (row.tab === 'a.stems') {
      d.kind = KIND[type] ?? 'track';
      if (!KIND[type]) d.flags.push(`unmapped stems type "${type}"`);
    } else {
      d.type = type ? (TYPE[type] ?? null) : 'unknown';
      if (type && !TYPE[type]) d.flags.push(`unmapped type "${type}"`);
      // "OG File" is a portion in the sheet's own key but gets used as a type.
      if (type === 'og file' && d.availability === 'full') d.availability = 'og_file';
    }

    const q = cell(row, 'quality').toLowerCase();
    d.quality = QUALITY[q] ?? null;
    if (q && q !== 'not available' && !QUALITY[q]) d.flags.push(`unmapped quality "${q}"`);

    const link = row.cells.link;
    if (link?.href) this.link(d, link.href, '', null);
    else if (/^link$/i.test(cell(row, 'link'))) d.flags.push('cell says "Link" but has no URL');

    this.notes(d, row.cells.notes?.text ?? '');
    d.placeholder = isPlaceholderTitle(d.title);
    return d;
  }

  sheetB(row: RawRow): Draft {
    const d = this.blank(row);
    const t = parseTitle(row.cells.title?.text ?? '', this.ov.artists.acts);
    d.title = t.title;
    d.labels = t.labels;
    if (!d.title) {
      d.title = 'ID';
      d.flags.push('row has no title');
    }
    const collaborators = parseFeatureCell(cell(row, 'artist'), this.ov.artists.acts).map((c) => ({
      ...c,
      name: this.canonical(c.name),
    }));
    d.artists = this.credits([
      { name: 'Martin Garrix', role: 'main' },
      ...collaborators.map((c): Credit => ({
        ...c,
        role: this.vocalists.has(normKey(c.name)) ? 'feat' : 'main',
      })),
    ]);

    d.era = eraForYear(d.year);
    if (row.tab === 'b.demos') {
      d.type = 'demo';
      d.variation = cell(row, 'variation') || null;
      if (d.variation && /^n\/?d$/i.test(d.variation)) d.variation = null;
    } else {
      d.type = 'unknown';
      const status = cell(row, 'status');
      d.status = STATUS.find(([re]) => re.test(status))?.[1] ?? null;
      if (status && !d.status) d.flags.push(`unmapped status "${status}"`);
    }

    const dl = row.cells.download;
    if (dl?.href) {
      this.link(d, dl.href, 'download', squash(dl.text) || null);
      d.availability = 'circulating';
    }
    const src = row.cells.source;
    if (src?.href) this.link(d, src.href, src.text, null);
    const noteCell = row.cells.notes;
    if (noteCell?.href) this.link(d, noteCell.href, '', null);
    this.notes(d, noteCell?.text ?? '');
    d.placeholder = isPlaceholderTitle(d.title);
    return d;
  }

  draft(row: RawRow): Draft {
    return row.tab.startsWith('a.') ? this.sheetA(row) : this.sheetB(row);
  }
}
