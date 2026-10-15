import { describe, expect, it } from 'vitest';

import { buildMetagenomeStatsFilters } from './samples-page-filters';

describe('metagenome samples page filters', () => {
  it('scopes sample distribution charts to metagenome samples', () => {
    const filters = buildMetagenomeStatsFilters({
      search: '',
      id: '',
      biome: '',
      environmentText: '',
      material: '',
      feature: '',
      host: '',
      dataSource: '',
      study: '',
      latMin: undefined,
      latMax: undefined,
      lonMin: undefined,
      lonMax: undefined,
      assembliesMin: undefined,
      assembliesMax: undefined,
      bgcsMin: undefined,
      bgcsMax: undefined,
      goldBucket: undefined,
      advancedFilters: undefined,
    });

    expect(filters.sourceType).toBe('metagenome');
  });
});
