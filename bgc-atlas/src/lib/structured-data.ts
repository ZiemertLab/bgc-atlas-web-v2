// Server-rendered JSON-LD so crawlers that run no JavaScript can read a detail page's facts.
// Use the exact @type Google documents for each field; it rejects schema.org subtypes.

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bgc-atlas.cs.uni-tuebingen.de';

// The site-wide Dataset declared in app/layout.tsx; shared so consumers merge the nodes.
export const SITE_DATASET_ID = `${SITE_URL}/#dataset`;

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
    },
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
