import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

/**
 * One URL per entity, decided on the server. Each detail layout either renders,
 * answers 308 to the entity's one canonical URL, or answers 404 -- and a database
 * error is never a 404, or one bad minute tells crawlers real pages are gone.
 *
 * next/navigation's notFound and permanentRedirect throw, as the real ones do;
 * `@/lib/prisma` and the loaders are mocked (vitest otherwise reaches the LIVE DB).
 */

const { queryRaw, loaders } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  loaders: {
    loadStudy: vi.fn(),
    loadBgc: vi.fn(),
    loadGcf: vi.fn(),
    resolveGcfId: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  permanentRedirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw }, prisma: { $queryRaw: queryRaw } }));
vi.mock('@/lib/bgc/redirect', () => ({ findBgcRedirect: async () => null }));
vi.mock('@/lib/entity-loaders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/entity-loaders')>()),
  ...loaders,
}));

import SampleLayout from './samples/[id]/layout';
import StudyLayout from './studies/[id]/layout';
import BgcLayout from './bgcs/[id]/layout';
import GcfLayout from './gcfs/[id]/layout';

// The layouts' JSX compiles to React.createElement here; Next supplies React itself.
vi.stubGlobal('React', React);

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const UPPER = ID.toUpperCase();
const params = (id: string) => ({ params: Promise.resolve({ id }), children: 'page' });
const sqlValues = (call: unknown[]) => (call[0] as { values: unknown[] }).values;

beforeEach(() => {
  queryRaw.mockReset();
  Object.values(loaders).forEach((fn) => fn.mockReset());
});

describe('/samples/<id>', () => {
  it('404s an id that is not a uuid without querying', async () => {
    await expect(SampleLayout(params('not-a-sample'))).rejects.toThrow('NOT_FOUND');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('404s a uuid no sample has', async () => {
    queryRaw.mockResolvedValue([]);
    await expect(SampleLayout(params(ID))).rejects.toThrow('NOT_FOUND');
  });

  it('sends a metagenome sample to the samples list', async () => {
    queryRaw.mockResolvedValue([{ source_types: ['metagenome'] }]);
    await expect(SampleLayout(params(ID))).rejects.toThrow(`REDIRECT /samples?id=${ID}`);
  });

  it.each(['MAG', 'SAG', 'isolate'])('sends a %s sample to genome collections', async (type) => {
    queryRaw.mockResolvedValue([{ source_types: ['metagenome', type] }]);
    await expect(SampleLayout(params(ID))).rejects.toThrow(`REDIRECT /genome-collections?id=${ID}`);
  });

  it('sends a sample with no recorded source type to the samples list', async () => {
    queryRaw.mockResolvedValue([{ source_types: null }]);
    await expect(SampleLayout(params(ID))).rejects.toThrow(`REDIRECT /samples?id=${ID}`);
  });

  it('looks up and redirects an uppercase id in lowercase', async () => {
    queryRaw.mockResolvedValue([{ source_types: ['metagenome'] }]);
    await expect(SampleLayout(params(UPPER))).rejects.toThrow(`REDIRECT /samples?id=${ID}`);
    expect(sqlValues(queryRaw.mock.calls[0])).toEqual([ID]);
  });

  it('falls through to the client page when the database fails', async () => {
    queryRaw.mockRejectedValue(new Error('connection reset'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(SampleLayout(params(ID))).resolves.toBe('page');
  });
});

describe('/studies/<id>', () => {
  const row = (study_id: string) => ({
    status: 'ok',
    row: {
      study_id, title: 'A study', study_name: null, study_key: 'PRJ1', accession: null, bioproject: null,
      sample_count: 1, total_bgcs: 1, abstract: null, abstract_source: null, abstract_license: null,
    },
  });

  it('renders the canonical id', async () => {
    loaders.loadStudy.mockResolvedValue(row(ID));
    await expect(StudyLayout(params(ID))).resolves.toBeTruthy();
  });

  it('sends another physical id of the study to the canonical one', async () => {
    const physical = '11111111-2222-4333-8444-555555555555';
    loaders.loadStudy.mockResolvedValue(row(ID));
    await expect(StudyLayout(params(physical))).rejects.toThrow(`REDIRECT /studies/${ID}`);
  });

  it('sends an uppercase id to lowercase before loading', async () => {
    await expect(StudyLayout(params(UPPER))).rejects.toThrow(`REDIRECT /studies/${ID}`);
    expect(loaders.loadStudy).not.toHaveBeenCalled();
  });

  it('404s an unknown study', async () => {
    loaders.loadStudy.mockResolvedValue({ status: 'missing' });
    await expect(StudyLayout(params(ID))).rejects.toThrow('NOT_FOUND');
  });

  it('renders, not 404s, when the database fails', async () => {
    loaders.loadStudy.mockResolvedValue({ status: 'error' });
    await expect(StudyLayout(params(ID))).resolves.toBeTruthy();
  });

  it('resolves a study key that arrives percent-encoded', async () => {
    queryRaw.mockImplementation(async (sql: { values: unknown[] }) =>
      sql.values.includes('Soil 2019/A') ? [{ study_id: ID }] : []);
    await expect(StudyLayout(params('Soil%202019%2FA'))).rejects.toThrow(`REDIRECT /studies/${ID}`);
  });

  it('resolves a study key as written', async () => {
    queryRaw.mockImplementation(async (sql: { values: unknown[] }) =>
      sql.values.includes('Gao_2022_acid_mine_drainage') ? [{ study_id: ID }] : []);
    await expect(StudyLayout(params('Gao_2022_acid_mine_drainage'))).rejects.toThrow(`REDIRECT /studies/${ID}`);
  });

  it('404s a key with a stray % rather than throwing a URIError', async () => {
    queryRaw.mockResolvedValue([]);
    loaders.loadStudy.mockResolvedValue({ status: 'missing' });
    await expect(StudyLayout(params('100%'))).rejects.toThrow('NOT_FOUND');
  });
});

describe('/bgcs/<id> and /gcfs/<id>', () => {
  it('sends an uppercase BGC id to lowercase', async () => {
    await expect(BgcLayout(params(UPPER))).rejects.toThrow(`REDIRECT /bgcs/${ID}`);
  });

  it('404s an unknown BGC with no twin', async () => {
    loaders.loadBgc.mockResolvedValue({ status: 'missing' });
    await expect(BgcLayout(params(ID))).rejects.toThrow('NOT_FOUND');
  });

  it('renders, not 404s, a BGC when the database fails', async () => {
    loaders.loadBgc.mockResolvedValue({ status: 'error' });
    await expect(BgcLayout(params(ID))).resolves.toBeTruthy();
  });

  it('sends an uppercase GCF id to lowercase', async () => {
    await expect(GcfLayout(params(UPPER))).rejects.toThrow(`REDIRECT /gcfs/${ID}`);
  });
});
