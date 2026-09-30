import { describe, expect, test } from 'bun:test';
import { classifyLink, fileAnchor, sourceLabel, stripUrls } from './links.ts';

describe('classifyLink', () => {
  test('file hosts are private and carry an anchor', () => {
    const d = classifyLink('https://drive.google.com/file/d/1abcDEF_-9/view');
    expect(d).toMatchObject({ visibility: 'private', anchor: 'drive:1abcDEF_-9' });
    expect(classifyLink('https://imgur.gg/f/EXAMPLE1').visibility).toBe('private');
    expect(classifyLink('https://pillows.su/f/0000000000000000example').visibility).toBe('private');
    expect(classifyLink('https://krakenfiles.com/view/abc123/file.html').visibility).toBe('private');
  });

  test('citation hosts are public', () => {
    expect(classifyLink('https://youtu.be/BC12oNv3rFk?t=677')).toMatchObject({ visibility: 'public', kind: 'video' });
    expect(classifyLink('https://www.1001tracklists.com/tracklist/872x6tk/x.html').kind).toBe('tracklist');
    expect(classifyLink('https://plusxhub.medium.com/interview-835b29baeafe')).toMatchObject({
      visibility: 'public',
      kind: 'article',
    });
    expect(classifyLink('https://twitter.com/headhunterz/status/823859242415362048').kind).toBe('social');
  });

  test('unknown hosts default to private', () => {
    expect(classifyLink('https://example-leaks.to/abc').visibility).toBe('private');
    expect(classifyLink('not a url').visibility).toBe('private');
  });

  test('soundcloud is private unless explicitly allowed', () => {
    const reupload = 'https://soundcloud.com/someone/track-free-download';
    expect(classifyLink(reupload, 'Track [LABEL] FREE DOWNLOAD by Someone').visibility).toBe('private');
    expect(classifyLink('https://soundcloud.com/someone/track', 'Track').visibility).toBe('private');
    const own = 'https://soundcloud.com/kennethg/kenneth-g-martin-garrix-lim';
    expect(classifyLink(own, 'LIM', 'public').visibility).toBe('public');
  });

  test('"download" in the label overrides an allowlisted host', () => {
    expect(classifyLink('https://www.youtube.com/watch?v=x', 'Song (FREE DOWNLOAD)').visibility).toBe('private');
  });

  test('a file host stays private even when the row is forced public', () => {
    expect(classifyLink('https://drive.google.com/file/d/abc/view', '', 'public').visibility).toBe('private');
  });

  test('overrides can force a link private', () => {
    const url = 'https://www.reddit.com/r/Martingarrix/comments/abc/some_leak/';
    expect(classifyLink(url, '', 'private').visibility).toBe('private');
    expect(classifyLink(url).visibility).toBe('public');
  });
});

test('fileAnchor', () => {
  expect(fileAnchor('https://drive.google.com/open?id=XYZ')).toBe('drive:XYZ');
  expect(fileAnchor('https://www.youtube.com/watch?v=x')).toBeUndefined();
});

test('stripUrls', () => {
  expect(stripUrls('Teased by Garrix & Dyro in Twitter. https://thisisedm.it/martin-garrix-dyro-seventy/')).toEqual({
    text: 'Teased by Garrix & Dyro in Twitter.',
    urls: ['https://thisisedm.it/martin-garrix-dyro-seventy/'],
  });
  expect(stripUrls('no links here').urls).toEqual([]);
});

describe('sourceLabel', () => {
  test('drops site-name tails and glued URLs', () => {
    expect(sourceLabel('MARTIN GARRIX & DYRO REVEAL UPCOMING COLLABORATION - YouTube', 'https://www.youtube.com/watch?v=x')).toBe(
      'MARTIN GARRIX & DYRO REVEAL UPCOMING COLLABORATION',
    );
    expect(
      sourceLabel(
        'List of NEW/UPCOMING Martin Garrix IDs (Official Info from ASCAP) : r/EDMhttps://www.reddit.com/r/EDM/comments/4sr65k/x/',
        'https://www.reddit.com/r/EDM/comments/4sr65k/x/',
      ),
    ).toBe('List of NEW/UPCOMING Martin Garrix IDs (Official Info from ASCAP)');
  });
  test('falls back to a host description when the cell is just a URL', () => {
    expect(sourceLabel('https://twitter.com/x/status/1', 'https://twitter.com/x/status/1')).toBe('Post on Twitter');
    expect(sourceLabel('ND', 'https://edm.com/a')).toBe('edm.com');
  });
});
