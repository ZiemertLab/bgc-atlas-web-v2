import { deserializeFilterGroup, parseAdvancedFilterParam } from '@/lib/filters/types';
import { buildAdvancedBrowseFilter, supportsAdvancedBrowse } from './browse-advanced';
import {
  CATEGORY_SHARE_SORT_FIELD,
  PRODUCT_CATEGORY_VALUES,
  categoryForShareSort,
  categoryShareField,
  parseCategoryFilter,
} from '@/lib/gcf/category-share';
import { parseFamilyClass } from '@/lib/gcf/family-class';

export type BrowseEntity = 'bgcs' | 'gcfs' | 'samples';
export type OpenSearchQuery = Record<string, unknown>;

type Sort = Record<string, { order: 'asc' | 'desc'; missing?: '_last' }>;

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;

const asNumber = (value: string | null, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bounded = (value: string | null, fallback: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, asNumber(value, fallback)));

const wildcard = (field: string, value: string): OpenSearchQuery => ({
  wildcard: { [field]: { value: `*${value}*`, case_insensitive: true } },
});

/** The six allowed `bgcs.product_category` values (verified: none other, no repeats). */
export { PRODUCT_CATEGORY_VALUES };

/** The Class column's label for a multi-category region; derived, never stored. */
export const HYBRID_CLASS = 'Hybrid';

/**
 * Regions with at least two distinct categories. `minimum_should_match: 2` over the six
 * terms equals a size() > 1 script on this field, but is index-backed and cacheable.
 */
const hybridCategoryQuery = (): OpenSearchQuery => ({
  bool: {
    should: PRODUCT_CATEGORY_VALUES.map((c) => ({ term: { product_category: c } })),
    minimum_should_match: 2,
  },
});

const anyWildcard = (fields: string[], value: string): OpenSearchQuery => ({
  bool: { should: fields.map((field) => wildcard(field, value)), minimum_should_match: 1 },
});

const addRange = (filters: OpenSearchQuery[], field: string, min: string | null, max: string | null) => {
  const range: Record<string, number> = {};
  if (min !== null && min !== '') range.gte = Number(min);
  if (max !== null && max !== '') range.lte = Number(max);
  if (Object.keys(range).length && Object.values(range).every(Number.isFinite)) {
    filters.push({ range: { [field]: range } });
  }
};

const addText = (filters: OpenSearchQuery[], field: string, value: string | null) => {
  if (value?.trim()) filters.push(wildcard(field, value.trim()));
};

/** First non-empty of several parameter names: old product names (`?class=NRPS`) stay
 *  accepted because they are in shared links. */
const firstParam = (params: URLSearchParams, ...names: string[]): string => {
  for (const name of names) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return '';
};

/**
 * ?goldBucket= against bgc_browse, mirroring goldBucketSqlForColumn in
 * lib/api/samples-query.ts. The SQL form is a correlated EXISTS that, beside a
 * selective co-filter, costs minutes of cold I/O. Counts verified equal to SQL's; stored
 * paths are canonical, so case-sensitive `prefix` matches ILIKE.
 */
const goldPathPrefix = (value: string): OpenSearchQuery => ({
  prefix: { gold_ecosystem_path: value },
});

const goldBucketQuery = (bucket: string): OpenSearchQuery | null => {
  switch (bucket) {
    case 'host-animal':
      return { bool: {
        must: [goldPathPrefix('Host-associated')],
        must_not: [goldPathPrefix('Host-associated:Plants')],
      } };
    case 'host-plant':       return goldPathPrefix('Host-associated:Plants');
    case 'marine':           return goldPathPrefix('Environmental:Aquatic:Marine');
    case 'freshwater':       return goldPathPrefix('Environmental:Aquatic:Freshwater');
    case 'soil-terrestrial': return goldPathPrefix('Environmental:Terrestrial');
    case 'other-environmental':
      return { bool: {
        must: [goldPathPrefix('Environmental')],
        must_not: [
          goldPathPrefix('Environmental:Aquatic:Marine'),
          goldPathPrefix('Environmental:Aquatic:Freshwater'),
          goldPathPrefix('Environmental:Terrestrial'),
        ],
      } };
    case 'engineered':       return goldPathPrefix('Engineered');
    case 'mixed':            return goldPathPrefix('Mixed');
    case 'unknown':
      // SQL: path IS NULL OR path = ''
      return { bool: {
        should: [
          { bool: { must_not: [{ exists: { field: 'gold_ecosystem_path' } }] } },
          { term: { gold_ecosystem_path: '' } },
        ],
        minimum_should_match: 1,
      } };
    default:
      return null;
  }
};

/** Sort fields from ?sortField or ?sortFields, as the caller's names. */
const requestedSortFields = (params: URLSearchParams): string[] => {
  const multi = params.get('sortFields');
  if (multi) return multi.split(',').map((f) => f.trim()).filter(Boolean);
  const single = params.get('sortField');
  return single ? [single] : [];
};

/** Both map to `ORDER BY gd.max_pct_l<level>` in api/gcfs/route.ts. */
const GCF_BIOME_SORT_FIELDS = ['biomeDistribution', 'dominantBiome'];

/**
 * ?ecosystemLevel=, parsed as api/gcfs/route.ts does (fallback 1, clamped to 1..5).
 * Null for a non-integer: SQL errors on it, so it stays refused here too.
 */
const gcfEcosystemLevel = (params: URLSearchParams): number | null => {
  const raw = params.get('ecosystemLevel');
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  const level = Math.max(1, Math.min(5, parsed));
  return Number.isInteger(level) ? level : null;
};

/** Total: an unreadable payload is "not supported", so SQL raises the 400 in one place. */
const advancedFiltersServable = (entity: BrowseEntity, params: URLSearchParams): boolean => {
  const raw = params.get('advancedFilters');
  if (!raw?.trim()) return true;
  const group = deserializeFilterGroup(raw);
  if (!group) return false;
  return supportsAdvancedBrowse(entity, group);
};

/** Whether the index can answer this query without changing PostgreSQL semantics. */
export function supportsBrowseSearch(entity: BrowseEntity, params: URLSearchParams): boolean {
  if (entity === 'samples') {
    // ?studyKey= must never reach the SQL fallback, which has no study filter and would
    // list every sample. Checked before the unsupported-parameter check on purpose.
    if (params.has('studyKey')) return true;
    // includeGtdbAccession / includeTaxonomy / includeStudyLinks are per-row decorations,
    // hydrated for the page's rows (lib/api/sample-enrichments.ts), so they do not force SQL.
    // goldBucket is served; counts match the SQL buckets.
    const unsupported = ['environmentText', 'host']
      .some((key) => params.has(key));
    return !unsupported
      && advancedFiltersServable(entity, params)
      && !['dataSource', 'study', 'location', 'biome'].includes(params.get('sortField') ?? '');
  }
  if (entity === 'bgcs') {
    // goldBucket and the map-area box are served (a country-sized box takes minutes in SQL).
    // Multi-field sort is supported, or the table's default ordering would go to SQL.
    // `biome` sorts on resolved_biome_level_1 alone: documents lacking it carry none of
    // SQL's COALESCE fallbacks, so the order is the same. `taxonomy` sorts on the
    // precomputed taxonomy_sort; deep taxonomy pages are still refused (~180,000 values).
    const banned = ['productType', 'productCategory'];
    return advancedFiltersServable(entity, params)
      && !requestedSortFields(params).some((f) => banned.includes(f));
  }
  // ?study= must never reach the SQL fallback, which has no study filter.
  if (params.has('study')) return true;
  // biomeDistribution / dominantBiome and ?biome= are served (max_pct_l1..5, biome_terms);
  // refusing them would send /gcfs and its summary charts to SQL. Only an ecosystemLevel
  // SQL cannot use is refused.
  return advancedFiltersServable(entity, params)
    && !(requestedSortFields(params).some((f) => GCF_BIOME_SORT_FIELDS.includes(f))
      && gcfEcosystemLevel(params) === null);
}

const sampleSort: Record<string, string> = {
  id: 'external_id', dataSource: 'data_source_names', assemblies: 'assembly_count',
  bgcs: 'bgc_count', gcfs: 'gcf_count', location: 'geographic_location', biome: 'primary_biome',
  environment: 'environment_biome', material: 'environment_material',
  feature: 'environment_feature', host: 'host_scientific_name', study: 'study_titles',
  // CheckM2 values and their MIMAG label (genome collections only; a metagenome
  // has none, and a missing value sorts last either way, as NULLS LAST does in SQL).
  completeness: 'checkm_completeness', contamination: 'checkm_contamination',
  genomeQuality: 'genome_quality',
};

const gcfSort: Record<string, string> = {
  name: 'gcf_name', petName: 'pet_name', pet_name: 'pet_name',
  familyClass: 'family_class', family_class: 'family_class',
  member_count: 'member_bgc_count', memberCount: 'member_bgc_count',
  bgcCount: 'member_bgc_count', assembly_count: 'assembly_count', assemblyCount: 'assembly_count',
  product_diversity: 'unique_product_categories', productDiversity: 'unique_product_categories',
  taxa_count: 'unique_taxa_count', taxaCount: 'unique_taxa_count',
  // Distance; lower = better.
  avg_score: 'avg_distance', avgScore: 'avg_distance', avg_distance: 'avg_distance', avgDistance: 'avg_distance',
  // The displayed value (median over complete members, else the longest member),
  // precomputed because OpenSearch cannot sort on a COALESCE.
  length: 'length_est', bgcLength: 'length_est',
  // biomeDistribution / dominantBiome are NOT here: their index field depends on
  // ?ecosystemLevel, so buildBrowseSearchRequest resolves them per request.
};

const bgcSort: Record<string, string> = {
  id: 'bgc_id', length: 'length', genes: 'num_cds_features', gcf: 'gcf_id',
  // Distance; lower = better.
  distance: 'distance', assembly: 'assembly_id',
  product: 'product_type', category: 'product_category',
  // pre-rename sort keys, still sent by older clients and saved views
  productType: 'product_type', productCategory: 'product_category',
  completeness: 'is_complete', name: 'filename',
  biome: 'resolved_biome_level_1',
  // Not tax_species: SQL orders by COALESCE(species, ..., domain), which taxonomy_sort carries.
  taxonomy: 'taxonomy_sort',
};

function buildSampleFilters(params: URLSearchParams): OpenSearchQuery[] {
  const filters: OpenSearchQuery[] = [];
  const search = params.get('search')?.trim();
  if (search) filters.push(anyWildcard([
    'external_id', 'name', 'geographic_location', 'geolocation_name', 'environment_biome',
    'environment_feature', 'environment_material', 'host_scientific_name', 'primary_biome',
  ], search));
  const id = params.get('id')?.trim();
  if (id) filters.push(anyWildcard(['external_id', 'sample_id'], id));
  addText(filters, 'environment_biome', params.get('environment'));
  addText(filters, 'primary_biome', params.get('biome'));
  addText(filters, 'gold_ecosystem_path', params.get('goldEcosystem'));
  const bucket = params.get('goldBucket')?.trim();
  if (bucket) {
    // goldBucketRefusal rejects unknown buckets first; this is only a guard.
    filters.push(goldBucketQuery(bucket) ?? { bool: { must_not: [{ match_all: {} }] } });
  }
  addText(filters, 'environment_material', params.get('material'));
  addText(filters, 'environment_feature', params.get('feature'));
  addRange(filters, 'latitude', params.get('latMin'), params.get('latMax'));
  addRange(filters, 'longitude', params.get('lonMin'), params.get('lonMax'));
  addRange(filters, 'assembly_count', params.get('assembliesMin'), params.get('assembliesMax'));
  addRange(filters, 'bgc_count', params.get('bgcsMin'), params.get('bgcsMax'));
  addRange(filters, 'gcf_count', params.get('gcfsMin'), params.get('gcfsMax'));
  addRange(filters, 'checkm_completeness', params.get('completenessMin'), params.get('completenessMax'));
  addRange(filters, 'checkm_contamination', params.get('contaminationMin'), params.get('contaminationMax'));
  const genomeQuality = params.get('genomeQuality')?.trim();
  if (genomeQuality) filters.push({ term: { genome_quality: genomeQuality } });
  const sourceTypes = params.getAll('sourceType').filter(Boolean);
  if (sourceTypes.length) filters.push({ terms: { source_types: sourceTypes } });
  const dataSource = params.get('dataSource') ?? params.get('dataSourceId');
  if (dataSource?.trim()) {
    const value = dataSource.trim();
    if (/^[0-9a-fA-F-]{36}$/.test(value)) filters.push({ term: { data_source_ids: value } });
    else filters.push(wildcard('data_source_names', value));
  }
  // ?study= is a free-text title match (the /samples page filter).
  addText(filters, 'study_titles', params.get('study'));

  // ?studyKey= is exact: hundreds of titles are shared by more than one study.
  const studyKey = params.get('studyKey')?.trim();
  if (studyKey) filters.push({ term: { study_keys: studyKey } });
  return filters;
}

function buildBgcFilters(params: URLSearchParams): OpenSearchQuery[] {
  const filters: OpenSearchQuery[] = [];
  const search = params.get('search')?.trim();
  if (search) filters.push(anyWildcard([
    'bgc_id', 'filename', 'assembly_id', 'contig', 'resolved_biome_level_1',
    'resolved_biome_level_2', 'resolved_biome_level_3', 'resolved_biome_level_4',
    'environment_biome', 'environment_feature', 'environment_material', 'product_type',
    'product_category', 'sample_labels',
  ], search));
  addText(filters, 'bgc_id', params.get('id'));
  addText(filters, 'filename', params.get('name'));
  addText(filters, 'assembly_id', params.get('assembly'));
  // ?gcf= matches the family name as well as its id: the GCF column renders `gcfName || gcf`.
  // Not pet_name, which the SQL fallback does not match.
  const gcfQuery = params.get('gcf')?.trim();
  if (gcfQuery) filters.push(anyWildcard(['gcf_id', 'gcf_name'], gcfQuery));
  const bucket = params.get('goldBucket')?.trim();
  if (bucket) {
    const bucketQuery = goldBucketQuery(bucket);
    // An unknown bucket matches nothing; SQL drops the filter instead (a deliberate difference).
    filters.push(bucketQuery ?? { bool: { must_not: [{ match_all: {} }] } });
  }
  const category = firstParam(params, 'category', 'class');
  if (category === HYBRID_CLASS) filters.push(hybridCategoryQuery());
  else if (category) filters.push({ term: { product_category: category } });
  // Searches product_type only; the Category dropdown owns product_category.
  const product = firstParam(params, 'product', 'typeText');
  if (product) filters.push(wildcard('product_type', product));
  addText(filters, 'sample_labels', params.get('sample'));
  const sampleId = params.get('sampleId')?.trim();
  if (sampleId) {
    if (/^[0-9a-fA-F-]{36}$/.test(sampleId)) filters.push({ term: { sample_ids: sampleId } });
    else filters.push(wildcard('sample_ids', sampleId));
  }
  addText(filters, 'data_source_names', params.get('dataSource'));
  addText(filters, 'gold_ecosystem_path', params.get('goldEcosystem'));
  const biome = params.get('biome')?.trim();
  if (biome) filters.push(anyWildcard([
    'resolved_biome_level_1', 'resolved_biome_level_2', 'resolved_biome_level_3',
    'resolved_biome_level_4', 'environment_biome', 'environment_feature', 'environment_material',
  ], biome));
  const taxon = params.get('taxonomy')?.trim();
  if (taxon) filters.push(anyWildcard([
    'tax_domain', 'tax_phylum', 'tax_class', 'tax_order', 'tax_family', 'tax_genus', 'tax_species', 'gtdb_lineage',
  ], taxon));
  const completeness = params.get('completeness');
  if (completeness === 'complete') filters.push({ term: { is_complete: true } });
  if (completeness === 'partial') filters.push({ term: { is_complete: false } });
  addRange(filters, 'length', params.get('lengthMin'), params.get('lengthMax'));
  addRange(filters, 'num_cds_features', params.get('genesMin'), params.get('genesMax'));
  // Raw BiG-SLiCE distance bounds; lower = better.
  addRange(filters, 'distance', params.get('distanceMin'), params.get('distanceMax'));
  // Map-area box on the sample's coordinates (one sample per assembly, so it matches SQL).
  // Inclusive bounds, each parsed on its own as the route's parseNumber does.
  addSqlStyleRange(filters, 'latitude', params.get('latMin'), params.get('latMax'));
  addSqlStyleRange(filters, 'longitude', params.get('lonMin'), params.get('lonMax'));
  return filters;
}

/** A range whose bounds are kept or dropped one by one, as api/bgcs/route.ts's
 *  parseNumber treats them: empty or non-numeric means "no bound". */
const addSqlStyleRange = (
  filters: OpenSearchQuery[], field: string, min: string | null, max: string | null,
) => {
  const bound = (raw: string | null) => {
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const range: Record<string, number> = {};
  const lo = bound(min);
  const hi = bound(max);
  if (lo !== undefined) range.gte = lo;
  if (hi !== undefined) range.lte = hi;
  if (Object.keys(range).length) filters.push({ range: { [field]: range } });
};

function buildGcfFilters(params: URLSearchParams): OpenSearchQuery[] {
  const filters: OpenSearchQuery[] = [{ range: { member_bgc_count: { gt: 0 } } }];
  const search = params.get('search')?.trim();
  // mibig_compounds is searchable; mibig_accessions is not ('BGC...' would match anchored
  // families). cluster_method must stay out: one value corpus-wide. The SQL fallback's
  // text search must match this list exactly. majority_categories, not
  // product_categories: "NRPS" means families where most members are NRPS.
  if (search) filters.push(anyWildcard([
    'gcf_id', 'gcf_name', 'pet_name', 'description', 'majority_categories',
    'mibig_compounds',
  ], search));
  addText(filters, 'gcf_id', params.get('id'));
  addText(filters, 'gcf_name', params.get('name'));
  // Throws CategoryShareFilterError; the routes answer 400.
  const category = parseCategoryFilter(params);
  if (category?.kind === 'contains') {
    addText(filters, 'product_categories', category.text);
  } else if (category?.kind === 'share') {
    // "Any member" is a term, not `share > 0`: shares are stored to 2 dp and can round to 0.00.
    filters.push(category.minShare > 0
      ? { range: { [categoryShareField(category.category)]: { gte: category.minShare } } }
      : { term: { product_categories: category.category } });
  }
  addRange(filters, 'member_bgc_count', params.get('minBgcs'), params.get('maxBgcs'));
  // biome_terms is every resolved_biome_level_1..3 value any member carries, matching the
  // route's EXISTS. Not biome_distribution_l*, which is the GOLD path.
  addText(filters, 'biome_terms', params.get('biome'));

  // Exact study_key, not a title match: titles are shared between studies.
  const studyKey = params.get('study')?.trim();
  if (studyKey) filters.push({ term: { study_keys: studyKey } });

  // Exclusive to its one study. A GCF-level property, so it needs no join.
  if (['1', 'true'].includes((params.get('exclusive') ?? '').toLowerCase())) {
    filters.push({ term: { study_count: 1 } });
  }

  // Only the positive is offered: lacking a curated reference does not mean novel.
  if (['1', 'true'].includes((params.get('mibigAnchored') ?? '').toLowerCase())) {
    filters.push({ term: { mibig_anchored: true } });
  }

  // Throws FamilyClassFilterError for an unknown value (a 400); same parser as the SQL fallback.
  const familyClass = parseFamilyClass(params);
  if (familyClass) filters.push({ term: { family_class: familyClass } });
  return filters;
}

/**
 * The filter clause alone, without paging or sort, so aggregation endpoints describe
 * the rows the table shows. Callers must gate on `supportsBrowseSearch` first: cases
 * that fall back to SQL are not in this clause.
 */
export function buildBrowseFilters(entity: BrowseEntity, params: URLSearchParams): OpenSearchQuery[] {
  const filters = entity === 'samples' ? buildSampleFilters(params)
    : entity === 'gcfs' ? buildGcfFilters(params) : buildBgcFilters(params);
  // Here rather than in buildBrowseSearchRequest so the aggregation panels honour it too.
  const advanced = buildAdvancedBrowseFilter(entity, parseAdvancedFilterParam(params.get('advancedFilters')));
  if (advanced) filters.push(advanced);
  return filters;
}

export function buildBrowseSearchRequest(entity: BrowseEntity, params: URLSearchParams): Record<string, unknown> {
  const limit = bounded(params.get('limit'), LIMIT_DEFAULT, 1, LIMIT_MAX);
  const offset = bounded(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  // Default direction matches the SQL path per entity: /api/gcfs defaults to asc.
  const requestedOrder = params.get('sortOrder');
  const defaultOrder: 'asc' | 'desc' = entity === 'gcfs' ? 'asc' : 'desc';
  const order = requestedOrder === 'asc' ? 'asc' : requestedOrder === 'desc' ? 'desc' : defaultOrder;
  const sortField = params.get('sortField') ?? (entity === 'samples' ? 'bgcs' : entity === 'gcfs' ? 'name' : 'id');
  const sortMap = entity === 'samples' ? sampleSort : entity === 'gcfs' ? gcfSort : bgcSort;
  const fallbackField = entity === 'samples' ? 'bgc_count' : entity === 'gcfs' ? 'gcf_name' : 'bgc_id';
  const idField = entity === 'samples' ? 'sample_id' : entity === 'gcfs' ? 'gcf_id' : 'bgc_id';
  const filters = buildBrowseFilters(entity, params);

  // Orders are positional; a missing one is 'desc'. length and is_complete are SQL's
  // ordering columns, so the backends agree.
  const multi = params.get('sortFields');
  const orders = (params.get('sortOrders') ?? '').split(',').map((o) => o.trim());
  const explicitMulti = multi ? multi.split(',').map((f) => f.trim()).filter(Boolean) : [];
  // With no sort parameter, bgcs orders as the SQL default (length, completeness DESC)
  // so both backends return the same first page.
  const noSortRequested = !multi && !params.get('sortField');
  const multiFields = explicitMulti.length ? explicitMulti
    : (entity === 'bgcs' && noSortRequested ? ['length', 'completeness'] : []);
  // By the caller's field name, so biome sorts resolve the same from ?sortField or ?sortFields.
  const sortEntry = (name: string, direction: 'asc' | 'desc'): Sort => {
    if (entity === 'gcfs' && GCF_BIOME_SORT_FIELDS.includes(name)) {
      // SQL sorts NULLS LAST in both directions (LEFT JOIN), hence missing: '_last'.
      // `?? 1` is narrowing only: supportsBrowseSearch refuses a null level.
      const level = gcfEcosystemLevel(params) ?? 1;
      return { [`max_pct_l${level}`]: { order: direction, missing: '_last' } };
    }
    if (entity === 'gcfs' && name === CATEGORY_SHARE_SORT_FIELD) {
      // SQL orders NULLS LAST in both directions; with no single category both use their default.
      const category = categoryForShareSort(params);
      if (category) return { [categoryShareField(category)]: { order: direction, missing: '_last' } };
      return { [fallbackField]: { order: direction } };
    }
    // hasOwn: ?sortField=constructor or __proto__ would otherwise resolve to a built-in.
    return { [Object.hasOwn(sortMap, name) ? sortMap[name] : fallbackField]: { order: direction } };
  };
  const sort: Sort[] = multiFields.length
    ? multiFields.map((f, i) => sortEntry(f, orders[i] === 'asc' ? 'asc' : 'desc'))
    : [sortEntry(sortField, order)];
  // Tiebreaker last, so paging is stable when the sort keys collide.
  sort.push({ [idField]: { order: 'asc' } } satisfies Sort);

  return {
    from: offset,
    size: limit,
    track_total_hits: true,
    query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
    sort,
  };
}
