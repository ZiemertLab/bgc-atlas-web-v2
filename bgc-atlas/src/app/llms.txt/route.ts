import { API_ENDPOINTS } from '@/lib/api-catalog';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bgc-atlas.cs.uni-tuebingen.de';

export const dynamic = 'force-static';

const body = `# BGC Atlas

> ${(15985022).toLocaleString('en-US')} biosynthetic gene clusters (BGCs) detected in public metagenome
> assemblies, metagenome-assembled genomes, single-amplified genomes and
> isolate genomes, grouped into ${(614215).toLocaleString('en-US')} gene cluster families (GCFs) and
> annotated with the taxonomy and the environment each one came from.

Built and maintained in the Translational Genome Mining for Natural Products
group at the University of Tübingen.

## Entities

- **BGC** — one antiSMASH region on one contig. Identified by a UUID. Carries
  products, length, gene count, completeness, source sample and assembly,
  GTDB lineage and biome.
- **GCF** — a family of related BGCs from BiG-SLiCE clustering. Named
  \`GCF-v2b6-000001\` (the tag is the data release the clustering first shipped
  in) and given a two-word alias such as \`gallant-greenshank\`. A family
  named after a characterized compound is MIBiG-anchored.
- **Sample** — the environmental sample or genome an assembly came from, with
  coordinates where the source reported them, GOLD ecosystem path and ENVO terms.
- **Study** — the project a set of samples belongs to, ranked on the site by the
  families found only in that study.
- **Assembly** — the assembled sequence a BGC sits on, linking sample to BGC.

## Reading the numbers

- **Unclustered does not mean novel.** About 11% of BGCs join no family, and
  those regions are short — a median of 2 genes. It is a fragment-size effect.
- **Never read a GCF count without its coverage.** Coverage varies by study,
  so any family count is bounded by what could be placed at all: 89.4% of BGCs
  overall join a family, but a tenth of studies with 100 or more BGCs are below 81%. Clustered and
  unclustered counts belong side by side.
- **Product categories are multi-label.** A BGC can carry several, so category
  tallies exceed the BGC total and cannot be summed into a whole.
- **A length may be a lower bound.** A family whose members are all incomplete
  reports \`≥\` its longest member.

## API

Base: ${SITE_URL}
Every response is \`{ success, data }\`; list endpoints nest
\`{ data, total, limit, offset }\` inside \`data\`. Page with \`limit\` (max 200) and
\`offset\`. No authentication, no API key.

${API_ENDPOINTS.map((e) => `- \`${e.method} ${e.path}\` — ${e.summary}`).join('\n')}

Full parameter reference: ${SITE_URL}/llms-full.txt
OpenAPI 3.1 spec: ${SITE_URL}/openapi.json

## Bulk data

Whole-database exports in TSV and Parquet are at ${SITE_URL}/downloads —
prefer these to paging the API for whole-database work. They are versioned data
releases (R2.0-beta.1, ...): the current one is described in
${SITE_URL}/downloads/RELEASE.md, every release in
${SITE_URL}/downloads/releases/releases.json, and a release's files stay at
${SITE_URL}/downloads/releases/<release>/ while it is kept.

## Licence

Data produced by BGC Atlas — cluster annotations, family assignments, taxonomy
and harmonised environmental metadata — is CC BY 4.0. The underlying assemblies
and genomes keep the terms of the repository or publication they came from.
Study abstracts are reproduced only where their licence permits it.

## Citation

Name the data release you used (see Bulk data), then cite:

Bağcı C, Talamas-Tanner A, Ziemert N. BGC Atlas v2: biosynthetic gene clusters
with taxonomic and environmental context at scale. bioRxiv (2026).
https://doi.org/10.64898/2026.09.14.751540

Bağcı C, Nuhamunada M, Goyat H, Ladanyi C, Sehnal L, Blin K, Kautsar SA,
Tagirdzhanov A, Gurevich A, Mantri S, von Mering C, Udwary D, Medema MH,
Weber T, Ziemert N. BGC Atlas: a web resource for exploring the global chemical
diversity encoded in bacterial genomes. Nucleic Acids Research 53(D1):D618–D624
(2025). https://doi.org/10.1093/nar/gkae953
`;

export function GET() {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
