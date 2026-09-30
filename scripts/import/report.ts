// Plain-text reports for a human to review. Never prints a private URL.
import { describeChange, type Alignment } from './align.ts';
import type { MergeResult } from './merge.ts';

const short = (key: string) => key;
const h = (title: string) => `\n${title}\n${'-'.repeat(title.length)}`;

export function diffReport(al: Alignment): { text: string; pending: number } {
  const lines: string[] = [];
  const by = (s: string) => al.rows.filter((a) => a.status === s);
  const counts = {
    unchanged: by('unchanged').length, moved: by('moved').length, changed: by('changed').length,
    probably_changed: by('probably_changed').length, new: by('new').length, vanished: al.vanished.length,
  };
  lines.push(
    `Sheet rows: ${al.rows.length}. Unchanged ${counts.unchanged}, moved ${counts.moved}, ` +
      `changed ${counts.changed}, probably changed ${counts.probably_changed}, new ${counts.new}, ` +
      `vanished ${counts.vanished}.`,
  );
  if (counts.new) {
    lines.push(h('New rows (import one with --apply <key>)'));
    for (const a of by('new')) lines.push(`  ${a.row.tab} row ${a.row.n}  ${short(a.row.key)}`);
  }
  for (const [status, title] of [
    ['changed', 'Changed rows (edit the entry in Postgres if the change matters)'],
    ['probably_changed', 'Probably the same row, renamed (confirm by eye)'],
  ] as const) {
    if (!by(status).length) continue;
    lines.push(h(title));
    for (const a of by(status)) {
      lines.push(`  ${a.row.tab} row ${a.row.n}  ${short(a.row.key)}  [recognised by ${a.via}]`);
      if (a.known && a.known.identityKey !== a.row.key) lines.push(`      was ${short(a.known.identityKey)}`);
      for (const d of describeChange(a)) lines.push(`      ${d}`);
    }
  }
  if (counts.vanished) {
    lines.push(h('Vanished rows (no longer in the sheet)'));
    for (const k of al.vanished) lines.push(`  ${k.tab} row ${k.rowNumber}  ${short(k.identityKey)}`);
  }
  if (counts.moved) lines.push(`\n${counts.moved} row(s) only moved position; nothing to do.`);
  const pending = counts.changed + counts.probably_changed + counts.new + counts.vanished;
  return { text: lines.join('\n'), pending };
}

export function mergeReport(res: MergeResult): string {
  const lines: string[] = [];
  const entries = res.tracks.flatMap((t) => t.entries.map((e) => ({ t, e })));
  const name = (x: { t: { title: string }; e: { versionLabel: string | null; year: number | null } }) =>
    `${x.t.title}${x.e.versionLabel ? ` (${x.e.versionLabel})` : ''}${x.e.year ? `, ${x.e.year}` : ''}`;

  lines.push(`Catalogue: ${res.tracks.length} songs, ${entries.length} documented versions.`);
  const auto = res.matches.filter((m) => m.how === 'auto').length;
  lines.push(
    `Sheet B rows folded into a Sheet A entry: ${res.matches.length} (${auto} matched automatically, ` +
      `${res.matches.length - auto} by overrides).`,
  );

  if (res.problems.length) {
    lines.push(h('PROBLEMS: overrides that no longer match the sheets'));
    for (const p of res.problems) lines.push(`  ${p}`);
  }
  if (res.undecided.length) {
    lines.push(h('UNDECIDED: Sheet B rows sharing a title with a Sheet A row'));
    lines.push('  Add each to same_entry or distinct in data/overrides.yaml.');
    for (const u of res.undecided) lines.push(`  ${short(u.b)}\n      candidates: ${u.candidates.map(short).join(', ')}`);
  }
  if (res.skipped.length) {
    lines.push(h('Skipped rows'));
    for (const s of res.skipped) lines.push(`  ${short(s.key)}\n      ${s.reason}`);
  }

  const conflicts = entries.filter((x) => x.e.conflicts.length);
  if (conflicts.length) {
    lines.push(h('Where the sheets disagree (kept value last)'));
    for (const x of conflicts)
      for (const c of x.e.conflicts)
        lines.push(`  ${name(x)}: ${c.field}: A says ${c.a}, B says ${c.b} -> ${c.chosen}`);
  }

  const released = res.tracks.filter((t) => t.releasedAs);
  if (released.length) {
    lines.push(h('Marked as officially released (editorial; please check)'));
    for (const t of released) lines.push(`  ${t.title}  ->  ${t.releasedAs}`);
  }

  const multi = res.tracks.filter((t) => t.entries.length > 1);
  lines.push(h('Songs with more than one version'));
  for (const t of multi)
    lines.push(`  ${t.title} (${t.entries.length}): ${t.entries.map((e) => e.versionLabel ?? (e.title !== t.title ? e.title : e.kind === 'track' ? 'untitled version' : e.kind)).join(' | ')}`);

  const pub = entries.flatMap((x) => x.e.sources.map((s) => ({ x, s })));
  const priv = entries.flatMap((x) => x.e.files.map((f) => ({ x, f })));
  lines.push(h('Links'));
  lines.push(`  Public citations: ${pub.length}. Private (never rendered): ${priv.length}.`);
  const hosts = (list: string[]) => {
    const c = new Map<string, number>();
    for (const x of list) c.set(x, (c.get(x) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  };
  lines.push(`  Public hosts: ${hosts(pub.map((p) => new URL(p.s.url).host.replace(/^www\./, '')))}`);
  lines.push(`  Private hosts: ${hosts(priv.map((p) => p.f.host))}`);
  const odd = priv.filter((p) => p.f.reason !== 'file host');
  if (odd.length) {
    lines.push('  Kept private for a reason other than being a file host:');
    for (const p of odd) lines.push(`    ${name(p.x)}: ${p.f.host} (${p.f.reason})`);
  }

  const flagged = entries.filter((x) => x.e.flags.some((f) => !f.startsWith('link kept private')));
  if (flagged.length) {
    lines.push(h('Flagged for a look'));
    for (const x of flagged)
      lines.push(`  ${name(x)}: ${x.e.flags.filter((f) => !f.startsWith('link kept private')).join('; ')}`);
  }
  return lines.join('\n');
}
