// KnownClusterBLAST display cutoffs. No imports: read by both the OpenSearch
// client (server) and the Property Search cells (client).

/**
 * Minimum KnownClusterBLAST similarity for a hit to be shown anywhere on the site.
 *
 * The raw field is mostly noise: of the 3,045,887 BGCs carrying a top hit, 1,824,387
 * (60%) score under 30 -- a couple of genes matching a reference by chance. The
 * distribution then thins out and spikes hard at exactly 100 (662,434 BGCs). Cutting
 * at 50 keeps 962,069 BGCs across 66,659 families and drops the noise mass entirely.
 */
export const KNOWNCLUSTER_MIN_SIMILARITY = 50;

/**
 * Minimum share of a family's members that must carry the hit before the family is
 * labelled with its compound.
 *
 * The similarity threshold gates hit QUALITY, not how much of the family it speaks
 * for, and those are different failures. GCF-000336 has 12 members out of 54,956
 * matching geosmin at 100% -- every one a good hit, together 0.02% of the family.
 * Naming that family "geosmin" would be a false attribution, so it is blanked.
 */
export const KNOWNCLUSTER_MIN_FAMILY_COVERAGE = 5;
