# ID Tracker

A catalogue of Martin Garrix's unreleased music, served at
[tracker.plusxhub.com](https://tracker.plusxhub.com): every documented ID, demo
and alternate version, with who was involved, where it was played and how much
of it has been heard.

The site is a reference. It hosts no audio and links to none.

## How it fits together

```
Google Sheets ──xlsx──▶ importer ──▶ Postgres ◀── Astro (SSR) ──▶ Traefik
                                     martin_garrix_tracker
```

- **Postgres is the source of truth.** Two fan-maintained sheets were merged
  into it once. Edits happen in the database from then on.
- **The site reads a snapshot** of the whole catalogue, refreshed at most once a
  minute. An edit in Postgres is live within that minute; nothing is rebuilt.
- **Two roles.** `tracker_owner` runs migrations and the importer.
  `tracker_web`, which the site connects as, can only `SELECT` from the `public`
  schema. Links to audio files and the raw sheet rows live in the `private`
  schema, which `tracker_web` cannot read.

| Path | What it is |
|---|---|
| `db/migrations/` | Plain SQL, applied in order by `bun run db:migrate` |
| `db/bootstrap.sql` | One-off creation of the database and both roles |
| `scripts/import/` | The sheet importer |
| `data/overrides.yaml` | Curated decisions the sheets cannot express |
| `src/lib/catalogue.ts` | Loads and caches the catalogue for the site |
| `src/pages/`, `src/components/` | The site |
| `deploy/docker-compose.yml` | The stack as it runs on the server |

## Running it locally

Needs [Bun](https://bun.sh) and a Postgres server.

```sh
bun install

# once, as a Postgres superuser
psql -v owner_password=... -v web_password=... -f db/bootstrap.sql

cp .env.example .env        # fill in the two passwords
bun run db:migrate
bun run import --init       # first import into the empty database
bun run dev
```

`bun test scripts` runs the importer's tests, `bun run check` type-checks.

## The data model

A **track** is a song. An **entry** is one documented version of it: a demo, a
live edit, an early vocal. Artists, year, era and the editors' tags belong to
the entry, because they differ between versions of the same song.

Each entry records how much audio circulates (`availability`: none, snippet,
partial, full, og_file, or `circulating` when a copy exists but its extent was
never documented) and, for versions nobody has heard, how solid the evidence is
(`evidence`: confirmed or rumored).

`sources` holds public citations only. Anything pointing at an audio file is in
`private.file_links`.

## The importer

```sh
bun run import              # compare the sheets with what was last recorded; writes nothing
bun run import --apply KEY  # import one new sheet row
bun run import --ack        # record the sheets' current state as reviewed
bun run import --dry-run    # run the whole pipeline and print the merge report; no database
bun run import --keys       # list row identity keys
```

The importer never overwrites the catalogue. After the first import it only
reports what changed in the sheets: new rows, changed rows, rows that merely
moved, rows that vanished. Rows are recognised across runs by content, then by
the file they point to, then by artist and title, so an editor inserting a row
does not make everything below it look changed.

What the sheets cannot express is decided in `data/overrides.yaml`: which rows in
the two sheets are the same recording, which versions belong to the same song
under different titles, spelling fixes, and which citation links stay private.
Rows are referenced there by identity key, never by URL.

Links are private unless their host is on the allowlist in
`scripts/import/links.ts`. File hosts are always private.

## Deploying

Pushing to `main` builds `ghcr.io/plusxhub/tracker:main`. The server runs
`deploy/docker-compose.yml` from `~/docker/tracker/`, behind Traefik, and picks
up new images by digest.

The image contains code only. Schema changes and imports are run from a
checkout, as `tracker_owner`:

```sh
DATABASE_OWNER_URL=postgres://tracker_owner:...@<host>:5432/martin_garrix_tracker bun run db:migrate
```

## Affiliation

A fan project. Not affiliated with Martin Garrix, STMPD RCRDS or any label.
