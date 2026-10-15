export interface AlsoInFamily {
  id: string;
  name: string | null;
  petName: string | null;
  familyClass: string | null;
  /** Unlisted families have no detail page, so they must not be linked. */
  listed: boolean;
  rank: number;
  distance: number | null;
}

export interface BgcDetail {
  id: string;
  assembly: string;
  assemblyDisplay: string;
  assemblySourceType: string | null;
  name: string | null;
  category: string | null;
  categories: string[];
  productCategories: string[];
  products: string[];
  completeness: "complete" | "partial";
  contig: string | null;
  startPos: number;
  endPos: number;
  length: number;
  genes: number | null;
  gcf: string | null;
  gcfName: string | null;
  gcfPetName: string | null;
  gcfFamilyClass: string | null;
  // BiG-SLiCE distance to the GCF; lower = more similar.
  distance: number | null;
  /**
   * Other families this BGC qualifies for (via sequence containment). Ordered by
   * `rank` (bitscore), not distance, so an entry can be nearer than the primary family.
   */
  alsoInFamilies: AlsoInFamily[];
  // KnownClusterBLAST / ClusterCompare hit against MIBiG; null for most regions.
  // Not the same claim as a family's MIBiG anchor (BiG-SLiCE co-membership).
  mibigHomology: {
    knownClusterTop: string | null;
    knownClusterCompound: string | null;
    /** KnownClusterBLAST similarity, 0-100. */
    knownClusterSimilarity: number | null;
    /** ClusterCompare's best hit; its score is 0-1, a different scale. */
    comparisonTop: string | null;
    comparisonScore: number | null;
  } | null;
  antismashRunId: string | null;
  anchor: string | null;
  biome: string;
  biomeLevels: string[];
  biomeEnvironment: string[];
  goldEcosystemPath: string | null;
  goldEcosystemMetadata: Record<string, unknown> | null;
  sampleIds: string[];
  sampleLabels: string[];
  taxonomyDomain: string | null;
  taxonomyPhylum: string | null;
  taxonomyClass: string | null;
  taxonomyOrder: string | null;
  taxonomyFamily: string | null;
  taxonomyGenus: string | null;
  taxonomySpecies: string | null;
  gtdbLineage: string | null;
}
