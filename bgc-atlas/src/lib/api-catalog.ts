// The public read API, described once: /openapi.json and /llms-full.txt both render from this.
// Deliberately a subset; contribute, job-polling and export-download routes are internal.

export type ApiScalarType = 'string' | 'integer' | 'number' | 'boolean';

interface ApiParamBase {
  name: string;
  in: 'query' | 'path';
  description: string;
  required?: boolean;
}

// `type: 'array'` means the key repeats (?k=a&k=b), only for params read with `getAll`;
// /api/statistics never splits `sourceType` on commas, so a comma-joined value is a 400.
export type ApiParam =
  | (ApiParamBase & { type: ApiScalarType; items?: never })
  | (ApiParamBase & { type: 'array'; items: ApiScalarType });

export interface ApiEndpoint {
  path: string;
  method: 'GET' | 'POST';
  summary: string;
  description?: string;
  params?: ApiParam[];
  /** Returns its own shape rather than the `{ success, data }` envelope. */
  bareResponse?: boolean;
  /** JSON Schema for a POST body (`requestBody`); hand-written since bodies can be recursive. */
  bodySchema?: Record<string, unknown>;
  /** Named schemas hoisted into `components.schemas`. A recursive type must live here: an
   *  embedded `$defs` is invisible from the OpenAPI document root, so `#/$defs/x` would dangle. */
  schemas?: Record<string, Record<string, unknown>>;
  /** Plain-language note on what comes back, for llms-full.txt. */
  returns: string;
  example?: string;
}

const FILTER_GROUP = 'PropertySearchFilterGroup';
const FILTER_CONDITION = 'PropertySearchFilterCondition';
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

// A condition that resolves to no clause would broaden the result, so unknown fields and
// unsupported operators are refused with a 400; only empty values are dropped silently.
const PROPERTY_SEARCH_SCHEMAS: Record<string, Record<string, unknown>> = {
  [FILTER_GROUP]: {
    type: 'object',
    description:
      'A boolean node: its conditions and nested groups combine with `operator`. Groups nest to any depth.',
    properties: {
      id: {
        type: 'string',
        description: 'Client-side key for the node. Ignored by the server; any string will do.',
      },
      operator: {
        type: 'string',
        enum: ['AND', 'OR'],
        description: 'How this node combines its conditions and child groups.',
      },
      conditions: { type: 'array', items: ref(FILTER_CONDITION) },
      groups: {
        type: 'array',
        items: ref(FILTER_GROUP),
        description: 'Nested groups. Send [] when there are none -- the server does not default it.',
      },
    },
    required: ['operator', 'conditions', 'groups'],
  },
  [FILTER_CONDITION]: {
    type: 'object',
    description:
      'One field test. A condition the server cannot use -- unknown field, or an operator that field does not accept -- is refused with 400 rather than skipped, because skipping it would widen the result set instead of narrowing it. The response carries `rejected`, one entry per bad condition with its `supportedOperators`. A condition with an EMPTY value is the exception: it is dropped in silence.',
    properties: {
      id: { type: 'string', description: 'Client-side key for the condition. Ignored by the server.' },
      field: {
        type: 'string',
        description:
          'A field id from /api/search/properties/fields, e.g. product or tax_genus. An id not in that list is refused with 400 -- running the query without it would answer a broader question.',
      },
      operator: {
        type: 'string',
        enum: [
          'equals', 'not_equals',
          'in', 'not_in',
          'contains', 'not_contains', 'starts_with', 'ends_with',
          'gt', 'gte', 'lt', 'lte', 'between',
        ],
        description:
          "Not every field takes every operator: use the field's own `operators.acceptedByApi` list from /api/search/properties/fields (its `operators.offeredByBuilder` is the narrower set the web builder offers, not the limit of the API). Broadly, keyword facets take in/not_in/equals/not_equals and often the substring operators, numbers take the comparisons and between, free text takes the substring operators, and boolean-backed fields such as is_complete take only equals/not_equals despite reading as `type: select`.",
      },
      value: {
        description:
          "The comparand: a scalar for most operators, an array for in/not_in, and a two-element [min, max] for between (either bound may be '' for a one-sided range).",
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
        ],
      },
    },
    required: ['field', 'operator', 'value'],
  },
};

// Paging clamps and the result-window ceiling come from lib/opensearch/client.ts and the index settings.
const PROPERTY_SEARCH_BODY: Record<string, unknown> = {
  type: 'object',
  description:
    'Every field is optional. An empty body ({}) matches every BGC, as does group: null.',
  properties: {
    group: {
      description: 'The condition tree. null (or omitted) matches every BGC.',
      anyOf: [ref(FILTER_GROUP), { type: 'null' }],
    },
    page: {
      type: 'integer',
      minimum: 1,
      default: 1,
      description:
        'Page number, 1-based. page * size must stay within 10,000, the index result window; past it the search fails. Use /downloads for bulk data instead of paging through a large match.',
    },
    size: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 25,
      description: 'Page size. Values above 100 are clamped to 100.',
    },
    sort: {
      type: 'object',
      description: 'Sort key. Omit for index order.',
      properties: {
        field: { type: 'string', description: 'A field id from /api/search/properties/fields.' },
        order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      },
      required: ['field'],
    },
    facetFields: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Fields to return facet counts for: the select-typed ids from /api/search/properties/fields. Anything else is ignored. Defaults to a standard set of twelve.',
    },
  },
};

const LIST_PARAMS: ApiParam[] = [
  { name: 'limit', in: 'query', type: 'integer', description: 'Page size. Default 50, maximum 200.' },
  { name: 'offset', in: 'query', type: 'integer', description: 'Rows to skip. Default 0.' },
  { name: 'sortField', in: 'query', type: 'string', description: 'Column to sort by.' },
  { name: 'sortOrder', in: 'query', type: 'string', description: "'asc' or 'desc'. Default 'asc'." },
  {
    name: 'advancedFilters',
    in: 'query',
    type: 'string',
    description:
      'Serialized filter group for compound AND/OR conditions. Produced by the UI query builder; the flat parameters above cover most needs.',
  },
];

const ID_PARAM = (what: string): ApiParam => ({
  name: 'id',
  in: 'path',
  type: 'string',
  required: true,
  description: `UUID of the ${what}.`,
});

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    path: '/api/gcfs',
    method: 'GET',
    summary: 'List gene cluster families',
    description: '614,215 families. Every filter is optional and they combine with AND.',
    params: [
      ...LIST_PARAMS,
      { name: 'search', in: 'query', type: 'string', description: 'Free text over family name and description.' },
      { name: 'id', in: 'query', type: 'string', description: 'Exact family UUID.' },
      { name: 'name', in: 'query', type: 'string', description: 'Family name, e.g. GCF-v2b6-000001.' },
      { name: 'minBgcs', in: 'query', type: 'integer', description: 'Minimum member BGC count.' },
      { name: 'maxBgcs', in: 'query', type: 'integer', description: 'Maximum member BGC count.' },
      { name: 'category', in: 'query', type: 'string', description: 'antiSMASH product category, e.g. terpene, NRPS. (Was productType, still accepted.)' },
      { name: 'biome', in: 'query', type: 'string', description: 'Biome the family occurs in.' },
      { name: 'ecosystemLevel', in: 'query', type: 'integer', description: 'GOLD ecosystem depth for the biome breakdown, 1-5. Default 1.' },
      { name: 'mibigAnchored', in: 'query', type: 'boolean', description: 'Only families named by a characterized MIBiG compound.' },
      { name: 'familyClass', in: 'query', type: 'string', description: 'seed or fragmented: families clustered from complete or median-length BGCs, or from what that seed could not place. Any other value is a 400.' },
    ],
    returns:
      'A page of families. Each carries name, petName, memberBgcCount, product and taxonomy distributions, length statistics, and mibigAnchored/mibigCompounds where the family is anchored.',
    example: '/api/gcfs?minBgcs=100&category=terpene&limit=10',
  },
  {
    path: '/api/gcfs/{id}',
    method: 'GET',
    summary: 'One gene cluster family',
    params: [ID_PARAM('family')],
    returns: 'The family with its member statistics, product categories and taxonomy.',
  },
  {
    path: '/api/gcfs/{id}/taxonomy-distribution',
    method: 'GET',
    summary: 'Taxonomic composition of a family',
    params: [ID_PARAM('family')],
    returns: 'Member BGC counts per taxon.',
  },
  {
    path: '/api/gcfs/{id}/environment',
    method: 'GET',
    summary: 'Environments a family was found in',
    params: [ID_PARAM('family')],
    returns: 'Biome and GOLD ecosystem breakdown for the family members.',
  },
  {
    path: '/api/gcfs/stats',
    method: 'GET',
    summary: 'Family statistics across all BGCs',
    returns: 'Product category distribution, binned family size distribution, and the full size distribution for a rank plot.',
  },
  {
    path: '/api/bgcs',
    method: 'GET',
    summary: 'List biosynthetic gene clusters',
    description:
      '15,985,022 clusters. Narrow before paging: unfiltered deep offsets are slow. Filtering by sample or assembly is much faster than free text.',
    params: [
      ...LIST_PARAMS,
      { name: 'search', in: 'query', type: 'string', description: 'Free text over cluster and assembly names.' },
      { name: 'id', in: 'query', type: 'string', description: 'Exact cluster UUID.' },
      { name: 'gcf', in: 'query', type: 'string', description: 'Family UUID the cluster belongs to.' },
      { name: 'sampleId', in: 'query', type: 'string', description: 'Sample UUID the cluster came from.' },
      { name: 'assembly', in: 'query', type: 'string', description: 'Assembly the cluster sits on.' },
      { name: 'category', in: 'query', type: 'string', description: 'antiSMASH product category: NRPS, PKS, RiPP, terpene, saccharide, other, or Hybrid for a region carrying several. (Was class, still accepted.)' },
      { name: 'product', in: 'query', type: 'string', description: 'Substring of an antiSMASH product, e.g. lassopeptide, T1PKS. Matches the product only, not the category. (Was typeText, still accepted.)' },
      { name: 'completeness', in: 'query', type: 'string', description: 'Whether the cluster runs off the end of its contig.' },
      { name: 'taxonomy', in: 'query', type: 'string', description: 'GTDB lineage match.' },
      { name: 'biome', in: 'query', type: 'string', description: 'Biome of the source sample.' },
      { name: 'goldEcosystem', in: 'query', type: 'string', description: 'GOLD ecosystem path.' },
      { name: 'lengthMin', in: 'query', type: 'integer', description: 'Minimum length in base pairs.' },
      { name: 'lengthMax', in: 'query', type: 'integer', description: 'Maximum length in base pairs.' },
      { name: 'genesMin', in: 'query', type: 'integer', description: 'Minimum gene count.' },
      { name: 'genesMax', in: 'query', type: 'integer', description: 'Maximum gene count.' },
      { name: 'latMin', in: 'query', type: 'number', description: 'Bounding box, minimum latitude.' },
      { name: 'latMax', in: 'query', type: 'number', description: 'Bounding box, maximum latitude.' },
      { name: 'lonMin', in: 'query', type: 'number', description: 'Bounding box, minimum longitude.' },
      { name: 'lonMax', in: 'query', type: 'number', description: 'Bounding box, maximum longitude.' },
      { name: 'dataSource', in: 'query', type: 'string', description: 'Originating data source.' },
    ],
    returns:
      'A page of clusters with products, length, gene count, completeness, family membership, source sample and assembly, GTDB lineage and biome.',
    example: '/api/bgcs?gcf=<family-uuid>&completeness=complete&limit=50',
  },
  {
    path: '/api/bgcs/{id}',
    method: 'GET',
    summary: 'One biosynthetic gene cluster',
    params: [ID_PARAM('cluster')],
    returns: 'The cluster with its coordinates, products, family, source sample and taxonomy.',
  },
  {
    path: '/api/samples',
    method: 'GET',
    summary: 'List samples',
    description:
      '857,976 samples. /samples and /genome-collections in the UI are this one endpoint split by source type: metagenome assemblies versus MAG, SAG and isolate genomes.',
    params: [
      ...LIST_PARAMS,
      { name: 'includeTaxonomy', in: 'query', type: 'boolean', description: 'Include the genome taxonomy block.' },
      { name: 'includeStudyLinks', in: 'query', type: 'boolean', description: 'Include links to the studies a sample belongs to.' },
      { name: 'includeGtdbAccession', in: 'query', type: 'boolean', description: 'Include the GTDB accession.' },
    ],
    returns:
      'A page of samples with coordinates where reported, biome and GOLD ecosystem terms, environmental measurements, source types, and BGC/GCF counts.',
  },
  {
    path: '/api/samples/{id}',
    method: 'GET',
    summary: 'One sample',
    params: [ID_PARAM('sample')],
    returns: 'The sample with its environmental metadata and assembly links.',
  },
  {
    path: '/api/studies',
    method: 'GET',
    summary: 'List studies',
    description: '44,295 studies, ranked by the families found only in that study.',
    params: [
      ...LIST_PARAMS,
      { name: 'search', in: 'query', type: 'string', description: 'Free text over study title and name.' },
      { name: 'biome', in: 'query', type: 'string', description: 'Primary biome of the study samples.' },
      { name: 'goldBucket', in: 'query', type: 'string', description: 'Coarse GOLD ecosystem bucket.' },
      { name: 'minBgcs', in: 'query', type: 'integer', description: 'Minimum total BGCs.' },
      { name: 'minExclusive', in: 'query', type: 'integer', description: 'Minimum study-exclusive families.' },
    ],
    returns:
      'A page of studies with sample and BGC counts, GCF coverage, distinct/exclusive/rare family counts, ' +
      'product category distribution and primary biome. Every row carries `abstract_state`, one of ' +
      '`available` (the atlas holds an abstract and serves it), `withheld` (a publication abstract exists ' +
      'and its licence does not permit us to redistribute it) or `absent` (none was collected). ' +
      'The text itself, its licence and a link to the publisher\'s copy are on /api/studies/{id}; ' +
      'a row is never silent about which of the three applies.',
  },
  {
    path: '/api/studies/{id}',
    method: 'GET',
    summary: 'One study',
    params: [ID_PARAM('study')],
    returns:
      'The study with its counts and identifiers. `abstract_state` says which of three cases applies. ' +
      '`available`: the text is in `abstract`, and `abstract_source`, `abstract_license` and ' +
      '`abstract_publisher` carry the attribution owed for reproducing it. ' +
      '`withheld`: a publication abstract exists and its licence does not permit redistribution, so ' +
      '`abstract` is null and `abstract_doi` / `abstract_url` point at the publisher\'s copy, which is ' +
      'where it may be read — it must not be reconstructed from anywhere else. ' +
      '`absent`: the atlas collected no abstract and none was withheld. ' +
      'A null `abstract` is therefore never on its own evidence that the study has none: read the state.',
  },
  {
    path: '/api/search/properties',
    method: 'POST',
    summary: 'Query builder over antiSMASH properties',
    description:
      'The most expressive entry point: nested boolean conditions over biosynthetic, taxonomic, environmental and geographic fields. Send a JSON body.',
    params: [
      {
        name: 'group',
        in: 'query',
        type: 'string',
        description:
          'The condition tree: { id, operator: "AND"|"OR", conditions: [], groups: [] }, nesting groups freely. null matches everything. A condition the server cannot use — unknown field, operator the field does not accept — is refused with 400 and `rejected`, rather than skipped, since skipping it would widen the result set.',
      },
      { name: 'page', in: 'query', type: 'integer', description: 'Page number, 1-based. page * size must stay within 10,000, the index result window.' },
      { name: 'size', in: 'query', type: 'integer', description: 'Page size. Default 25, maximum 100.' },
      { name: 'sort', in: 'query', type: 'string', description: '{ field, order: "asc"|"desc" }.' },
      { name: 'facetFields', in: 'query', type: 'string', description: 'Array of fields to return facet counts for. Defaults to a standard set.' },
    ],
    bodySchema: PROPERTY_SEARCH_BODY,
    schemas: PROPERTY_SEARCH_SCHEMAS,
    bareResponse: true,
    returns:
      '{ total, hits: [...], facets: { field: [{ value, count }] } } — its own shape, not the { success, data } envelope. `group: null` matches every BGC, but paging stops at result 10,000 (page * size), so it is not a way to dump the corpus — /downloads is.',
    example:
      "curl -X POST -H 'Content-Type: application/json' -d '{\"group\":null,\"page\":1,\"size\":5}' <base>/api/search/properties",
  },
  {
    path: '/api/search/properties/fields',
    method: 'GET',
    summary: 'Searchable properties',
    description:
      'The vocabulary behind the query builder: every field a property-search condition may name. Read it before constructing a query rather than guessing field ids.',
    bareResponse: true,
    returns:
      '{ fields: [{ id, label, type, plottable, operators: { acceptedByApi, offeredByBuilder }, options? }] } — 85 fields. `id` is what a condition\'s `field` takes. The two operator lists are deliberately different and a programmatic client wants the first: `acceptedByApi` is every operator the server will build a clause for on that field, and the same set it quotes back when it refuses — a condition using anything else is rejected with 400, not run. `offeredByBuilder` is the narrower list the web query builder puts in its dropdown, kept short for the people using it. They differ on all 85: `product` accepts contains/not_contains/starts_with/ends_with and offers only the set operators, `is_complete` accepts not_equals and offers only equals. Read only the builder list and those queries stay undiscoverable. Neither list follows from `type`: `is_complete` is `type: select` but boolean underneath, so `in` is not accepted at all. `options` carries the fixed value list for the 7 fields that have one (category, candidate kind, sample type, the two boolean fields, and the curated data source and tailoring enzyme class, whose values appear in no other endpoint — tailoring class is virtual and queries pfam). `plottable` marks the fields a distribution can be drawn for; `facetFields` on a property search is narrower — it wants the select-typed ids. Its own shape, not the { success, data } envelope.',
    example: '/api/search/properties/fields',
  },
  {
    path: '/api/search/properties/facet-values',
    method: 'GET',
    summary: 'Allowed values for a searchable property',
    params: [
      { name: 'field', in: 'query', type: 'string', required: true, description: 'The facet field to enumerate. Omitting it returns 400.' },
      { name: 'prefix', in: 'query', type: 'string', description: 'Only values starting with this prefix.' },
      { name: 'size', in: 'query', type: 'integer', description: 'Maximum values to return. Default 20.' },
    ],
    bareResponse: true,
    returns: '{ field, values } — its own shape, not the { success, data } envelope. Use it to discover the vocabulary before building a query.',
    example: '/api/search/properties/facet-values?field=product_category&size=10',
  },
  {
    path: '/api/assemblies',
    method: 'GET',
    summary: 'List assemblies',
    params: LIST_PARAMS,
    returns: 'A page of assemblies with their source sample and BGC counts.',
  },
  {
    path: '/api/data-sources',
    method: 'GET',
    summary: 'List data sources',
    returns: 'The 17 repositories and published datasets the Atlas draws on, with source type and URL.',
  },
  {
    path: '/api/statistics',
    method: 'GET',
    summary: 'Site-wide totals',
    params: [
      {
        name: 'sourceType',
        in: 'query',
        type: 'array',
        items: 'string',
        description:
          'Restrict to metagenome, isolate, MAG or SAG. Repeat the key to pass several — ?sourceType=isolate&sourceType=MAG. A comma-joined list is read as one source type named "isolate,MAG" and is rejected with a 400 naming the four valid values.',
      },
    ],
    returns:
      'totalSamples, totalAssemblies, totalBgcs, totalCompleteBgcs, totalGcfs, totalMetagenomeSamples, totalMetagenomeAssemblies, totalGenomes.',
    example: '/api/statistics?sourceType=metagenome',
  },
  {
    path: '/api/statistics/gcfs',
    method: 'GET',
    summary: 'Family statistics',
    returns: 'Site-wide family counts and coverage.',
  },
];
