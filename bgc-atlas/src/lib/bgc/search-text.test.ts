import { describe, expect, it } from 'vitest';
import { parseBgcSearch } from './search-text';
import { buildBrowseSearchRequest } from '@/lib/opensearch/browse-query';

const ID = 'feb536d3-7235-564e-b50a-6a33fdfe52b4';

describe('parseBgcSearch', () => {
  it('finds a UUID anywhere, including a pasted file path', () => {
    expect(parseBgcSearch(`/ceph/x/${ID.toUpperCase()}.gbk.gz`)).toEqual({ kind: 'uuid', uuid: ID });
  });
  it('treats a partial UUID, an accession or a product type as text', () => {
    expect(parseBgcSearch('feb536d3-7235-564e-b50a-6a33fdfe52b')).toEqual({ kind: 'text', text: 'feb536d3-7235-564e-b50a-6a33fdfe52b' });
    expect(parseBgcSearch(' GCA_030804065.1 ')).toEqual({ kind: 'text', text: 'GCA_030804065.1' });
    expect(parseBgcSearch('   ')).toBeNull();
  });
});

describe('the /bgcs index query for ?search=', () => {
  const searchClause = (search: string) => {
    const req = buildBrowseSearchRequest('bgcs', new URLSearchParams({ search })) as {
      query: { bool: { filter: Record<string, unknown>[] } };
    };
    return JSON.stringify(req.query);
  };

  // "contains" on these walked millions of values each: ~10 s per search.
  it.each(['bgc_id', 'filename', 'assembly_id', 'contig'])('never runs "contains" on %s', (field) => {
    expect(searchClause('GCA_030804065.1')).not.toMatch(new RegExp(`"wildcard":\\{"${field}"`));
    expect(searchClause('GCA_030804065.1')).toContain(`"prefix":{"${field}"`);
  });

  it('keeps "contains" on the cheap fields', () => {
    expect(searchClause('NRPS')).toContain('"wildcard":{"product_type":{"value":"*NRPS*"');
    expect(searchClause('GCA_030804065.1')).toContain('"wildcard":{"sample_labels"');
  });

  it('matches a UUID exactly on the BGC and assembly ids', () => {
    const clause = searchClause(`path/${ID}.gbk.gz`);
    expect(clause).toContain(`"term":{"bgc_id":{"value":"${ID}"`);
    expect(clause).toContain(`"term":{"assembly_id":{"value":"${ID}"`);
    expect(clause).not.toContain('wildcard');
  });
});
