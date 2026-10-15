// Statistics keys are versioned (currently v2); a change to a cached payload's shape or
// meaning needs the next version, or a stale entry reads as a legitimate value.

/** `/api/statistics`. */
export const STATS_GLOBAL_NAMESPACE = 'stats:global';
/** `/api/statistics/samples`. */
export const STATS_SAMPLES_NAMESPACE = 'statistics:samples';
/** `/api/statistics/samples/hierarchy`. */
export const STATS_SAMPLES_HIERARCHY_NAMESPACE = 'statistics:samples:hierarchy';

// Busted after the matview refresh. The version segment must sit after the namespace
// (`stats:global:v2:…`) or these globs silently stop matching.
export const STATS_CACHE_PATTERNS = [
    `${STATS_GLOBAL_NAMESPACE}:*`,
    'stats:gcfs:global',
    // Also covers the nested hierarchy namespace.
    `${STATS_SAMPLES_NAMESPACE}:*`,
    'statistics:genomes:*',
    'gcf:stats',
] as const;

// Re-warmed after busting. Paths are basePath-relative.
export const STATS_WARM_PATHS = [
    '/api/statistics',
    '/api/statistics?sourceType=metagenome',
    '/api/statistics?sourceType=isolate&sourceType=MAG&sourceType=SAG',
    '/api/statistics/gcfs',
    '/api/statistics/samples',
    '/api/statistics/genomes/taxonomy-hierarchy',
    '/api/gcfs/stats',
] as const;
