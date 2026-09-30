// Turns the two workbooks into self-contained raw rows. A raw row is what gets
// stored as provenance and diffed between runs; nothing here interprets meaning.
import { fillDownMerges, type Cell, type Tab } from './xlsx.ts';
import { fileAnchor } from './links.ts';
import { sha1, slugify, squash } from './text.ts';

export type TabId = 'a.unreleased' | 'a.stems' | 'b.unreleased' | 'b.demos';

export interface RawRow {
  tab: TabId;
  /** Row number in the sheet on this run. Shifts when editors insert rows. */
  n: number;
  /** Identity key, stable across row moves: `${tab}:${slug}` with `~2` for repeats. */
  key: string;
  /** Cells by logical column name. */
  cells: Record<string, Cell>;
  /** Year and era the row sits under; both sheets encode these by position. */
  section: { year: number | null; era: string | null; group: string | null };
  hash: string;
  anchor: string | null;
}

export interface TimelineRow {
  year: number | null;
  era: string | null;
  events: string;
  blurb: string | null;
}

export interface GlossaryRow {
  heading: string;
  term: string;
  definition: string;
}

export interface Extracted {
  rows: RawRow[];
  timeline: TimelineRow[];
  glossary: GlossaryRow[];
}

const COLUMNS: Record<TabId, Record<string, string>> = {
  'a.unreleased': {
    era: 'era', name: 'name', notes: 'notes', type: 'type', portion: 'portion',
    quality: 'quality', 'link(s)': 'link',
  },
  'a.stems': {
    era: 'era', name: 'name', notes: 'notes', source: 'origin', type: 'type',
    portion: 'portion', quality: 'quality', 'link(s)': 'link',
  },
  'b.unreleased': {
    era: 'era', year: 'year', title: 'title', 'artist feature': 'artist',
    'download link': 'download', source: 'source', status: 'status', notes: 'notes',
  },
  'b.demos': {
    era: 'era', year: 'year', title: 'title', 'artist feature': 'artist',
    'download link': 'download', variation: 'variation', notes: 'notes',
  },
};

function findTab(tabs: Tab[], name: string): Tab {
  const t = tabs.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
  if (!t) throw new Error(`tab "${name}" not found (tabs: ${tabs.map((x) => x.name).join(', ')})`);
  return t;
}

/** Locate the header row and map sheet column letters to logical names. */
function columnMap(tab: Tab, id: TabId): { headerRow: number; cols: Record<string, string> } {
  const wanted = COLUMNS[id];
  for (const row of tab.rows.slice(0, 6)) {
    const cols: Record<string, string> = {};
    for (const [letter, cell] of Object.entries(row.cells)) {
      const name = wanted[squash(cell.text).toLowerCase()];
      if (name) cols[letter] = name;
    }
    if (Object.keys(cols).length >= 4) {
      const missing = Object.values(wanted).filter((v) => !Object.values(cols).includes(v));
      if (missing.length) throw new Error(`${id}: header is missing column(s) ${missing.join(', ')}`);
      return { headerRow: row.n, cols };
    }
  }
  throw new Error(`${id}: header row not found`);
}

function named(row: Record<string, Cell>, cols: Record<string, string>): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const [letter, cell] of Object.entries(row)) {
    const name = cols[letter];
    if (name && (cell.text.trim() || cell.href)) out[name] = cell;
  }
  return out;
}

const text = (c: Cell | undefined) => (c ? squash(c.text) : '');

async function finish(
  tab: TabId,
  n: number,
  cells: Record<string, Cell>,
  section: RawRow['section'],
  identity: string,
  hashed: string[],
  seen: Map<string, number>,
): Promise<RawRow> {
  const base = `${tab}:${slugify(identity) || 'untitled'}`;
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  const payload = hashed.map((k) => [k, cells[k]?.text.trim() ?? '', cells[k]?.href ?? '']);
  const anchor =
    Object.values(cells)
      .map((c) => (c.href ? fileAnchor(c.href) : undefined))
      .find(Boolean) ?? null;
  return {
    tab, n, cells, section,
    key: count > 1 ? `${base}~${count}` : base,
    hash: await sha1(JSON.stringify(payload)),
    anchor,
  };
}

const STRIP_TAGS = /^[\s⭐🏆🥇🗑🤖️]+/u;

export async function extractSheetA(tabs: Tab[]): Promise<Extracted> {
  const rows: RawRow[] = [];
  const timeline: TimelineRow[] = [];

  // Unreleased: header rows carry the year in the notes column and no portion.
  {
    const id: TabId = 'a.unreleased';
    const tab = findTab(tabs, 'Unreleased');
    const { headerRow, cols } = columnMap(tab, id);
    const seen = new Map<string, number>();
    let section: RawRow['section'] = { year: null, era: null, group: null };
    for (const r of tab.rows) {
      if (r.n <= headerRow) continue;
      const c = named(r.cells, cols);
      const notes = text(c.notes);
      const stats = /full[\s\S]*partial/i.test(c.era?.text ?? '');
      if (stats) {
        const year = /^(\d{4})/.exec(notes);
        section = { year: year ? Number(year[1]) : null, era: text(c.name) || null, group: null };
        timeline.push({
          year: section.year,
          era: section.era,
          events: c.notes?.text ?? '',
          blurb: text(c.type) || null, // the blurb sits in a merged cell starting at the Type column
        });
        continue;
      }
      if (!c.name && !c.portion && !c.type) continue; // footer: credits, guidelines
      rows.push(
        await finish(id, r.n, c, { ...section }, text(c.name).replace(STRIP_TAGS, ''),
          ['era', 'name', 'notes', 'type', 'portion', 'quality', 'link'], seen),
      );
    }
  }

  // Stems: two levels of headers (era, then "Acapellas" / "Instrumentals" / ...).
  {
    const id: TabId = 'a.stems';
    const tab = findTab(tabs, 'StemsInstrumentalsAcapellas');
    const { headerRow, cols } = columnMap(tab, id);
    const seen = new Map<string, number>();
    let section: RawRow['section'] = { year: null, era: null, group: null };
    for (const r of tab.rows) {
      if (r.n <= headerRow) continue;
      const c = named(r.cells, cols);
      if (/\btotal\b/i.test(c.era?.text ?? '')) {
        section = { year: null, era: text(c.name) || section.era, group: null };
        continue;
      }
      if (c.name && !c.type) {
        section = { ...section, group: text(c.name) };
        continue;
      }
      if (!c.name) continue; // template rows with a type but no name
      rows.push(
        await finish(id, r.n, c, { ...section }, text(c.name),
          ['era', 'name', 'notes', 'origin', 'type', 'portion', 'quality', 'link'], seen),
      );
    }
  }

  return { rows, timeline, glossary: extractGlossary(findTab(tabs, 'Key')) };
}

/** The Key tab is two side-by-side term/definition lists, each with section headings. */
function extractGlossary(tab: Tab): GlossaryRow[] {
  const out: GlossaryRow[] = [];
  for (const [termCol, defCol] of [['A', 'B'], ['C', 'D']] as const) {
    let heading = '';
    for (const r of tab.rows) {
      const term = text(r.cells[termCol]);
      const def = text(r.cells[defCol]);
      if (term && !def) heading = term;
      else if (term && def) out.push({ heading, term, definition: def });
    }
  }
  return out;
}

export async function extractSheetB(tabs: Tab[]): Promise<Extracted> {
  const rows: RawRow[] = [];
  for (const [id, name] of [['b.unreleased', 'Garrix Unreleased'], ['b.demos', 'Garrix Demos']] as const) {
    const tab = findTab(tabs, name);
    fillDownMerges(tab);
    const { headerRow, cols } = columnMap(tab, id);
    const seen = new Map<string, number>();
    for (const r of tab.rows) {
      if (r.n <= headerRow) continue;
      const c = named(r.cells, cols);
      if (!c.title && !c.artist) continue;
      const year = /^(\d{4})/.exec(text(c.year));
      const section = { year: year ? Number(year[1]) : null, era: text(c.era) || null, group: null };
      const identity = [text(c.title), text(c.artist), id === 'b.demos' ? text(c.variation) : ''].join(' ');
      const hashed = id === 'b.demos'
        ? ['title', 'artist', 'download', 'variation', 'notes']
        : ['title', 'artist', 'download', 'source', 'status', 'notes'];
      rows.push(await finish(id, r.n, c, section, identity, hashed, seen));
    }
  }
  return { rows, timeline: [], glossary: [] };
}
