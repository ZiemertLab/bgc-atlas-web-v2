type MetagenomeStatsFilterInput = {
  search?: string;
  id?: string;
  biome?: string;
  environmentText?: string;
  material?: string;
  feature?: string;
  host?: string;
  dataSource?: string;
  study?: string;
  // Exact study_key, not the title match above.
  studyKey?: string;
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
  assembliesMin?: number;
  assembliesMax?: number;
  bgcsMin?: number;
  bgcsMax?: number;
  gcfsMin?: number;
  gcfsMax?: number;
  goldBucket?: string;
  advancedFilters?: string;
};

export const buildMetagenomeStatsFilters = (filters: MetagenomeStatsFilterInput) => ({
  ...filters,
  sourceType: 'metagenome' as const,
});
