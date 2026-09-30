import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { AVAILABILITY, QUALITY, TAG, TYPE } from '../lib/labels';
import { bestOf, type RowEntry, type RowTrack } from '../lib/rows';
import type { Availability } from '../lib/types';
import { TrackRow } from './ui';

interface Option {
  value: string;
  label: string;
}

interface Props {
  tracks: RowTrack[];
  eras: Option[];
  artists: Option[];
}

type Multi = 'era' | 'type' | 'avail' | 'quality' | 'tag';
const MULTI: Multi[] = ['era', 'type', 'avail', 'quality', 'tag'];

interface State {
  q: string;
  era: string[];
  type: string[];
  avail: string[];
  quality: string[];
  tag: string[];
  artist: string;
  show: 'unreleased' | 'stems' | 'all';
  from: string;
  to: string;
  sort: 'year' | 'year-desc' | 'title' | 'versions' | 'added';
}

const EMPTY: State = {
  q: '', era: [], type: [], avail: [], quality: [], tag: [], artist: '', show: 'unreleased',
  from: '', to: '', sort: 'year',
};

function read(search: string): State {
  const p = new URLSearchParams(search);
  const list = (k: string) => (p.get(k) ? p.get(k)!.split(',').filter(Boolean) : []);
  return {
    q: p.get('q') ?? '',
    era: list('era'), type: list('type'), avail: list('avail'), quality: list('quality'), tag: list('tag'),
    artist: p.get('artist') ?? '',
    show: (['unreleased', 'stems', 'all'].includes(p.get('show') ?? '') ? p.get('show') : 'unreleased') as State['show'],
    from: p.get('from') ?? '', to: p.get('to') ?? '',
    sort: (['year', 'year-desc', 'title', 'versions', 'added'].includes(p.get('sort') ?? '') ? p.get('sort') : 'year') as State['sort'],
  };
}

function write(s: State): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  for (const k of MULTI) if (s[k].length) p.set(k, s[k].join(','));
  if (s.artist) p.set('artist', s.artist);
  if (s.show !== 'unreleased') p.set('show', s.show);
  if (s.from) p.set('from', s.from);
  if (s.to) p.set('to', s.to);
  if (s.sort !== 'year') p.set('sort', s.sort);
  const out = p.toString();
  return out ? `?${out}` : '';
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Does one version satisfy every entry-level filter, optionally ignoring one facet (for counts)? */
function entryMatches(e: RowEntry, s: State, skip?: Multi | 'artist'): boolean {
  if (s.show === 'unreleased' && e.kind !== 'track') return false;
  if (s.show === 'stems' && e.kind === 'track') return false;
  if (skip !== 'era' && s.era.length && !s.era.includes(e.era ?? 'unknown')) return false;
  if (skip !== 'type' && s.type.length && !s.type.includes(e.type ?? '')) return false;
  if (skip !== 'avail' && s.avail.length && !s.avail.includes(e.availability)) return false;
  if (skip !== 'quality' && s.quality.length && !s.quality.includes(e.quality ?? '')) return false;
  if (skip !== 'tag' && s.tag.length && !s.tag.some((t) => e.tags.includes(t))) return false;
  if (skip !== 'artist' && s.artist && !e.artists.includes(s.artist)) return false;
  if (s.from && (e.year == null || e.year < Number(s.from))) return false;
  if (s.to && (e.year == null || e.year > Number(s.to))) return false;
  return true;
}

function Facet({ title, options, selected, counts, onToggle }: {
  title: string;
  options: Option[];
  selected: string[];
  counts: Map<string, number>;
  onToggle: (v: string) => void;
}) {
  return (
    <fieldset className="border-t border-line py-4">
      <legend className="eyebrow float-left mb-2.5 w-full">{title}</legend>
      <div className="clear-both flex flex-col gap-0.5">
        {options.map((o) => {
          const n = counts.get(o.value) ?? 0;
          const on = selected.includes(o.value);
          if (!n && !on) return null;
          return (
            <label key={o.value} className={`flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-[13px] transition-colors hover:bg-raised ${on ? 'text-fg' : 'text-muted'}`}>
              <input type="checkbox" checked={on} onChange={() => onToggle(o.value)} className="peer sr-only" />
              <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent ${on ? 'border-accent bg-accent' : 'border-line-strong'}`}>
                {on && <span className="h-1.5 w-1.5 rounded-[1px] bg-ink" />}
              </span>
              <span className="flex-1">{o.label}</span>
              <span className="font-mono text-[11px] tabular-nums text-faint">{n}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function Browser({ tracks, eras, artists }: Props) {
  const [s, setS] = useState<State>(EMPTY);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // The URL is the source of truth, so filtered views can be shared and the back button works.
  useEffect(() => {
    setS(read(window.location.search));
    setReady(true);
    const onPop = () => setS(read(window.location.search));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => {
    if (ready) window.history.replaceState(null, '', window.location.pathname + write(s));
  }, [s, ready]);

  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));
  const toggle = (k: Multi) => (v: string) =>
    setS((prev) => ({ ...prev, [k]: prev[k].includes(v) ? prev[k].filter((x) => x !== v) : [...prev[k], v] }));

  const terms = useMemo(() => fold(s.q).split(/\s+/).filter(Boolean), [s.q]);
  const textMatch = (t: RowTrack) => terms.every((w) => t.haystack.includes(w));

  const results = useMemo(() => {
    const out: { t: RowTrack; best: Availability; hits: number }[] = [];
    for (const t of tracks) {
      if (!textMatch(t)) continue;
      const hits = t.entries.filter((e) => entryMatches(e, s));
      if (hits.length) out.push({ t, best: bestOf(hits.map((e) => e.availability)), hits: hits.length });
    }
    const title = (t: RowTrack) => fold(t.title);
    const cmp: Record<State['sort'], (a: (typeof out)[0], b: (typeof out)[0]) => number> = {
      year: (a, b) => (a.t.year ?? 9999) - (b.t.year ?? 9999),
      'year-desc': (a, b) => (b.t.year ?? -1) - (a.t.year ?? -1),
      title: (a, b) => title(a.t).localeCompare(title(b.t)),
      versions: (a, b) => b.t.entries.length - a.t.entries.length,
      added: (a, b) => b.t.addedAt.localeCompare(a.t.addedAt) || (b.t.year ?? -1) - (a.t.year ?? -1),
    };
    return [...out].sort(cmp[s.sort]);
  }, [tracks, s, terms]);

  // Each facet counts songs as if its own selection were cleared, so options never count themselves out.
  const counts = useMemo(() => {
    const make = (facet: Multi | 'artist', pick: (e: RowEntry) => string[]) => {
      const m = new Map<string, number>();
      for (const t of tracks) {
        if (!textMatch(t)) continue;
        const seen = new Set<string>();
        for (const e of t.entries) if (entryMatches(e, s, facet)) for (const v of pick(e)) seen.add(v);
        for (const v of seen) m.set(v, (m.get(v) ?? 0) + 1);
      }
      return m;
    };
    return {
      era: make('era', (e) => [e.era ?? 'unknown']),
      type: make('type', (e) => (e.type ? [e.type] : [])),
      avail: make('avail', (e) => [e.availability]),
      quality: make('quality', (e) => (e.quality ? [e.quality] : [])),
      tag: make('tag', (e) => e.tags),
      artist: make('artist', (e) => e.artists),
    };
  }, [tracks, s, terms]);

  const years = useMemo(() => {
    const ys = tracks.flatMap((t) => t.entries.map((e) => e.year)).filter((y): y is number => y != null);
    const out: number[] = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) out.push(y);
    return out;
  }, [tracks]);

  const active =
    MULTI.reduce((n, k) => n + s[k].length, 0) + (s.artist ? 1 : 0) + (s.from || s.to ? 1 : 0) + (s.show !== 'unreleased' ? 1 : 0);
  const opt = (map: Record<string, string | { label: string }>, order?: string[]) =>
    (order ?? Object.keys(map)).map((value) => {
      const v = map[value]!;
      return { value, label: typeof v === 'string' ? v : v.label };
    });

  const select = 'h-9 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg focus:border-accent focus:outline-none';
  const artistOptions = artists.filter((a) => (counts.artist.get(a.value) ?? 0) > 0 || a.value === s.artist);

  const filters = (
    <>
      <fieldset className="pb-4">
        <legend className="eyebrow mb-2.5">Show</legend>
        <div className="grid grid-cols-3 rounded-md border border-line-strong p-0.5 text-[12px]">
          {([['unreleased', 'Songs'], ['stems', 'Stems'], ['all', 'All']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => set({ show: v })} aria-pressed={s.show === v}
              className={`rounded-[5px] py-1.5 transition-colors ${s.show === v ? 'bg-fg text-ink' : 'text-muted hover:text-fg'}`}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <Facet title="Highlights" options={opt(TAG, ['grail', 'best_of'])} selected={s.tag} counts={counts.tag} onToggle={toggle('tag')} />
      <Facet title="Era" options={eras} selected={s.era} counts={counts.era} onToggle={toggle('era')} />
      <fieldset className="border-t border-line py-4">
        <legend className="eyebrow float-left mb-2.5 w-full">Years</legend>
        <div className="clear-both flex items-center gap-2">
          <select aria-label="From year" value={s.from} onChange={(e) => set({ from: e.target.value })} className={`${select} flex-1`}>
            <option value="">From</option>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
          <span className="text-faint">–</span>
          <select aria-label="To year" value={s.to} onChange={(e) => set({ to: e.target.value })} className={`${select} flex-1`}>
            <option value="">To</option>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </div>
      </fieldset>
      <Facet title="How much exists" options={opt(AVAILABILITY, ['og_file', 'full', 'partial', 'snippet', 'circulating', 'none'])} selected={s.avail} counts={counts.avail} onToggle={toggle('avail')} />
      <Facet title="Type" options={opt(TYPE)} selected={s.type} counts={counts.type} onToggle={toggle('type')} />
      <Facet title="Quality" options={opt(QUALITY)} selected={s.quality} counts={counts.quality} onToggle={toggle('quality')} />
      <fieldset className="border-t border-line py-4">
        <legend className="eyebrow float-left mb-2.5 w-full">Collaborator</legend>
        <select aria-label="Collaborator" value={s.artist} onChange={(e) => set({ artist: e.target.value })} className={`${select} clear-both w-full`}>
          <option value="">Anyone</option>
          {artistOptions.map((a) => (
            <option key={a.value} value={a.value}>{a.label} ({counts.artist.get(a.value) ?? 0})</option>
          ))}
        </select>
      </fieldset>
    </>
  );

  return (
    <div className="grid gap-x-10 lg:grid-cols-[15rem_1fr]">
      <aside className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">{filters}</div>
      </aside>

      <div className="min-w-0">
        <div className="sticky top-14 z-20 -mx-1 flex items-center gap-2 bg-ink/90 px-1 py-3 backdrop-blur-md">
          <label className="relative flex-1">
            <span className="sr-only">Search the catalogue</span>
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={input} type="search" value={s.q} onChange={(e) => set({ q: e.target.value })}
              placeholder="Search a title, collaborator or festival" autoComplete="off"
              className="h-11 w-full rounded-lg border border-line-strong bg-panel pl-10 pr-10 text-[14px] text-fg placeholder:text-faint focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {s.q ? (
              <button type="button" onClick={() => set({ q: '' })} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-fg">
                <X size={15} />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line-strong px-1.5 font-mono text-[10px] text-faint sm:block">/</kbd>
            )}
          </label>
          <select aria-label="Sort" value={s.sort} onChange={(e) => set({ sort: e.target.value as State['sort'] })} className={`${select} hidden h-11 sm:block`}>
            <option value="year">Oldest first</option>
            <option value="year-desc">Newest first</option>
            <option value="title">Title A–Z</option>
            <option value="versions">Most versions</option>
            <option value="added">Recently added</option>
          </select>
          <button type="button" onClick={() => setOpen(true)} className="flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-panel px-3.5 text-[13px] lg:hidden">
            <SlidersHorizontal size={15} /> Filters{active ? <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] text-ink">{active}</span> : null}
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 pb-2 pt-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint" aria-live="polite">
            {results.length} {results.length === 1 ? 'song' : 'songs'}
            {results.length !== tracks.length && ` of ${tracks.length}`}
          </p>
          {(active > 0 || s.q) && (
            <button type="button" onClick={() => setS({ ...EMPTY, sort: s.sort })} className="link text-[12px]">Clear all</button>
          )}
        </div>

        {results.length ? (
          <div className="border-t border-line">
            {results.map(({ t, best }) => <TrackRow key={t.slug} t={t} best={best} />)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
            <p className="display-sm text-lg">Nothing matches</p>
            <p className="mx-auto mt-2 max-w-sm text-[13px] text-muted">
              No documented ID fits that combination. Try fewer filters, or check the spelling of the search.
            </p>
            <button type="button" onClick={() => setS({ ...EMPTY, sort: s.sort })} className="mt-5 rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-ink">
              Clear filters
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button type="button" aria-label="Close filters" className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line-strong bg-ink px-5 pb-24 pt-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="display-sm text-lg">Filters</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1.5 text-muted hover:text-fg"><X size={18} /></button>
            </div>
            <label className="mb-4 block">
              <span className="eyebrow mb-2 block">Sort</span>
              <select value={s.sort} onChange={(e) => set({ sort: e.target.value as State['sort'] })} className={`${select} w-full`}>
                <option value="year">Oldest first</option>
                <option value="year-desc">Newest first</option>
                <option value="title">Title A–Z</option>
                <option value="versions">Most versions</option>
                <option value="added">Recently added</option>
              </select>
            </label>
            {filters}
            <div className="fixed inset-x-0 bottom-0 border-t border-line bg-ink p-4">
              <button type="button" onClick={() => setOpen(false)} className="h-11 w-full rounded-lg bg-accent text-[14px] font-semibold text-ink">
                Show {results.length} {results.length === 1 ? 'song' : 'songs'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
