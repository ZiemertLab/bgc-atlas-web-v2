import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE_OPTIONS,
  OWN_WRITES_CAP,
  classifyNavigation,
  consumeOwnWrite,
  mergeQuery,
  nextUrl,
  normaliseQuery,
  readNumber,
  readOneOf,
  readPage,
  readPageSize,
  recordOwnWrite,
} from './url-state';

describe('mergeQuery', () => {
  it('omits empty values and values equal to their default', () => {
    expect(
      mergeQuery('', [
        ['search', ''],
        ['sortField', 'memberCount', 'memberCount'],
        ['page', '1', '1'],
        ['size', '100', '50'],
      ]),
    ).toBe('size=100');
  });

  it('removes a param that has returned to its default', () => {
    expect(mergeQuery('page=3&size=100', [['page', '1', '1'], ['size', '50', '50']])).toBe('');
  });

  it('keeps params the page does not own', () => {
    expect(mergeQuery('advancedFilters=abc&search=old', [['search', 'new']])).toBe(
      'advancedFilters=abc&search=new',
    );
  });

  it('accepts a URLSearchParams as the base', () => {
    expect(mergeQuery(new URLSearchParams('x=1'), [['page', '2', '1']])).toBe('x=1&page=2');
  });

  it('encodes values', () => {
    const query = mergeQuery('', [['search', 'a&b=c d/é']]);
    expect(query).toBe('search=a%26b%3Dc+d%2F%C3%A9');
    expect(new URLSearchParams(query).get('search')).toBe('a&b=c d/é');
  });
});

describe('mergeQuery with numbers', () => {
  it('stringifies values and defaults', () => {
    expect(mergeQuery('', [['page', 3, 1], ['size', 50, 50], ['min', 0]])).toBe('page=3&min=0');
  });
});

describe('nextUrl', () => {
  it('returns null when the URL already matches', () => {
    expect(nextUrl('/gcfs', 'search=a&page=2', [['search', 'a'], ['page', 2, 1]])).toBeNull();
  });

  it('returns null when only defaults are mirrored onto a bare URL', () => {
    expect(nextUrl('/gcfs', '', [['page', 1, 1], ['size', 50, 50], ['search', '']])).toBeNull();
  });

  it('returns the new URL when state differs', () => {
    expect(nextUrl('/gcfs', 'search=a', [['search', 'b'], ['page', 3, 1]])).toBe('/gcfs?search=b&page=3');
  });

  it('strips defaults, leaving a bare path', () => {
    expect(nextUrl('/gcfs', 'page=4&size=50', [['page', 1, 1], ['size', 50, 50]])).toBe('/gcfs');
  });

  it('keeps foreign params when writing', () => {
    expect(nextUrl('/gcfs', 'x=1&page=2', [['page', 1, 1]])).toBe('/gcfs?x=1');
  });

  it('treats an equivalent but differently encoded current URL as unchanged', () => {
    expect(nextUrl('/gcfs', 'search=a%20b', [['search', 'a b']])).toBeNull();
  });
});

describe('readPage', () => {
  it.each([['0'], ['-3'], ['abc'], ['2.5'], [''], [null]])('reads %j as the first page', (raw) => {
    expect(readPage(raw)).toBe(0);
  });

  it('turns the 1-based URL page into the 0-based state page', () => {
    expect(readPage('1')).toBe(0);
    expect(readPage('7')).toBe(6);
  });
});

describe('readPageSize', () => {
  const allowed = [25, 50, 100, 200];

  it('keeps an offered size', () => {
    expect(readPageSize('200', allowed, 50)).toBe(200);
  });

  it.each([['30'], ['0'], ['abc'], [''], [null]])('falls back for %j', (raw) => {
    expect(readPageSize(raw, allowed, 50)).toBe(50);
  });

  it('matches the sizes Pagination offers by default', () => {
    expect(readPageSize('10', DEFAULT_PAGE_SIZE_OPTIONS, 50)).toBe(10);
  });
});

describe('readOneOf', () => {
  const sorts = ['bgcs', 'id', 'host'] as const;

  it('keeps an offered value', () => {
    expect(readOneOf('host', sorts, 'bgcs')).toBe('host');
  });

  it.each([['constructor'], ['HOST'], [''], ['bgcs ']])('falls back for %j', (raw) => {
    expect(readOneOf(raw, sorts, 'bgcs')).toBe('bgcs');
  });

  it('reads junk as no value when there is no fallback', () => {
    expect(readOneOf('nope', sorts)).toBe('');
    expect(readOneOf('id', sorts)).toBe('id');
  });
});

describe('readNumber', () => {
  it.each([['12'], ['-3.5'], ['0'], ['1e3']])('keeps the number %j as written', (raw) => {
    expect(readNumber(raw)).toBe(raw);
  });

  it.each([[''], ['  '], ['abc'], ['12abc'], ['NaN'], ['Infinity']])('reads %j as no bound', (raw) => {
    expect(readNumber(raw)).toBe('');
  });
});

describe('classifyNavigation', () => {
  it('first load: the query the page seeded from is not a navigation', () => {
    expect(classifyNavigation('gcf=X&page=4', 'gcf=X&page=4', [])).toBe('same');
  });

  it("the mirror's canonicalising first write arriving is its own", () => {
    // /bgcs?page=0 seeds page 1 and writes the default away.
    expect(classifyNavigation('', 'page=0', [''])).toBe('own');
  });

  it('a write the mirror recorded is its own, so the page is not remounted', () => {
    expect(classifyNavigation('gcf=X&page=5', 'gcf=X&page=4', ['gcf=X&page=5'])).toBe('own');
  });

  it('the nav item (bare route) while filtered is external, so the page remounts', () => {
    expect(classifyNavigation('', 'gcf=X&page=4', [])).toBe('external');
  });

  it('a link to the same route with other params is external', () => {
    expect(classifyNavigation('gcf=Y', 'gcf=X', ['page=2'])).toBe('external');
  });

  it('Back to a URL the mirror once wrote is external once the list was cleared', () => {
    // On /bgcs?gcf=X, nav item -> /bgcs: external, list cleared.
    expect(classifyNavigation('', 'gcf=X', [])).toBe('external');
    // Back -> /bgcs?gcf=X. With the list cleared it re-seeds; had the write
    // survived, it would match and the bare state would be written over it.
    expect(classifyNavigation('gcf=X', '', [])).toBe('external');
    expect(classifyNavigation('gcf=X', '', ['gcf=X'])).toBe('own');
  });

  it('compares queries normalised, as nextUrl writes and useSearchParams reads them', () => {
    const written = mergeQuery('', [['search', 'a b']]);
    expect(classifyNavigation(new URLSearchParams('search=a%20b'), '', [written])).toBe('own');
    expect(classifyNavigation('search=a+b', new URLSearchParams('search=a%20b'), [])).toBe('same');
    expect(classifyNavigation('search=a+b', '', ['search=a%20b'])).toBe('own');
  });

  it('normaliseQuery matches the query nextUrl writes', () => {
    const url = nextUrl('/gcfs', 'x=a%20b', [['page', 3, 1]])!;
    expect(normaliseQuery(url.slice(url.indexOf('?') + 1))).toBe(normaliseQuery('x=a+b&page=3'));
  });
});

describe('own writes in flight', () => {
  // Next page twice, quickly: page=2 then page=3 are both written before either arrives.
  const A = 'page=2';
  const B = 'page=3';
  const written = recordOwnWrite(recordOwnWrite([], A), B);

  it('two quick writes arriving in order are both own', () => {
    expect(classifyNavigation(A, '', written)).toBe('own');
    const afterA = consumeOwnWrite(written, A);
    expect(afterA).toEqual([B]);
    expect(classifyNavigation(B, A, afterA)).toBe('own');
    expect(consumeOwnWrite(afterA, B)).toEqual([]);
  });

  it('two quick writes arriving out of order are each own on arrival', () => {
    expect(classifyNavigation(B, '', written)).toBe('own');
    expect(classifyNavigation(A, '', written)).toBe('own');
  });

  it('the newer write arriving first drops the older, which the router discards anyway', () => {
    const afterB = consumeOwnWrite(written, B);
    expect(afterB).toEqual([]);
    // Next 15.5 never delivers a superseded navigation; if it did, re-seeding is the safe outcome.
    expect(classifyNavigation(A, B, afterB)).toBe('external');
  });

  it('the older write arriving leaves the newer one recorded', () => {
    expect(consumeOwnWrite(written, A)).toEqual([B]);
  });

  it('an external navigation still reads as external with writes in flight', () => {
    expect(classifyNavigation('', 'page=1', written)).toBe('external');
  });

  it('consuming is idempotent, and a query not on the list changes nothing', () => {
    const once = consumeOwnWrite(written, A);
    expect(consumeOwnWrite(once, A)).toEqual(once);
    expect(consumeOwnWrite(written, 'gcf=Z')).toEqual(written);
  });

  it('a write recorded twice (StrictMode effect) is consumed in one go', () => {
    expect(consumeOwnWrite(recordOwnWrite(recordOwnWrite([], A), A), A)).toEqual([]);
  });

  it('consumes normalised', () => {
    expect(consumeOwnWrite(['search=a%20b', B], 'search=a+b')).toEqual([B]);
  });

  it('keeps only the newest OWN_WRITES_CAP writes', () => {
    let list: string[] = [];
    for (let i = 1; i <= OWN_WRITES_CAP + 3; i++) list = recordOwnWrite(list, `page=${i}`);
    expect(list).toHaveLength(OWN_WRITES_CAP);
    expect(list[0]).toBe('page=4');
    expect(classifyNavigation(`page=${OWN_WRITES_CAP + 3}`, '', list)).toBe('own');
  });
});
