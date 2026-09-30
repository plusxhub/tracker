export type Availability = 'none' | 'snippet' | 'partial' | 'full' | 'og_file' | 'circulating';
export type Role = 'main' | 'feat' | 'prod' | 'with' | 'remixer' | 'original_artist' | 'vocalist' | 'unknown';

export interface Era {
  slug: string;
  name: string;
}

export interface Credit {
  slug: string;
  name: string;
  role: Role;
  creditedAs: string | null;
  uncertain: boolean;
}

export interface Source {
  kind: string;
  label: string;
  url: string;
  host: string;
}

export interface Entry {
  id: number;
  title: string;
  versionLabel: string | null;
  kind: string;
  era: Era | null;
  year: number | null;
  type: string | null;
  availability: Availability;
  evidence: 'confirmed' | 'rumored' | null;
  quality: string | null;
  status: string | null;
  variation: string | null;
  tags: string[];
  notes: string | null;
  credits: Credit[];
  sources: Source[];
  createdAt: string;
}

export interface Track {
  id: number;
  slug: string;
  title: string;
  aka: string[];
  releasedAs: string | null;
  notes: string | null;
  entries: Entry[];
  // Derived from the entries:
  year: number | null;
  era: Era | null;
  /** Byline credits, taken from the earliest version. */
  credits: Credit[];
  tags: string[];
  /** The most complete availability among the versions. */
  best: Availability;
  placeholder: boolean;
  createdAt: string;
}

export interface Artist {
  slug: string;
  name: string;
  aliases: string[];
  trackSlugs: string[];
  entryCount: number;
}

export interface TimelineEvent {
  year: number;
  kind: 'event' | 'blurb';
  dateText: string | null;
  body: string;
}

export interface GlossaryTerm {
  category: string;
  slug: string;
  term: string;
  definition: string;
}

export interface Stats {
  tracks: number;
  entries: number;
  full: number;
  unheard: number;
  collaborators: number;
  firstYear: number;
  lastYear: number;
}

export interface Catalogue {
  tracks: Track[];
  bySlug: Map<string, Track>;
  artists: Artist[];
  artistBySlug: Map<string, Artist>;
  eras: Era[];
  timeline: TimelineEvent[];
  glossary: GlossaryTerm[];
  stats: Stats;
  loadedAt: number;
}
