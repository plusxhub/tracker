// Sheet importer.
//
//   bun run import                 compare the sheets with what was last recorded; writes nothing
//   bun run import --init          first import into an empty database
//   bun run import --apply <key>   import one new sheet row
//   bun run import --ack           record the sheets' current state as reviewed
//   bun run import --dry-run       run the whole pipeline and print the merge report; no database
//   bun run import --keys          list row identity keys (for data/overrides.yaml)
//
//   --a <file.xlsx> / --b <file.xlsx>   read a local copy instead of fetching
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { align } from './align.ts';
import { fetchWorkbook, type SheetKey } from './fetch.ts';
import { merge } from './merge.ts';
import { Normalizer } from './normalize.ts';
import { loadOverrides } from './overrides.ts';
import { parseGlossary, parseTimeline } from './reference.ts';
import { diffReport, mergeReport } from './report.ts';
import { extractSheetA, extractSheetB } from './rows.ts';
import { CatalogueWriter, catalogueIsEmpty, loadKnown, persistRow, persistRows, recordRun } from './store.ts';
import { readWorkbook } from './xlsx.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function workbook(sheet: SheetKey) {
  const local = value(`--${sheet}`);
  return readWorkbook(local ? new Uint8Array(readFileSync(local)) : await fetchWorkbook(sheet));
}

const ov = loadOverrides(join(import.meta.dir, '..', '..', 'data', 'overrides.yaml'));
const a = await extractSheetA(await workbook('a'));
const b = await extractSheetB(await workbook('b'));
const rows = [...a.rows, ...b.rows];

if (flag('--keys')) {
  for (const r of rows) console.log(`${r.tab}\trow ${r.n}\t${r.key}`);
  process.exit(0);
}

const normalizer = new Normalizer(ov);
const result = merge(rows.map((r) => normalizer.draft(r)), ov);

if (flag('--dry-run')) {
  console.log(mergeReport(result));
  process.exit(result.problems.length ? 1 : 0);
}

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL is not set (see .env.example)');
  process.exit(1);
}
const sql = postgres(url, { onnotice: () => {} });

try {
  const alignment = align(rows, await loadKnown(sql));

  if (flag('--init')) {
    if (!(await catalogueIsEmpty(sql))) throw new Error('--init refused: the catalogue already has tracks');
    if (result.problems.length || result.undecided.length) {
      console.log(mergeReport(result));
      throw new Error('--init refused: resolve the problems above in data/overrides.yaml first');
    }
    const counts = await sql.begin(async (tx) => {
      const runId = await recordRun(tx, 'init', { rows: rows.length });
      const uids = await persistRows(tx, runId, alignment);
      const writer = new CatalogueWriter(tx, ov, uids);
      await writer.writeReference(parseTimeline(a.timeline), parseGlossary(a.glossary, ov));
      return writer.writeAll(result);
    });
    console.log(mergeReport(result));
    console.log(`\nImported ${counts.tracks} songs and ${counts.entries} versions.`);
  } else if (flag('--ack')) {
    await sql.begin(async (tx) => {
      const runId = await recordRun(tx, 'ack', { rows: rows.length });
      await persistRows(tx, runId, alignment);
    });
    console.log(`Recorded the current state of ${rows.length} sheet rows as reviewed.`);
  } else if (flag('--apply')) {
    const key = value('--apply');
    const target = alignment.rows.find((x) => x.row.key === key);
    if (!key || !target) throw new Error(`--apply: no sheet row with key ${key}`);
    if (ov.skip[key]) throw new Error(`--apply: ${key} is skipped in data/overrides.yaml`);
    const track = result.tracks.find((t) => t.entries.some((e) => e.rows.some((r) => r.key === key)));
    const entry = track?.entries.find((e) => e.rows.some((r) => r.key === key));
    if (!track || !entry) throw new Error(`--apply: ${key} did not produce an entry`);

    const outcome = await sql.begin(async (tx) => {
      const runId = await recordRun(tx, 'apply', { key });
      const known = new Map(alignment.rows.filter((x) => x.known).map((x) => [x.row.key, x.known!.rowUid]));
      const uids = new Map(known);
      uids.set(key, await persistRow(tx, runId, target));
      const writer = new CatalogueWriter(tx, ov, uids);
      await writer.loadExisting();

      // The row may document a version that already has an entry (a Sheet B row for a Sheet A recording).
      const siblings = entry.rows.filter((r) => r.key !== key).map((r) => known.get(r.key)).filter((x) => x != null);
      const existing = await writer.entryForRows(siblings);
      if (existing) {
        const [{ track_id }] = (await tx`select track_id from entries where id = ${existing}`) as unknown as [{ track_id: number }];
        await writer.writeLinks(track_id, existing, entry);
        return `attached to the existing entry #${existing}; review its fields by hand`;
      }
      const trackId = (await writer.findTrack(track)) ?? (await writer.writeTrack(track));
      const id = await writer.writeEntry(trackId, entry);
      return `created entry #${id} under "${track.title}"`;
    });
    console.log(`${key}: ${outcome}`);
  } else {
    const { text, pending } = diffReport(alignment);
    console.log(text);
    if (result.problems.length) console.log(`\nOverride problems:\n  ${result.problems.join('\n  ')}`);
    console.log(
      pending
        ? '\nNothing was written. Apply rows with --apply <key>, then --ack once everything is handled.'
        : '\nThe sheets match what was last recorded.',
    );
  }
} finally {
  await sql.end();
}
