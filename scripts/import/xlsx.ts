// Minimal xlsx reader. The off-the-shelf readers either drop hyperlinks or are
// unmaintained, and the importer needs exactly four things from a workbook:
// cell text, hyperlink targets (relationship-based and =HYPERLINK() formulas),
// merged ranges, and tab visibility.
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export interface Cell {
  text: string;
  href?: string;
}

export interface SheetRow {
  /** 1-based row number as it appears in the sheet. */
  n: number;
  cells: Record<string, Cell>;
}

export interface Merge {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

export interface Tab {
  name: string;
  hidden: boolean;
  rows: SheetRow[];
  merges: Merge[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) =>
    ['sheet', 'Relationship', 'si', 'r', 'row', 'c', 'hyperlink', 'mergeCell'].includes(name),
});

export function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function indexToCol(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function splitRef(ref: string): { col: string; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`bad cell ref ${ref}`);
  return { col: m[1]!, row: Number(m[2]) };
}

function parseRange(ref: string): Merge {
  const [a, b] = ref.split(':');
  const s = splitRef(a!);
  const e = splitRef(b ?? a!);
  return { c1: colToIndex(s.col), r1: s.row, c2: colToIndex(e.col), r2: e.row };
}

/** Text of a node that may be a string, a {#text} object, or rich-text runs. */
function nodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  const o = node as Record<string, unknown>;
  if ('#text' in o) return nodeText(o['#text']);
  if ('t' in o || 'r' in o) return nodeText(o['r']) + nodeText(o['t']);
  return '';
}

function sharedStringText(si: Record<string, unknown>): string {
  // <si><t>plain</t></si> or <si><r><t>run</t></r><r><t>run</t></r></si>
  if (si['r']) return (si['r'] as Record<string, unknown>[]).map((r) => nodeText(r['t'])).join('');
  return nodeText(si['t']);
}

function rels(files: Record<string, Uint8Array>, path: string): Map<string, string> {
  const out = new Map<string, string>();
  const f = files[path];
  if (!f) return out;
  const doc = parser.parse(strFromU8(f));
  for (const r of doc.Relationships?.Relationship ?? []) out.set(r['@_Id'], r['@_Target']);
  return out;
}

const HYPERLINK_FORMULA = /HYPERLINK\(\s*"([^"]+)"/i;

export function readWorkbook(buf: Uint8Array): Tab[] {
  const files = unzipSync(buf);
  const strings: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const sst = parser.parse(strFromU8(files['xl/sharedStrings.xml']));
    for (const si of sst.sst?.si ?? []) strings.push(sharedStringText(si));
  }

  const wb = parser.parse(strFromU8(files['xl/workbook.xml']!));
  const wbRels = rels(files, 'xl/_rels/workbook.xml.rels');
  const tabs: Tab[] = [];

  for (const s of wb.workbook.sheets.sheet) {
    const target = wbRels.get(s['@_r:id']);
    if (!target) continue;
    const path = `xl/${target.replace(/^\/?xl\//, '')}`;
    const doc = parser.parse(strFromU8(files[path]!)).worksheet;
    const sheetRels = rels(files, path.replace('worksheets/', 'worksheets/_rels/') + '.rels');

    const links = new Map<string, string>();
    for (const h of doc.hyperlinks?.hyperlink ?? []) {
      const url = sheetRels.get(h['@_r:id']);
      if (!url) continue; // internal "location" links between tabs
      const m = parseRange(h['@_ref']);
      for (let r = m.r1; r <= m.r2; r++)
        for (let c = m.c1; c <= m.c2; c++) links.set(`${indexToCol(c)}${r}`, url);
    }

    const rows: SheetRow[] = [];
    for (const row of doc.sheetData?.row ?? []) {
      const cells: Record<string, Cell> = {};
      for (const c of row.c ?? []) {
        const ref: string = c['@_r'];
        const { col } = splitRef(ref);
        let text = '';
        if (c['@_t'] === 's') text = strings[Number(nodeText(c.v))] ?? '';
        else if (c['@_t'] === 'inlineStr') text = nodeText(c.is);
        else text = nodeText(c.v);
        const formula = nodeText(c.f);
        const href = links.get(ref) ?? HYPERLINK_FORMULA.exec(formula)?.[1];
        if (text.trim() === '' && !href) continue;
        cells[col] = href ? { text, href } : { text };
      }
      if (Object.keys(cells).length) rows.push({ n: Number(row['@_r']), cells });
    }

    const merges = (doc.mergeCells?.mergeCell ?? []).map((m: Record<string, string>) =>
      parseRange(m['@_ref']!),
    );
    tabs.push({ name: String(s['@_name']), hidden: s['@_state'] === 'hidden', rows, merges });
  }
  return tabs;
}

/**
 * Copy the anchor cell of every vertical merge into the rows beneath it, so each
 * row stands on its own. Only the first column of a merge ever holds a value.
 */
export function fillDownMerges(tab: Tab): void {
  const byRow = new Map(tab.rows.map((r) => [r.n, r]));
  for (const m of tab.merges) {
    if (m.r2 === m.r1) continue;
    const col = indexToCol(m.c1);
    const anchor = byRow.get(m.r1)?.cells[col];
    if (!anchor) continue;
    for (let r = m.r1 + 1; r <= m.r2; r++) {
      let row = byRow.get(r);
      if (!row) {
        row = { n: r, cells: {} };
        byRow.set(r, row);
        tab.rows.push(row);
      }
      if (!row.cells[col]) row.cells[col] = { ...anchor };
    }
  }
  tab.rows.sort((a, b) => a.n - b.n);
}
