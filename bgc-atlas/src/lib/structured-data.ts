// Server-rendered JSON-LD so crawlers that run no JavaScript can read a detail page's facts.
// Use the exact @type Google documents for each field; it rejects schema.org subtypes.

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bgc-atlas.cs.uni-tuebingen.de';

// The site-wide Dataset declared in app/layout.tsx; shared so consumers merge the nodes.
export const SITE_DATASET_ID = `${SITE_URL}/#dataset`;

// Who built the atlas, as /about says in prose. Google checks `creator` (a recommended field) on
// every Dataset node it parses -- the site-wide one, each entity's and the nested `isPartOf`
// stub -- so all three carry this object. On a study page it names the atlas's derived data,
// not the sequencing study.
export const SITE_CREATOR = {
  '@type': 'Organization',
  name: 'Translational Genome Mining for Natural Products, University of Tübingen',
  url: 'https://uni-tuebingen.de/fakultaeten/mathematisch-naturwissenschaftliche-fakultaet/fachbereiche/interfakultaere-einrichtungen/imit/arbeitsgruppen/translational-genome-mining-for-natural-products/',
} as const;

export interface Variable {
  name: string;
  /** bigint (a Postgres count()) is normalized below; JSON.stringify throws on it. */
  value: string | number | bigint;
}

export interface EntityDatasetInput {
  path: string;
  identifier: string;
  name: string;
  description: string;
  alternateName?: string | null;
  keywords?: string[];
  variables?: Variable[];
  /** Attribution for reproduced text such as an abstract. */
  creditText?: string | null;
}

export function entityDataset({
  path,
  identifier,
  name,
  description,
  alternateName,
  keywords,
  variables,
  creditText,
}: EntityDatasetInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name,
    ...(alternateName ? { alternateName } : {}),
    description,
    ...(creditText ? { creditText } : {}),
    url: `${SITE_URL}${path}`,
    identifier,
    ...(keywords?.length ? { keywords } : {}),
    // Google requires `description` on every Dataset node, nested ones included.
    isPartOf: {
      '@type': 'Dataset',
      '@id': SITE_DATASET_ID,
      name: 'BGC Atlas',
      url: SITE_URL,
      description:
        'An atlas of biosynthetic gene clusters and the gene cluster families they form.',
      creator: SITE_CREATOR,
    },
    creator: SITE_CREATOR,
    publisher: {
      '@type': 'Organization',
      name: 'University of Tübingen',
      url: 'https://uni-tuebingen.de/en/',
    },
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true,
    ...(variables?.length
      ? {
          variableMeasured: variables.map((v) => ({
            '@type': 'PropertyValue',
            name: v.name,
            value: typeof v.value === 'bigint' ? Number(v.value) : v.value,
          })),
        }
      : {}),
  };
}
