import { describe, it, expect } from 'vitest';
import { entityDataset, SITE_DATASET_ID } from './structured-data';

// Google treats every object with an @type as an item and checks each Dataset item for `field`
// on its own: description is required, creator recommended.
function datasetNodesMissing(field: string, o: unknown, path = '$'): string[] {
  const bad: string[] = [];
  if (Array.isArray(o)) o.forEach((v, i) => bad.push(...datasetNodesMissing(field, v, `${path}[${i}]`)));
  else if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    if (r['@type'] === 'Dataset' && !r[field]) bad.push(path);
    for (const [k, v] of Object.entries(r)) bad.push(...datasetNodesMissing(field, v, `${path}.${k}`));
  }
  return bad;
}

describe('entityDataset', () => {
  const node = entityDataset({
    path: '/gcfs/bac82e54-2ce1-5303-9788-92f065f8e12f',
    identifier: 'bac82e54-2ce1-5303-9788-92f065f8e12f',
    name: 'GCF-235002',
    description: 'GCF-235002: gene cluster family containing 52 BGCs.',
    variables: [{ name: 'Member BGCs', value: BigInt(52) }],
  });

  it('has no Dataset node without a description', () => {
    expect(datasetNodesMissing('description', node)).toEqual([]);
  });

  it('has no Dataset node without a creator', () => {
    expect(datasetNodesMissing('creator', node)).toEqual([]);
  });

  it('ties isPartOf to the site-wide Dataset by @id', () => {
    expect((node.isPartOf as Record<string, unknown>)['@id']).toBe(SITE_DATASET_ID);
  });

  it('still serialises with a bigint variable', () => {
    expect(() => JSON.stringify(node)).not.toThrow();
  });
});
