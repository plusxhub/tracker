// Matches this run's sheet rows to the rows recorded on an earlier run, so an
// editor inserting a row near the top does not make everything below it look
// changed. Identity is established by content first and position last.
import type { RawRow } from './rows.ts';

export interface KnownRow {
  rowUid: number;
  tab: string;
  identityKey: string;
  fileAnchor: string | null;
  vanished: boolean;
  rowNumber: number;
  section: RawRow['section'];
  hash: string;
  cells: RawRow['cells'];
}

export type RowStatus = 'unchanged' | 'moved' | 'changed' | 'probably_changed' | 'new';

export interface Aligned {
  row: RawRow;
  status: RowStatus;
  known?: KnownRow;
  /** How the row was recognised. */
  via?: 'content' | 'file' | 'identity' | 'similarity';
}

export interface Alignment {
  rows: Aligned[];
  vanished: KnownRow[];
}

const tokens = (key: string) => new Set(key.split(':')[1]?.split('-').filter((t) => t.length > 1) ?? []);

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

const sameSection = (a: RawRow['section'], b: RawRow['section']) =>
  a.year === b.year && (a.group ?? null) === (b.group ?? null);

export function align(current: RawRow[], known: KnownRow[]): Alignment {
  const out = new Map<RawRow, Aligned>();
  const free = new Set(known);
  const take = (row: RawRow, k: KnownRow, via: Aligned['via'], status?: RowStatus) => {
    free.delete(k);
    const moved = k.rowNumber !== row.n || !sameSection(k.section, row.section);
    out.set(row, {
      row, known: k, via,
      status: status ?? (k.hash !== row.hash ? 'changed' : moved ? 'moved' : 'unchanged'),
    });
  };
  const pending = () => current.filter((r) => !out.has(r));
  const candidates = (row: RawRow) => [...free].filter((k) => k.tab === row.tab);

  // 1. Identical content. Duplicates pair up in sheet order.
  const byContent = new Map<string, KnownRow[]>();
  for (const k of [...free].sort((a, b) => a.rowNumber - b.rowNumber)) {
    const id = `${k.tab}|${k.hash}`;
    byContent.set(id, [...(byContent.get(id) ?? []), k]);
  }
  for (const row of [...current].sort((a, b) => a.n - b.n)) {
    const hit = byContent.get(`${row.tab}|${row.hash}`)?.shift();
    if (hit) take(row, hit, 'content');
  }
  // 2. Same hosted file.
  for (const row of pending()) {
    if (!row.anchor) continue;
    const hit = candidates(row).find((k) => k.fileAnchor === row.anchor);
    if (hit) take(row, hit, 'file');
  }
  // 3. Same identity key (artist + title, or title + artist + variation).
  for (const row of pending()) {
    const hit = candidates(row).find((k) => k.identityKey === row.key);
    if (hit) take(row, hit, 'identity');
  }
  // 4. Closest remaining row in the same section. Needs a human to confirm.
  for (const row of pending()) {
    const best = candidates(row)
      .filter((k) => k.section.year === row.section.year)
      .map((k) => ({ k, score: similarity(k.identityKey, row.key) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 0.5) take(row, best.k, 'similarity', 'probably_changed');
  }
  for (const row of pending()) out.set(row, { row, status: 'new' });

  return {
    rows: current.map((r) => out.get(r)!),
    vanished: [...free].filter((k) => !k.vanished),
  };
}

/** Column-level description of what changed, without printing any URL. */
export function describeChange(a: Aligned): string[] {
  if (!a.known) return [];
  const out: string[] = [];
  const cols = new Set([...Object.keys(a.known.cells), ...Object.keys(a.row.cells)]);
  const clip = (s: string) => (s.length > 70 ? `${s.slice(0, 70)}…` : s);
  for (const c of cols) {
    const before = a.known.cells[c];
    const after = a.row.cells[c];
    const bt = before?.text.trim() ?? '';
    const at = after?.text.trim() ?? '';
    if (bt !== at) out.push(`${c}: ${JSON.stringify(clip(bt))} -> ${JSON.stringify(clip(at))}`);
    else if ((before?.href ?? '') !== (after?.href ?? ''))
      out.push(`${c}: link ${before?.href ? (after?.href ? 'changed' : 'removed') : 'added'}`);
  }
  if (a.known.rowNumber !== a.row.n) out.push(`row ${a.known.rowNumber} -> ${a.row.n}`);
  if (a.known.section.year !== a.row.section.year)
    out.push(`section ${a.known.section.year ?? 'unknown'} -> ${a.row.section.year ?? 'unknown'}`);
  return out;
}
