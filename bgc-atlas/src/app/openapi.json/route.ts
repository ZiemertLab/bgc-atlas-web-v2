import { NextResponse } from 'next/server';
import { API_ENDPOINTS, type ApiEndpoint } from '@/lib/api-catalog';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bgc-atlas.cs.uni-tuebingen.de';

// Rendered from lib/api-catalog.ts, like /llms-full.txt, so the two cannot describe different APIs.
export const dynamic = 'force-static';

const ENVELOPE = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      description:
        'The payload. List endpoints nest a further { data, total, limit, offset } here.',
    },
    message: { type: 'string' },
  },
  required: ['success'],
};

function operation(endpoint: ApiEndpoint) {
  return {
    summary: endpoint.summary,
    ...(endpoint.description ? { description: endpoint.description } : {}),
    parameters: (endpoint.params ?? [])
      // POST body fields are in the catalog as params; they are not query parameters.
      .filter(() => endpoint.method === 'GET')
      .map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required ?? p.in === 'path',
        schema:
          p.type === 'array'
            ? { type: 'array', items: { type: p.items } }
            : { type: p.type },
        // form + explode = ?k=a&k=b, what searchParams.getAll reads; a comma-joined form would silently return nothing.
        ...(p.type === 'array' ? { style: 'form', explode: true } : {}),
        description: p.description,
      })),
    // ...and are described here as the body. `group` is recursive, so its schema is hoisted into components.schemas.
    ...(endpoint.bodySchema
      ? {
          requestBody: {
            // The body itself is required: the route parses JSON first, so no body is a 400.
            required: true,
            content: { 'application/json': { schema: endpoint.bodySchema } },
          },
        }
      : {}),
    responses: {
      '200': {
        description: endpoint.returns,
        content: {
          'application/json': {
            // The search endpoints predate the envelope and return their own shape.
            schema: endpoint.bareResponse ? { type: 'object' } : ENVELOPE,
          },
        },
      },
    },
  };
}

export function GET() {
  const paths: Record<string, Record<string, unknown>> = {};
  // `$ref` pointers resolve from the document root, not from `$defs` nested in a request body.
  const schemas: Record<string, Record<string, unknown>> = {};
  for (const endpoint of API_ENDPOINTS) {
    paths[endpoint.path] ??= {};
    paths[endpoint.path][endpoint.method.toLowerCase()] = operation(endpoint);
    Object.assign(schemas, endpoint.schemas ?? {});
  }

  return NextResponse.json(
    {
      openapi: '3.1.0',
      info: {
        title: 'BGC Atlas API',
        version: '2',
        summary:
          'Read access to biosynthetic gene clusters, gene cluster families, samples and studies.',
        description:
          'A subset of the app\'s routes: the entity endpoints worth depending on. ' +
          'Data produced by BGC Atlas is CC BY 4.0; the underlying assemblies keep the terms of the repository they came from.',
        license: {
          name: 'CC BY 4.0',
          url: 'https://creativecommons.org/licenses/by/4.0/',
        },
      },
      servers: [{ url: SITE_URL }],
      paths,
      ...(Object.keys(schemas).length ? { components: { schemas } } : {}),
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  );
}
