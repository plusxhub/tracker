// Decides which hyperlinks may appear on the public site. The sheets mix
// citations and links to leaked audio in the same columns, so the column a link
// came from proves nothing. Everything is private unless its host is on the
// allowlist, and a few allowlisted hosts are private when they host the audio.

export type SourceKind = 'video' | 'tracklist' | 'article' | 'social' | 'forum' | 'audio' | 'other';

export interface LinkVerdict {
  visibility: 'public' | 'private';
  host: string;
  kind: SourceKind;
  /** Stable id of the hosted file, used to recognise a row after it moves. */
  anchor?: string;
  reason: string;
}

const PUBLIC_HOSTS: Record<string, SourceKind> = {
  'youtube.com': 'video',
  'youtu.be': 'video',
  '1001tracklists.com': 'tracklist',
  'twitter.com': 'social',
  'x.com': 'social',
  'instagram.com': 'social',
  'reddit.com': 'forum',
  'billboard.com': 'article',
  'edm.com': 'article',
  'dancingastronaut.com': 'article',
  'youredm.com': 'article',
  'weraveyou.com': 'article',
  'thisisedm.it': 'article',
  'guettapen.com': 'article',
  'capitalxtra.com': 'article',
  'capitalfm.com': 'article',
  'dancemusicnw.com': 'article',
  'thesun.co.uk': 'article',
  'isaechia.it': 'article',
  'medium.com': 'article',
};

const FILE_ANCHORS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/, (m) => `drive:${m[1]}`],
  [/imgur\.gg\/f\/([\w-]+)/, (m) => `imgur.gg:${m[1]}`],
  [/pillows\.su\/f\/([\w-]+)/, (m) => `pillows:${m[1]}`],
  [/krakenfiles\.com\/view\/([\w-]+)/, (m) => `kraken:${m[1]}`],
];

/** A curated per-row decision that overrides the host default. */
export type LinkForce = 'public' | 'private' | undefined;

export function fileAnchor(url: string): string | undefined {
  for (const [re, fn] of FILE_ANCHORS) {
    const m = re.exec(url);
    if (m) return fn(m);
  }
  return undefined;
}

function registrable(host: string): string {
  const h = host.toLowerCase().replace(/^(www|m|mobile|old|music)\./, '');
  const known = Object.keys(PUBLIC_HOSTS).find((k) => h === k || h.endsWith(`.${k}`));
  return known ?? h;
}

export function classifyLink(url: string, label = '', force?: LinkForce): LinkVerdict {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return { visibility: 'private', host: '', kind: 'other', reason: 'unparseable url' };
  }
  const anchor = fileAnchor(url);
  const base = registrable(host);
  const kind: SourceKind = PUBLIC_HOSTS[base] ?? (base === 'soundcloud.com' ? 'audio' : 'other');

  if (anchor) return { visibility: 'private', host, kind, anchor, reason: 'file host' };
  if (force === 'private')
    return { visibility: 'private', host, kind, reason: 'row listed private in overrides' };
  if (force === 'public')
    return { visibility: 'public', host, kind, reason: 'row listed public in overrides' };
  if (/\bdownload\b/i.test(label) || /\bdownload\b/i.test(url))
    return { visibility: 'private', host, kind, reason: 'label or url mentions download' };
  if (base in PUBLIC_HOSTS) return { visibility: 'public', host, kind, reason: 'allowlisted host' };
  return { visibility: 'private', host, kind, reason: 'host not on allowlist' };
}

const URL_RE = /https?:\/\/[^\s)>\]]+/g;

/** Remove URLs from free text, returning them separately. */
export function stripUrls(text: string): { text: string; urls: string[] } {
  const urls = text.match(URL_RE) ?? [];
  const cleaned = text
    .replace(URL_RE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,;])/g, '$1')
    .trim();
  return { text: cleaned, urls: urls.map((u) => u.replace(/[.,;]+$/, '')) };
}

const HOST_LABEL: Record<string, string> = {
  'youtube.com': 'Video on YouTube',
  'youtu.be': 'Video on YouTube',
  '1001tracklists.com': 'Tracklist on 1001Tracklists',
  'twitter.com': 'Post on Twitter',
  'x.com': 'Post on X',
  'instagram.com': 'Post on Instagram',
  'reddit.com': 'Reddit thread',
  'soundcloud.com': 'SoundCloud',
};

/** A readable label for a citation: the cell text minus URLs and site-name tails. */
export function sourceLabel(cellText: string, url: string): string {
  let label = stripUrls(cellText).text;
  label = label
    .replace(/\s*[-|–]\s*(YouTube|EDM\.com|Billboard|Your EDM|We Rave You|Capital( XTRA)?|Dancing Astronaut|The Sun)\s*$/i, '')
    .replace(/\s*\|\s*Listen online for free on SoundCloud\s*$/i, '')
    .replace(/^Stream\s+/i, '')
    .replace(/\s*:\s*r\/\w+\s*$/i, '')
    .trim();
  if (label && !/^n\/?d$/i.test(label)) return label;
  try {
    const base = registrable(new URL(url).host);
    return HOST_LABEL[base] ?? base;
  } catch {
    return 'Source';
  }
}
