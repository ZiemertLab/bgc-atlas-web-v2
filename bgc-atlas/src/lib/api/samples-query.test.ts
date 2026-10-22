import { describe, expect, it } from 'vitest';
import { buildBaseFilters } from './samples-query';

describe('buildBaseFilters ?search=', () => {
  it('matches study titles, like the samples browse index', () => {
    const [search] = buildBaseFilters(new URLSearchParams({ search: 'permafrost' }));
    expect(search.sql).toContain('UNNEST(sb.study_titles)');
    expect(search.values).toContain('%permafrost%');
  });
});
