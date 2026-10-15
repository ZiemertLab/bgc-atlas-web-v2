import { describe, it, expect } from 'vitest';
import {
  cellBounds, cellCenter, coarserInterval, foldCell, geoColorField,
  GEO_INTERVALS, goldLegendKeys, goldTermLists, intervalForZoom, normalizeBbox,
} from '@/lib/opensearch/geo-grid';

describe('intervalForZoom', () => {
  it('serves the whole world at the coarsest grid', () => {
    expect(intervalForZoom(0)).toBe(5);
    expect(intervalForZoom(1)).toBe(5);
    expect(intervalForZoom(2)).toBe(5);
  });

  it('refines one ladder step per zoom level', () => {
    expect(intervalForZoom(3)).toBe(2);
    expect(intervalForZoom(4)).toBe(1);
    expect(intervalForZoom(5)).toBe(0.5);
    expect(intervalForZoom(6)).toBe(0.25);
    expect(intervalForZoom(10)).toBe(0.01);
  });

  it('clamps past the finest step instead of extrapolating', () => {
    expect(intervalForZoom(18)).toBe(0.01);
    expect(intervalForZoom(-4)).toBe(5);
    expect(intervalForZoom(Number.NaN)).toBe(5);
  });

  it('only ever returns an allowlisted interval', () => {
    for (let z = -2; z <= 20; z++) expect(GEO_INTERVALS).toContain(intervalForZoom(z));
  });
});

describe('coarserInterval', () => {
  it('steps up the ladder', () => {
    expect(coarserInterval(0.01)).toBe(0.02);
    expect(coarserInterval(1)).toBe(2);
  });

  it('returns null at the top', () => {
    expect(coarserInterval(5)).toBeNull();
    expect(coarserInterval(123)).toBeNull();
  });
});

describe('cell geometry', () => {
  it('treats the bucket key as the cell lower edge', () => {
    expect(cellBounds(10, 20, 1)).toEqual({ latMin: 10, latMax: 11, lonMin: 20, lonMax: 21 });
    expect(cellCenter(10, 20, 1)).toEqual([10.5, 20.5]);
  });

  it('handles negative coordinates', () => {
    expect(cellBounds(-33.5, -70.5, 0.5)).toEqual({ latMin: -33.5, latMax: -33, lonMin: -70.5, lonMax: -70 });
  });

  it('rounds away floating-point histogram key noise', () => {
    // 30.1 + 0.1 is 30.200000000000003 in IEEE754 — never show that to a user.
    expect(cellBounds(30.1, 0.1, 0.1).latMax).toBe(30.2);
    expect(cellCenter(30.1, 0.1, 0.1)).toEqual([30.15, 0.15]);
  });
});

describe('goldTermLists', () => {
  const paths = [
    'Host-associated:Human:Digestive system:Large intestine:Fecal',
    'Host-associated:Plants:Rhizosphere',
    'Environmental:Terrestrial:Soil',
    'Environmental:Aquatic:Marine:Pelagic zone',
    'Environmental:Aquatic:Freshwater:Lake',
    'Environmental:Air',
    'Engineered:Bioreactor',
    'Mixed',
  ];

  it('groups every path under its display bucket', () => {
    expect(goldTermLists(paths)).toEqual({
      'host-animal': ['Host-associated:Human:Digestive system:Large intestine:Fecal'],
      'host-plant': ['Host-associated:Plants:Rhizosphere'],
      'soil-terrestrial': ['Environmental:Terrestrial:Soil'],
      marine: ['Environmental:Aquatic:Marine:Pelagic zone'],
      freshwater: ['Environmental:Aquatic:Freshwater:Lake'],
      'other-environmental': ['Environmental:Air'],
      engineered: ['Engineered:Bioreactor'],
      mixed: ['Mixed'],
    });
  });

  it('leaves unclassifiable paths to the aggregation other-bucket', () => {
    expect(goldTermLists(['Nonsense:Path'])).toEqual({});
  });

  it('keeps every legend key addressable', () => {
    expect(goldLegendKeys()).toContain('unknown');
    expect(goldLegendKeys()).toHaveLength(9);
  });
});

describe('foldCell', () => {
  const legend = new Map([['marine', 0], ['soil-terrestrial', 1]]);
  const OTHER = 2;

  it('picks the dominant slot and sorts the breakdown by count', () => {
    const { dom, pairs } = foldCell(100, [['marine', 30], ['soil-terrestrial', 70]], legend, OTHER);
    expect(dom).toBe(1);
    expect(pairs).toEqual([[1, 70], [0, 30]]);
  });

  it('folds values outside the legend into the other slot', () => {
    const { pairs } = foldCell(10, [['marine', 6], ['engineered', 4]], legend, OTHER);
    expect(pairs).toEqual([[0, 6], [OTHER, 4]]);
  });

  it('accounts for docs where the field is unset', () => {
    // 10 docs in the cell, only 4 carry a value — the other 6 must not vanish.
    const { dom, pairs } = foldCell(10, [['marine', 4]], legend, OTHER);
    expect(pairs).toEqual([[OTHER, 6], [0, 4]]);
    expect(dom).toBe(OTHER);
  });

  it('merges unset docs with out-of-legend values in one slot', () => {
    const { pairs } = foldCell(10, [['marine', 2], ['engineered', 3]], legend, OTHER);
    expect(pairs).toEqual([[OTHER, 8], [0, 2]]);
  });

  it('reports no dominant slot for an uncoloured cell', () => {
    expect(foldCell(0, [], legend, OTHER)).toEqual({ dom: -1, pairs: [] });
  });

  it('ignores empty buckets rather than emitting zero-count pairs', () => {
    const { pairs } = foldCell(5, [['marine', 5], ['soil-terrestrial', 0]], legend, OTHER);
    expect(pairs).toEqual([[0, 5]]);
  });
});

describe('normalizeBbox', () => {
  it('passes a normal viewport through', () => {
    expect(normalizeBbox({ latMin: 10, latMax: 20, lonMin: -5, lonMax: 5 }))
      .toEqual({ latMin: 10, latMax: 20, lonMin: -5, lonMax: 5 });
  });

  it('clamps latitudes panned past the poles', () => {
    expect(normalizeBbox({ latMin: -120, latMax: 130, lonMin: 0, lonMax: 10 }))
      .toEqual({ latMin: -90, latMax: 90, lonMin: 0, lonMax: 10 });
  });

  it('drops a longitude span that wraps the globe', () => {
    expect(normalizeBbox({ latMin: 10, latMax: 20, lonMin: -400, lonMax: 400 }))
      .toEqual({ latMin: 10, latMax: 20 });
  });

  it('rejects inverted and non-finite bounds', () => {
    expect(normalizeBbox({ latMin: 20, latMax: 10, lonMin: 5, lonMax: 1 })).toBeNull();
    expect(normalizeBbox({ latMin: Number.NaN, latMax: 10, lonMin: 0, lonMax: 1 }))
      .toEqual({ lonMin: 0, lonMax: 1 });
    expect(normalizeBbox(null)).toBeNull();
  });
});

describe('geoColorField', () => {
  it('resolves supported fields and rejects anything else', () => {
    expect(geoColorField('gold_ecosystem')?.kind).toBe('gold');
    expect(geoColorField('tax_phylum')?.kind).toBe('terms');
    expect(geoColorField('core_seq')).toBeNull();
    expect(geoColorField(null)).toBeNull();
  });
});
