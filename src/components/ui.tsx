import { Star, Trophy } from 'lucide-react';
import { AVAILABILITY, QUALITY } from '../lib/labels';
import type { RowTrack } from '../lib/rows';
import type { Availability } from '../lib/types';

const AVAIL_COLOR: Record<Availability, string> = {
  og_file: 'var(--color-full)',
  full: 'var(--color-full)',
  partial: 'var(--color-partial)',
  snippet: 'var(--color-snippet)',
  circulating: 'var(--color-circ)',
  none: 'var(--color-none)',
};

/** How many of the four segments are lit. "Circulating" means extent unknown, so it is drawn hollow. */
const SEGMENTS: Record<Availability, number> = { og_file: 4, full: 3, partial: 2, snippet: 1, circulating: 0, none: 0 };

/** Four-step gauge: snippet, partial, full, original file. */
export function Meter({ value, className = '' }: { value: Availability; className?: string }) {
  const lit = SEGMENTS[value];
  const color = AVAIL_COLOR[value];
  return (
    <span className={`inline-flex items-end gap-[3px] ${className}`} role="img" aria-label={AVAILABILITY[value].label}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[5px] rounded-[1px]"
          style={{
            height: `${7 + i * 3}px`,
            background: i < lit ? color : 'transparent',
            boxShadow: i < lit ? 'none' : `inset 0 0 0 1px ${value === 'circulating' ? color : 'var(--color-line-strong)'}`,
          }}
        />
      ))}
    </span>
  );
}

export function AvailabilityLabel({ value, short = false }: { value: Availability; short?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em]" style={{ color: value === 'none' ? 'var(--color-faint)' : AVAIL_COLOR[value] }}>
      <Meter value={value} />
      {short ? AVAILABILITY[value].short : AVAILABILITY[value].label}
    </span>
  );
}

export function Chip({ children, tone = 'default', title }: { children: React.ReactNode; tone?: 'default' | 'accent' | 'gold' | 'muted'; title?: string }) {
  const tones = {
    default: 'border-line-strong text-fg/85',
    accent: 'border-accent/50 text-accent',
    gold: 'border-gold/50 text-gold',
    muted: 'border-line text-muted',
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] font-mono text-[10.5px] uppercase leading-none tracking-[0.08em] whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function TagMarks({ tags, size = 13 }: { tags: string[]; size?: number }) {
  return (
    <>
      {tags.includes('grail') && (
        <span title="Grail: one of the most wanted" className="text-gold inline-flex shrink-0">
          <Trophy size={size} strokeWidth={2.2} aria-label="Grail" />
        </span>
      )}
      {tags.includes('best_of') && (
        <span title="Best of: an editors' pick" className="text-accent inline-flex shrink-0">
          <Star size={size} strokeWidth={2.2} fill="currentColor" aria-label="Best of" />
        </span>
      )}
    </>
  );
}

export function QualityText({ value }: { value: string | null }) {
  if (!value) return null;
  return <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{QUALITY[value] ?? value}</span>;
}

/** One song in a list. Used server-side on static lists and client-side in the browser. */
export function TrackRow({ t, showYear = true, best, compact = false }: { t: RowTrack; showYear?: boolean; best?: Availability; compact?: boolean }) {
  const versions = t.entries.length;
  return (
    <a
      href={`/tracks/${t.slug}`}
      className="group grid grid-cols-[1fr_auto] items-center gap-x-4 border-b border-line px-1 py-3.5 transition-colors hover:bg-panel sm:grid-cols-[3.5rem_1fr_auto] sm:px-3"
    >
      {showYear && (
        <span className="hidden font-mono text-xs tabular-nums text-faint sm:block">{t.year ?? '—'}</span>
      )}
      <span className={`min-w-0 ${showYear ? '' : 'sm:col-span-2'}`}>
        <span className="flex items-center gap-2">
          <span className="display-sm truncate text-[1.05rem] text-fg transition-colors group-hover:text-accent">{t.title}</span>
          <TagMarks tags={t.tags} />
          {t.released && !compact && (
            <span className="hidden sm:inline-flex">
              <Chip tone="muted" title="A version of this song was officially released">Released</Chip>
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">
          {showYear && <span className="font-mono text-xs text-faint sm:hidden">{t.year ?? '—'} · </span>}
          {t.byline}
        </span>
      </span>
      <span className="flex items-center gap-4">
        {versions > 1 && !compact && <span className="hidden font-mono text-[11px] uppercase tracking-[0.08em] text-faint md:inline">{versions} versions</span>}
        <span className="w-[6.5rem] sm:w-[7.25rem]">
          <AvailabilityLabel value={best ?? t.best} short />
        </span>
      </span>
    </a>
  );
}
