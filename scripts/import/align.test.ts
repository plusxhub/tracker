import { describe, expect, test } from 'bun:test';
import { align, describeChange, type KnownRow } from './align.ts';
import type { RawRow } from './rows.ts';

let uid = 0;
function row(n: number, key: string, hash: string, over: Partial<RawRow> = {}): RawRow {
  return {
    tab: 'a.unreleased', n, key: `a.unreleased:${key}`, hash, anchor: null,
    cells: { name: { text: key } }, section: { year: 2015, era: null, group: null }, ...over,
  };
}
function known(r: RawRow): KnownRow {
  return {
    rowUid: ++uid, tab: r.tab, identityKey: r.key, fileAnchor: r.anchor, vanished: false,
    rowNumber: r.n, section: r.section, hash: r.hash, cells: r.cells,
  };
}
const statuses = (rows: RawRow[], prev: KnownRow[]) => align(rows, prev).rows.map((a) => a.status);

describe('align', () => {
  const base = [row(3, 'lim', 'h1'), row(4, 'bronze', 'h2'), row(5, 'frycho', 'h3')];
  const prev = base.map(known);

  test('an identical re-run reports nothing', () => {
    expect(statuses(base, prev)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(align(base, prev).vanished).toEqual([]);
  });

  test('a row inserted above shifts the rest: they are moved, not changed', () => {
    const now = [row(3, 'new-one', 'h9'), ...base.map((r) => ({ ...r, n: r.n + 1 }))];
    expect(statuses(now, prev)).toEqual(['new', 'moved', 'moved', 'moved']);
  });

  test('an edited note is a change to the same row', () => {
    const now = [base[0]!, { ...base[1]!, hash: 'h2-edited' }, base[2]!];
    const res = align(now, prev);
    expect(res.rows.map((a) => a.status)).toEqual(['unchanged', 'changed', 'unchanged']);
    expect(res.rows[1]!.via).toBe('identity');
  });

  test('a renamed row is still recognised by its file', () => {
    const before = row(9, 'id', 'h5', { anchor: 'drive:abc' });
    const after = row(9, 'secret-title', 'h6', { anchor: 'drive:abc' });
    const res = align([after], [known(before)]);
    expect(res.rows[0]).toMatchObject({ status: 'changed', via: 'file' });
  });

  test('a renamed row with no file falls back to similarity and asks for confirmation', () => {
    const before = row(9, 'martin-garrix-and-brooks-id', 'h5');
    const after = row(9, 'martin-garrix-and-brooks-pirates', 'h6');
    expect(align([after], [known(before)]).rows[0]!.status).toBe('probably_changed');
  });

  test('duplicate rows pair up by position', () => {
    const dup = [row(124, 'martin-garrix-id', 'same'), row(125, 'martin-garrix-id~2', 'same')];
    const res = align(dup.map((r) => ({ ...r, n: r.n + 2 })), dup.map(known));
    expect(res.rows.map((a) => a.status)).toEqual(['moved', 'moved']);
    expect(res.rows[0]!.known!.rowNumber).toBe(124);
    expect(res.rows[1]!.known!.rowNumber).toBe(125);
  });

  test('a deleted row is reported as vanished', () => {
    const res = align([base[0]!, base[2]!], prev);
    expect(res.vanished.map((k) => k.identityKey)).toEqual(['a.unreleased:bronze']);
  });

  test('rows never match across tabs', () => {
    const other = { ...base[0]!, tab: 'b.demos' as const };
    expect(align([other], prev).rows[0]!.status).toBe('new');
  });
});

test('describeChange never prints a URL', () => {
  const before = row(3, 'lim', 'h1', { cells: { name: { text: 'Lim' }, link: { text: 'Link', href: 'https://example.com/secret' } } });
  const after = row(4, 'lim', 'h2', { cells: { name: { text: 'LIM' }, link: { text: 'Link', href: 'https://example.com/other' } } });
  const [a] = align([after], [known(before)]).rows;
  const lines = describeChange(a!);
  expect(lines).toContain('name: "Lim" -> "LIM"');
  expect(lines).toContain('link: link changed');
  expect(lines.join(' ')).not.toContain('http');
});
