// Everything that touches Postgres. Runs as tracker_owner.
import type postgres from 'postgres';
import type { Aligned, Alignment, KnownRow } from './align.ts';
import type { EntryOut, MergeResult, TrackOut } from './merge.ts';
import type { Overrides } from './overrides.ts';
import { ERAS, type GlossaryEntry, type TimelineEvent } from './reference.ts';
import { normKey, slugify } from './text.ts';

type Sql = postgres.Sql | postgres.TransactionSql;

export async function catalogueIsEmpty(sql: Sql): Promise<boolean> {
  const [{ n }] = (await sql`select count(*)::int as n from tracks`) as unknown as [{ n: number }];
  return n === 0;
}

/** The latest recorded state of every sheet row. */
export async function loadKnown(sql: Sql): Promise<KnownRow[]> {
  const rows = await sql`
    select r.row_uid, r.tab, r.identity_key, r.file_anchor, r.vanished,
           v.row_number, v.section_context, v.cells, v.content_hash
    from private.import_rows r
    join lateral (
      select * from private.import_row_versions v
      where v.row_uid = r.row_uid order by v.id desc limit 1
    ) v on true`;
  return rows.map((r) => ({
    rowUid: r.row_uid, tab: r.tab, identityKey: r.identity_key, fileAnchor: r.file_anchor,
    vanished: r.vanished, rowNumber: r.row_number, section: r.section_context, hash: r.content_hash,
    cells: r.cells,
  }));
}

export async function recordRun(sql: Sql, mode: string, summary: object): Promise<number> {
  const [{ id }] = (await sql`
    insert into private.import_runs (mode, summary) values (${mode}, ${sql.json(summary as never)})
    returning id`) as unknown as [{ id: number }];
  return id;
}

async function addVersion(sql: Sql, rowUid: number, runId: number, a: Aligned): Promise<void> {
  await sql`
    insert into private.import_row_versions (row_uid, run_id, row_number, section_context, cells, content_hash)
    values (${rowUid}, ${runId}, ${a.row.n}, ${sql.json(a.row.section)}, ${sql.json(a.row.cells as never)}, ${a.row.hash})`;
}

/** Record one sheet row as seen on this run; returns its row_uid. */
export async function persistRow(sql: Sql, runId: number, a: Aligned): Promise<number> {
  if (!a.known) {
    const [{ row_uid }] = (await sql`
      insert into private.import_rows (tab, identity_key, file_anchor, first_run_id, last_run_id)
      values (${a.row.tab}, ${a.row.key}, ${a.row.anchor}, ${runId}, ${runId})
      returning row_uid`) as unknown as [{ row_uid: number }];
    await addVersion(sql, row_uid, runId, a);
    return row_uid;
  }
  await sql`
    update private.import_rows
    set identity_key = ${a.row.key}, file_anchor = ${a.row.anchor}, last_run_id = ${runId}, vanished = false
    where row_uid = ${a.known.rowUid}`;
  if (a.status !== 'unchanged') await addVersion(sql, a.known.rowUid, runId, a);
  return a.known.rowUid;
}

/** Record the whole sheet state. Returns row_uid by identity key. */
export async function persistRows(sql: Sql, runId: number, al: Alignment): Promise<Map<string, number>> {
  const uids = new Map<string, number>();
  for (const a of al.rows) uids.set(a.row.key, await persistRow(sql, runId, a));
  for (const k of al.vanished)
    await sql`update private.import_rows set vanished = true where row_uid = ${k.rowUid}`;
  return uids;
}

export class CatalogueWriter {
  private eraIds = new Map<string, number>();
  private artistIds = new Map<string, number>();
  private artistSlugs = new Set<string>();

  constructor(private sql: Sql, private ov: Overrides, private uids: Map<string, number>) {}

  async loadExisting(): Promise<void> {
    for (const r of await this.sql`select id, slug from eras`) this.eraIds.set(r.slug, r.id);
    for (const r of await this.sql`select id, slug, name from artists`) {
      this.artistIds.set(normKey(r.name), r.id);
      this.artistSlugs.add(r.slug);
    }
  }

  async writeReference(timeline: TimelineEvent[], glossary: GlossaryEntry[]): Promise<void> {
    for (const e of ERAS) {
      const [{ id }] = (await this.sql`
        insert into eras (slug, name, sort) values (${e.slug}, ${e.name}, ${e.sort}) returning id`) as unknown as [{ id: number }];
      this.eraIds.set(e.slug, id);
    }
    let sort = 0;
    for (const t of timeline)
      await this.sql`
        insert into timeline_events (year, era_id, kind, date_text, body, sort)
        values (${t.year}, ${this.eraIds.get(t.era) ?? null}, ${t.kind}, ${t.dateText}, ${t.body}, ${sort++})`;
    sort = 0;
    for (const g of glossary)
      await this.sql`
        insert into glossary (category, slug, term, definition, sort)
        values (${g.category}, ${g.slug}, ${g.term}, ${g.definition}, ${sort++})
        on conflict (category, slug) do nothing`;
  }

  private async artist(name: string): Promise<number> {
    const key = normKey(name);
    const hit = this.artistIds.get(key);
    if (hit) return hit;
    const base = slugify(name) || 'artist';
    let slug = base;
    for (let i = 2; this.artistSlugs.has(slug); i++) slug = `${base}-${i}`;
    this.artistSlugs.add(slug);
    const aliases = this.ov.artists.aliases[name] ?? [];
    const [{ id }] = (await this.sql`
      insert into artists (slug, name, aliases) values (${slug}, ${name}, ${aliases}) returning id`) as unknown as [{ id: number }];
    this.artistIds.set(key, id);
    return id;
  }

  async findTrack(t: TrackOut): Promise<number | null> {
    const rows = await this.sql`select id, title, slug from tracks`;
    const hit = rows.find((r) => r.slug === t.slug) ?? rows.find((r) => normKey(r.title) === normKey(t.title));
    return hit?.id ?? null;
  }

  async writeTrack(t: TrackOut): Promise<number> {
    const [{ id }] = (await this.sql`
      insert into tracks (slug, title, aka, released_as, notes)
      values (${t.slug}, ${t.title}, ${t.aka}, ${t.releasedAs}, ${t.notes}) returning id`) as unknown as [{ id: number }];
    return id;
  }

  async writeEntry(trackId: number, e: EntryOut): Promise<number> {
    const [{ id }] = (await this.sql`
      insert into entries (track_id, title, version_label, kind, era_id, year, type, availability,
                           evidence, quality, status, variation, tags, notes, sort)
      values (${trackId}, ${e.title}, ${e.versionLabel}, ${e.kind}, ${this.eraIds.get(e.era ?? '') ?? null},
              ${e.year}, ${e.type}, ${e.availability}, ${e.evidence}, ${e.quality}, ${e.status},
              ${e.variation}, ${e.tags}, ${e.notes}, ${e.sort})
      returning id`) as unknown as [{ id: number }];

    let position = 0;
    for (const c of e.artists) {
      const artistId = await this.artist(c.name);
      await this.sql`
        insert into entry_artists (entry_id, artist_id, role, position, credited_as, uncertain)
        values (${id}, ${artistId}, ${c.role}, ${position++}, ${c.creditedAs ?? null}, ${c.uncertain ?? false})
        on conflict do nothing`;
    }
    await this.writeLinks(trackId, id, e);
    for (const c of e.conflicts)
      await this.sql`
        insert into private.field_conflicts (entry_id, field, sheet_a_value, sheet_b_value, chosen)
        values (${id}, ${c.field}, ${c.a}, ${c.b}, ${c.chosen})`;
    return id;
  }

  /** Sources, file links and provenance for an entry. Safe to call again with more rows. */
  async writeLinks(trackId: number, entryId: number, e: EntryOut): Promise<void> {
    const have = new Set((await this.sql`select url from sources where entry_id = ${entryId}`).map((r) => r.url));
    let sort = have.size;
    for (const s of e.sources) {
      if (have.has(s.url)) continue;
      await this.sql`
        insert into sources (track_id, entry_id, kind, label, url, sort)
        values (${trackId}, ${entryId}, ${s.kind}, ${s.label}, ${s.url}, ${sort++})`;
    }
    const files = new Set(
      (await this.sql`select url from private.file_links where entry_id = ${entryId}`).map((r) => r.url),
    );
    for (const f of e.files) {
      if (files.has(f.url)) continue;
      await this.sql`
        insert into private.file_links (entry_id, row_uid, url, host, filename, reason)
        values (${entryId}, ${this.uids.get(f.rowKey) ?? null}, ${f.url}, ${f.host}, ${f.filename}, ${f.reason})`;
    }
    for (const r of e.rows) {
      const uid = this.uids.get(r.key);
      if (uid)
        await this.sql`
          insert into private.entry_sources (entry_id, row_uid) values (${entryId}, ${uid})
          on conflict do nothing`;
    }
  }

  async writeAll(result: MergeResult): Promise<{ tracks: number; entries: number }> {
    let entries = 0;
    for (const t of result.tracks) {
      const trackId = await this.writeTrack(t);
      for (const e of t.entries) {
        await this.writeEntry(trackId, e);
        entries++;
      }
    }
    return { tracks: result.tracks.length, entries };
  }

  /** The existing entry, if any, that one of these sheet rows is already attached to. */
  async entryForRows(rowUids: number[]): Promise<number | null> {
    if (!rowUids.length) return null;
    const [hit] = await this.sql`
      select entry_id from private.entry_sources where row_uid in ${this.sql(rowUids)} limit 1`;
    return hit?.entry_id ?? null;
  }
}
