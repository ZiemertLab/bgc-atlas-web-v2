import { describe, expect, it } from 'vitest';
import { mapGcfBrowseDocument } from './gcf-browse-mapper';

describe('mapGcfBrowseDocument', () => {
  it('maps a denormalized OpenSearch document to the existing GCF response shape', () => {
    expect(mapGcfBrowseDocument({
      gcf_id: '12345678-0000-0000-0000-000000000000',
      gcf_name: 'GCF-000042',
      family_class: 'seed',
      listed: true,
      member_bgc_count: 12,
      assembly_count: 3,
      complete_bgc_count: 10,
      partial_bgc_count: 2,
      avg_distance: 0.12,
      min_distance: 0.05,
      max_distance: 0.3,
      median_distance: 0.1,
      unique_product_categories: 1,
      product_categories: ['NRPS'],
      unique_taxa_count: 4,
      seed_assignments: 9,
      derived_assignments: 3,
      novel_assignments: 1,
      biome_distribution_l1: { Environmental: 100 },
    })).toMatchObject({
      id: '12345678-0000-0000-0000-000000000000',
      name: 'GCF-000042',
      familyClass: 'seed',
      listed: true,
      avgDistance: 0.12,
      memberBgcCount: 12,
      productCategories: ['NRPS'],
      seedAssignments: 9,
      derivedAssignments: 3,
      novelAssignments: 1,
      biomeDistributionByLevel: { 1: { Environmental: 100 } },
    });
  });

  it('maps pet_name to petName', () => {
    expect(mapGcfBrowseDocument({ gcf_id: 'x', pet_name: 'lightened-sow' }).petName)
      .toBe('lightened-sow');
  });

  it('yields null petName when the field is absent or not a string', () => {
    expect(mapGcfBrowseDocument({ gcf_id: 'x' }).petName).toBeNull();
    expect(mapGcfBrowseDocument({ gcf_id: 'x', pet_name: 42 }).petName).toBeNull();
  });

  it('maps the length statistics, taking the counts from the summary fields', () => {
    expect(mapGcfBrowseDocument({
      gcf_id: 'x',
      median_complete_len: 21_900,
      min_len: 1_000,
      max_len: 22_000,
      complete_bgc_count: 13,
      member_bgc_count: 37,
    }).lengthStats).toEqual({
      medianCompleteLen: 21_900,
      minLen: 1_000,
      maxLen: 22_000,
      completeCount: 13,
      memberCount: 37,
    });
  });

  it('keeps medianCompleteLen null for a family with no complete member', () => {
    // The reader falls back to maxLen and renders it as a '>=' lower bound.
    expect(mapGcfBrowseDocument({
      gcf_id: 'x',
      median_complete_len: null,
      min_len: 1_000,
      max_len: 28_800,
      complete_bgc_count: 0,
      member_bgc_count: 98,
    }).lengthStats).toMatchObject({ medianCompleteLen: null, maxLen: 28_800, completeCount: 0 });
  });

  it('yields null lengthStats for a document indexed before the field existed', () => {
    expect(mapGcfBrowseDocument({ gcf_id: 'x' }).lengthStats).toBeNull();
  });

  describe('share fields', () => {
    // GCF-v2b6-035292 as gcf_scalar_patch.py writes it: empty threshold arrays
    // are ABSENT, product_type_member_share is always present.
    const patched = {
      gcf_id: 'baa7a7d4-85ec-589b-a6dc-490322226d50',
      product_type_member_share: { 'RiPP-like': 99.96, hserlactone: 0.03, 'lanthipeptide-class-iv': 0.01 },
      product_types_ge10: ['RiPP-like'],
      product_types_ge50: ['RiPP-like'],
      product_types_ge90: ['RiPP-like'],
      eco_l3_ge10: ['Marine', 'Respiratory system'],
      resolved_pct_l1: 99.3,
      resolved_pct_l3: 63.11,
      resolved_pct_l5: 4.37,
      dom_ecosystem_l3: 'Marine',
      max_pct_l3: 34.6,
    };

    it('maps the shares, thresholds, resolved share and dominant ecosystem per level', () => {
      const row = mapGcfBrowseDocument(patched);
      expect(row.productTypeMemberShare).toEqual({
        'RiPP-like': 99.96, hserlactone: 0.03, 'lanthipeptide-class-iv': 0.01,
      });
      expect(row.productTypesAtLeast).toEqual({ 10: ['RiPP-like'], 50: ['RiPP-like'], 90: ['RiPP-like'] });
      expect(row.ecosystemsAtLeastByLevel?.[3]).toEqual({ 10: ['Marine', 'Respiratory system'], 50: [], 90: [] });
      expect(row.ecosystemResolvedPctByLevel).toEqual({ 1: 99.3, 2: null, 3: 63.11, 4: null, 5: 4.37 });
      expect(row.dominantEcosystemByLevel?.[3]).toEqual({ ecosystem: 'Marine', pct: 34.6 });
      expect(row.dominantEcosystemByLevel?.[4]).toBeNull();
    });

    it('reads an absent threshold array as "nothing clears it" once the index has the fields', () => {
      const row = mapGcfBrowseDocument({ gcf_id: 'x', product_type_member_share: {} });
      expect(row.productTypeMemberShare).toEqual({});
      expect(row.productTypesAtLeast).toEqual({ 10: [], 50: [], 90: [] });
      expect(row.ecosystemsAtLeastByLevel?.[1]).toEqual({ 10: [], 50: [], 90: [] });
    });

    it('sets none of them on a document from before the patch', () => {
      // An unpatched index still carries dom_ecosystem_l3/max_pct_l3. Mapping
      // them alone would let a reader take "no L2 dominant" for a fact.
      const row = mapGcfBrowseDocument({
        gcf_id: 'x', dom_ecosystem_l3: 'Marine', max_pct_l3: 34.6, eco_l3_ge10: ['Marine'],
      });
      for (const key of ['productTypeMemberShare', 'productTypesAtLeast', 'ecosystemsAtLeastByLevel',
        'ecosystemResolvedPctByLevel', 'dominantEcosystemByLevel']) {
        expect(row).not.toHaveProperty(key);
      }
    });
  });
});
