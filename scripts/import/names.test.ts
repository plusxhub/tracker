import { describe, expect, test } from 'bun:test';
import { isPlaceholderTitle, parseFeatureCell, parseName, parseTitle, splitArtists } from './names.ts';

const ACTS = ['Matisse & Sadko', 'Axwell /\\ Ingrosso', 'Vargas & Lagola', 'Bono & The Edge'];
const names = (cs: { name: string; role: string }[], role: string) =>
  cs.filter((c) => c.role === role).map((c) => c.name);

describe('parseName', () => {
  test('emoji glued to the name, multi-line feat with padding', () => {
    const p = parseName('🏆Martin Garrix & Avicii - Lost Angeles\n( feat. Ali Tamposi )', ACTS);
    expect(p.tags).toEqual(['grail']);
    expect(p.title).toBe('Lost Angeles');
    expect(names(p.artists, 'main')).toEqual(['Martin Garrix', 'Avicii']);
    expect(names(p.artists, 'feat')).toEqual(['Ali Tamposi']);
    expect(p.versionLabel).toBeNull();
  });

  test('act names containing a separator are not split', () => {
    const p = parseName('Martin Garrix, Matisse & Sadko - Pineapple (V5)', ACTS);
    expect(names(p.artists, 'main')).toEqual(['Martin Garrix', 'Matisse & Sadko']);
    expect(p.title).toBe('Pineapple');
    expect(p.versionLabel).toBe('V5');

    const q = parseName('Martin Garrix & Axwell /\\ Ingrosso - ID', ACTS);
    expect(names(q.artists, 'main')).toEqual(['Martin Garrix', 'Axwell /\\ Ingrosso']);
  });

  test('bracketed qualifier plus feat on the next line', () => {
    const p = parseName('Martin Garrix & Avicii - Waiting For Love [24/03/2015 ]\n(feat. Jen Hult)', ACTS);
    expect(p.title).toBe('Waiting For Love');
    expect(p.versionLabel).toBe('24/03/2015');
    expect(names(p.artists, 'feat')).toEqual(['Jen Hult']);
  });

  test('paren and bracket qualifiers together', () => {
    const p = parseName('🏆Martin Garrix  - Hurricane ( Alternate Lyrics ) [ Demo ]\n( feat. Bonn )', ACTS);
    expect(p.title).toBe('Hurricane');
    expect(p.versionLabel).toBe('Alternate Lyrics · Demo');
  });

  test('prod credit with a different lead artist', () => {
    const p = parseName('⭐Imagine Dragons - Warrior Child (V1)\n(prod. Martin Garrix)', ACTS);
    expect(p.tags).toEqual(['best_of']);
    expect(names(p.artists, 'main')).toEqual(['Imagine Dragons']);
    expect(names(p.artists, 'prod')).toEqual(['Martin Garrix']);
  });

  test('remix credit turns the lead into the original artist', () => {
    const p = parseName(
      'Lewis Capaldi - Someone You Loved ( Martin Garrix, Matisse & Sadko Remix) [ Tomorrowland 2023 Version ]',
      ACTS,
    );
    expect(names(p.artists, 'original_artist')).toEqual(['Lewis Capaldi']);
    expect(names(p.artists, 'remixer')).toEqual(['Martin Garrix', 'Matisse & Sadko']);
    expect(p.versionLabel).toBe('Tomorrowland 2023 Version');
  });

  test('"Instrumental Remix" is a qualifier, not a remixer', () => {
    const p = parseName('Martin Garrix, Bono & The Edge - We Are The People (Instrumental Remix)', ACTS);
    expect(names(p.artists, 'remixer')).toEqual([]);
    expect(names(p.artists, 'main')).toEqual(['Martin Garrix', 'Bono & The Edge']);
    expect(p.versionLabel).toBe('Instrumental Remix');
  });

  test('several featured artists, "and" and "&"', () => {
    const a = parseName('Martin Garrix - Waiting For Tomorrow [V1]\n(feat. Mike Shinoda and Chester Bennington)');
    expect(names(a.artists, 'feat')).toEqual(['Mike Shinoda', 'Chester Bennington']);
    const b = parseName('Martin Garrix  - Love Runs Out (Demo)\n( feat. G-Eazy & Sasha Alex Sloan )');
    expect(names(b.artists, 'feat')).toEqual(['G-Eazy', 'Sasha Alex Sloan']);
  });

  test('sloppy credit spellings from the stems tab', () => {
    const a = parseName('Martin Garrix & Blinders - Walk Alone (Breach) [Extended Instrumental]\n(featt. Ilsey Juber)');
    expect(names(a.artists, 'feat')).toEqual(['Ilsey Juber']);
    const b = parseName('Martin Garrix - Summer Days (Instrumental)\n(feat Macklemore & Patrick Stump)');
    expect(names(b.artists, 'feat')).toEqual(['Macklemore', 'Patrick Stump']);
  });

  test('irregular dash spacing, comma in title, trailing whitespace', () => {
    expect(parseName("Martin Garrix & Shawn Mendes -  That's When I Fell For You").title).toBe(
      "That's When I Fell For You",
    );
    expect(parseName('Martin Garrix & Shermanology - Oh, Fortuna (V1)').title).toBe('Oh, Fortuna');
    expect(parseName('Martin Garrix - ID ').title).toBe('ID');
    // A hyphen inside a name is not the artist/title separator.
    expect(names(parseName('Martin Garrix - X\n( feat. G-Eazy )').artists, 'feat')).toEqual(['G-Eazy']);
  });

  test('row without an "Artist - Title" separator is reported', () => {
    const p = parseName('Martin Garrix & Bebe Rexha In The Name Of Love (Instrumental)');
    expect(p.noSeparator).toBe(true);
    expect(p.artists).toEqual([]);
  });
});

describe('parseTitle (Sheet B)', () => {
  test('stacked qualifiers', () => {
    expect(parseTitle('Waiting for Love (24/3/15) [Bonus Acoustic]')).toMatchObject({
      title: 'Waiting for Love',
      labels: ['24/3/15', 'Bonus Acoustic'],
    });
  });
  test('"(Remix)" alone is a label', () => {
    expect(parseTitle("Can't Feel My Face (Remix)")).toMatchObject({ title: "Can't Feel My Face", labels: ['Remix'] });
  });
});

describe('parseFeatureCell', () => {
  test('null tokens', () => {
    for (const v of ['-', 'N/D', ' - ', 'Solo(?']) expect(parseFeatureCell(v)).toEqual([]);
  });
  test('uncertainty marker', () => {
    expect(parseFeatureCell('Blinders(?')).toEqual([{ name: 'Blinders', role: 'with', uncertain: true }]);
  });
  test('two acts, one of which contains "&"', () => {
    expect(parseFeatureCell('Avicii & Vargas & Lagola', ACTS).map((c) => c.name)).toEqual(['Avicii', 'Vargas & Lagola']);
    expect(parseFeatureCell('YUNGBLUD / AREA21').map((c) => c.name)).toEqual(['YUNGBLUD', 'AREA21']);
  });
});

test('splitArtists', () => {
  expect(splitArtists('Martin Garrix, SchoolBoy, Carnage')).toEqual(['Martin Garrix', 'SchoolBoy', 'Carnage']);
  expect(splitArtists('Martin Garrix & David Guetta &  Brooks')).toEqual(['Martin Garrix', 'David Guetta', 'Brooks']);
});

test('isPlaceholderTitle', () => {
  for (const t of ['ID', 'ID 1', '???', 'Untitled Solo ID', 'Aviciicollab2']) expect(isPlaceholderTitle(t)).toBe(true);
  for (const t of ['Identity', 'Idle', 'Lim']) expect(isPlaceholderTitle(t)).toBe(false);
});
