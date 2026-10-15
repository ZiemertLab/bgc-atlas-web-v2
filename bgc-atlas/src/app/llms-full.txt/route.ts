import { API_ENDPOINTS, type ApiEndpoint, type ApiParam } from '@/lib/api-catalog';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bgc-atlas.cs.uni-tuebingen.de';

// Rendered from lib/api-catalog.ts, the same source as /openapi.json.
export const dynamic = 'force-static';

// Array params are read with getAll; a reader sending a comma-joined list would silently match nothing.
const typeLabel = (p: ApiParam) =>
  p.type === 'array' ? `${p.items}, repeat the key` : p.type;

function render(endpoint: ApiEndpoint): string {
  const lines = [`### ${endpoint.method} ${endpoint.path}`, '', endpoint.summary];
  if (endpoint.description) lines.push('', endpoint.description);

  const path = (endpoint.params ?? []).filter((p) => p.in === 'path');
  const query = (endpoint.params ?? []).filter((p) => p.in === 'query');

  if (path.length) {
    lines.push('', 'Path parameters:');
    for (const p of path) lines.push(`  ${p.name} (${typeLabel(p)}) — ${p.description}`);
  }
  if (query.length) {
    // POST bodies carry their fields in the same list.
    lines.push('', endpoint.method === 'POST' ? 'Body fields:' : 'Query parameters:');
    for (const p of query) lines.push(`  ${p.name} (${typeLabel(p)}) — ${p.description}`);
  }

  lines.push('', `Returns: ${endpoint.returns}`);
  if (endpoint.bareResponse) {
    lines.push('  (No { success, data } envelope on this one.)');
  }
  if (endpoint.example) lines.push('', `Example: ${SITE_URL}${endpoint.example}`);
  return lines.join('\n');
}

const body = `# BGC Atlas — full API reference

Companion to ${SITE_URL}/llms.txt, which has the entity model, the caveats that
matter when reading these numbers, the licence and the citations. Read that
first; this file is the parameter detail.

Machine-readable equivalent: ${SITE_URL}/openapi.json

## Conventions

- Base URL: ${SITE_URL}
- No authentication and no API key.
- Almost every response is \`{ success: boolean, data: ... }\`, and an error adds
  \`error\` and \`message\`. The two \`/api/search/properties\` endpoints predate
  that envelope and return their own shape; each says so below.
- List endpoints nest their page inside \`data\`:
  \`{ success, data: { data: [...], total, limit, offset } }\`.
- \`limit\` defaults to 50 and is capped at 200. Page with \`offset\`.
- Filters combine with AND. Omit a filter to leave that dimension unconstrained.
- Identifiers are UUIDs unless stated otherwise. A study is also addressable by
  its \`study_key\`.

## Using it well

- **Narrow before you page.** \`/api/bgcs\` sits on 16.4 million rows; a deep
  offset with no filter is slow for you and expensive for the server. Filter by
  family, sample or assembly first.
- **For whole-database work, take the bulk export** at ${SITE_URL}/downloads
  rather than paging the API. The whole database is published as TSV and
  Parquet, as versioned data releases: name the one you used
  (${SITE_URL}/downloads/RELEASE.md).
- **\`/api/search/properties\` is the expressive one.** Nested boolean
  conditions over biosynthetic, taxonomic, environmental and geographic fields,
  in a single POST.

## Field glossary

- \`memberBgcCount\` — BGCs in a family.
- \`completeness\` — whether a region runs off the end of its contig. An
  incomplete region is a fragment, not a short cluster.
- \`petName\` — the two-word alias for a family; display only, never an identifier.
- \`mibigAnchored\` — the family is named after a characterized MIBiG compound.
- \`familyClass\` — \`seed\` (clustered from complete or median-length BGCs) or
  \`fragmented\` (clustered from what the seed could not place).
- \`knownCluster\` — a KnownClusterBLAST compound that speaks for the family, with
  the share of members supporting it. Null where the hits are too few to
  attribute the compound to the family.
- \`goldEcosystemPath\` — GOLD ecosystem classification, normalized.

## Endpoints

${API_ENDPOINTS.map(render).join('\n\n')}
`;

export function GET() {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
