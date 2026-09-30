-- Catalogue of documented unreleased Martin Garrix music.
--
-- public  : what the site may show.
-- private : links to audio files and the raw sheet rows the catalogue was
--           built from. tracker_web has no privileges here.

create schema private;
revoke all on schema private from public;

create table eras (
  id    smallint generated always as identity primary key,
  slug  text not null unique,
  name  text not null,
  sort  smallint not null
);

create table timeline_events (
  id         integer generated always as identity primary key,
  year       smallint,
  era_id     smallint references eras,
  kind       text not null check (kind in ('event', 'blurb')),
  date_text  text,
  body       text not null,
  sort       smallint not null default 0
);

-- One song. Deliberately thin: everything that varies between versions lives
-- on entries.
create table tracks (
  id           integer generated always as identity primary key,
  slug         text not null unique,
  title        text not null,
  aka          text[] not null default '{}',
  released_as  text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One documented version of a song.
create table entries (
  id             integer generated always as identity primary key,
  track_id       integer not null references tracks on delete cascade,
  title          text not null,
  version_label  text,
  kind           text not null default 'track' check (kind in
                   ('track', 'stems', 'instrumental', 'acapella', 'session', 'multitrack', 'tv_track')),
  era_id         smallint references eras,
  year           smallint check (year between 1996 and 2100),
  type           text check (type in
                   ('demo', 'ref_track', 'og', 'throwaway', 'production', 'feature', 'remix',
                    'album_track', 'other', 'unknown')),
  -- How much audio circulates. 'circulating' = a copy exists, extent undocumented.
  availability   text not null default 'none' check (availability in
                   ('none', 'snippet', 'partial', 'full', 'og_file', 'circulating')),
  -- For entries nobody has heard: how sure we are it exists.
  evidence       text check (evidence in ('confirmed', 'rumored')),
  quality        text check (quality in ('recording', 'abysmal', 'low', 'high', 'cd', 'lossless')),
  status         text check (status in ('unknown', 'cancelled', 'in_progress', 'released')),
  variation      text,
  tags           text[] not null default '{}',
  notes          text,
  sort           integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index entries_track_id_idx on entries (track_id);
create index entries_year_idx on entries (year);

create table artists (
  id       integer generated always as identity primary key,
  slug     text not null unique,
  name     text not null,
  aliases  text[] not null default '{}'
);

create table entry_artists (
  entry_id     integer not null references entries on delete cascade,
  artist_id    integer not null references artists,
  role         text not null check (role in
                 ('main', 'feat', 'prod', 'with', 'remixer', 'original_artist', 'vocalist', 'unknown')),
  position     smallint not null,
  credited_as  text,
  uncertain    boolean not null default false,
  primary key (entry_id, artist_id, role)
);
create index entry_artists_artist_id_idx on entry_artists (artist_id);

-- Public citations only: live-set videos, tracklists, articles, posts.
create table sources (
  id        integer generated always as identity primary key,
  track_id  integer not null references tracks on delete cascade,
  entry_id  integer references entries on delete cascade,
  kind      text not null check (kind in
              ('video', 'tracklist', 'article', 'social', 'forum', 'audio', 'other')),
  label     text not null,
  url       text not null,
  sort      smallint not null default 0
);
create index sources_entry_id_idx on sources (entry_id);

create table glossary (
  id          integer generated always as identity primary key,
  category    text not null,
  slug        text not null,
  term        text not null,
  definition  text not null,
  sort        smallint not null default 0,
  unique (category, slug)
);

-- ---------------------------------------------------------------------------

create table private.import_runs (
  id          integer generated always as identity primary key,
  started_at  timestamptz not null default now(),
  mode        text not null,
  summary     jsonb not null default '{}'
);

-- One row per sheet row ever seen. row_uid is the stable identity; the row
-- number is only where it sat on a given run.
create table private.import_rows (
  row_uid        integer generated always as identity primary key,
  tab            text not null,
  identity_key   text not null,
  file_anchor    text,
  first_run_id   integer not null references private.import_runs,
  last_run_id    integer not null references private.import_runs,
  vanished       boolean not null default false
);
create index import_rows_tab_idx on private.import_rows (tab);

create table private.import_row_versions (
  id               integer generated always as identity primary key,
  row_uid          integer not null references private.import_rows on delete cascade,
  run_id           integer not null references private.import_runs,
  row_number       integer not null,
  section_context  jsonb not null,
  cells            jsonb not null,
  content_hash     text not null
);
create index import_row_versions_row_uid_idx on private.import_row_versions (row_uid, id desc);

create table private.entry_sources (
  entry_id  integer not null references public.entries on delete cascade,
  row_uid   integer not null references private.import_rows on delete cascade,
  primary key (entry_id, row_uid)
);

create table private.file_links (
  id        integer generated always as identity primary key,
  entry_id  integer not null references public.entries on delete cascade,
  row_uid   integer references private.import_rows on delete set null,
  url       text not null,
  host      text not null,
  filename  text,
  reason    text
);

-- Where the two sheets disagreed and which value was kept.
create table private.field_conflicts (
  id             integer generated always as identity primary key,
  entry_id       integer not null references public.entries on delete cascade,
  field          text not null,
  sheet_a_value  text,
  sheet_b_value  text,
  chosen         text
);

-- ---------------------------------------------------------------------------

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger tracks_updated_at before update on tracks
  for each row execute function set_updated_at();
create trigger entries_updated_at before update on entries
  for each row execute function set_updated_at();

grant usage on schema public to tracker_web;
grant select on all tables in schema public to tracker_web;
alter default privileges in schema public grant select on tables to tracker_web;
