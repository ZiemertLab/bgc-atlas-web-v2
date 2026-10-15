export const queryKeys = {
  bgcs: {
    all: ['bgcs'] as const,
    list: (params: Record<string, unknown> = {}) =>
      ['bgcs', 'list', params] as const,
    detail: (id: string) => ['bgcs', 'detail', id] as const,
    distribution: (params: Record<string, unknown> = {}) =>
      ['bgcs', 'distribution', params] as const,
  },
  samples: {
    all: ['samples'] as const,
    list: (params: Record<string, unknown> = {}) =>
      ['samples', 'list', params] as const,
    map: (params: Record<string, unknown> = {}) =>
      ['samples', 'map', params] as const,
  },
  gcfs: {
    all: ['gcfs'] as const,
    list: (params: Record<string, unknown> = {}) =>
      ['gcfs', 'list', params] as const,
    detail: (id: string) => ['gcfs', 'detail', id] as const,
    mapSamples: (id: string) => ['gcfs', 'map-samples', id] as const,
    environment: (id: string) => ['gcfs', 'environment', id] as const,
    taxonomyComposition: (params: Record<string, unknown> = {}) =>
      ['gcfs', 'taxonomy-composition', params] as const,
    distribution: (params: Record<string, unknown> = {}) =>
      ['gcfs', 'distribution', params] as const,
  },

  statistics: {
    overall: (params: Record<string, unknown> = {}) =>
      ['statistics', 'overall', params] as const,
    bgcs: (params: Record<string, unknown> = {}) =>
      ['statistics', 'bgcs', params] as const,
    samples: (params: Record<string, unknown> = {}) =>
      ['statistics', 'samples', params] as const,
    gcfs: (params: Record<string, unknown> = {}) =>
      ['statistics', 'gcfs', params] as const,
    gcfsMeta: (params: Record<string, unknown> = {}) =>
      ['statistics', 'gcfs-meta', params] as const,
    dataSources: () => ['statistics', 'data-sources'] as const,
  },

  taxonomy: {
    distribution: (params: Record<string, unknown> = {}) =>
      ['taxonomy', 'distribution', params] as const,
  },

  search: {
    sequenceStatus: (sessionId: string) =>
      ['search', 'sequence-status', sessionId] as const,
  },
} as const;
