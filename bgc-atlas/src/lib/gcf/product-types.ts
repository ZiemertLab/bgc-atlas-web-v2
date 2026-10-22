/**
 * Every antiSMASH product type a listed family carries, as gcf_browse indexes
 * them in `product_terms` (the any-member union, 99 values).
 *
 * Taken from a terms aggregation on gcf_browse_v20261022share, 2026-10-22, and
 * kept as RAW antiSMASH names, ungrouped: the four
 * lanthipeptide classes are four types here.
 *
 * Its one job is to read OLD links. The "Product" filter used to be a text field
 * matched by substring against every member's product, so `contains lanthi`
 * meant "any of the five lanthipeptide classes". To keep returning what it
 * returned, a stored condition like that is expanded, on read, into the types
 * it matches (lib/filters/legacy-conditions.ts) -- which needs the vocabulary
 * synchronously, in the browser as well as the server.
 *
 * The filter builder does NOT read this list: its value picker asks the index
 * (facet-values, `gcf_product_type`), so a type added by a future antiSMASH run
 * is offered without a code change. A type added here only matters for old
 * links, and an old link cannot have meant a type that did not exist yet.
 */
export const GCF_PRODUCT_TYPES: readonly string[] = [
  '2dos', 'CDPS', 'HR-T2PKS', 'NAGGN', 'NAPAA', 'NI-siderophore', 'NRP-metallophore',
  'NRPS', 'NRPS-like', 'PBDE', 'PKS-like', 'PUFA', 'PpyS-KS', 'RCDPS', 'RRE-containing',
  'RaS-RiPP', 'RiPP-like', 'T1PKS', 'T2PKS', 'T3PKS', 'acyl_amino_acids', 'amglyccycl',
  'aminocoumarin', 'aminopolycarboxylic-acid', 'archaeal-RiPP', 'arylpolyene',
  'atropopeptide', 'aureonuclemycin', 'azole-containing-RiPP', 'azoxy-crosslink',
  'azoxy-dimer', 'benzoxazole', 'betalactone', 'blactam', 'bottromycin', 'butyrolactone',
  'crocagin', 'cyanobactin', 'cyclic-lactone-autoinducer', 'cytokinin', 'darobactin',
  'deazapurine', 'ectoine', 'epipeptide', 'fungal-RiPP', 'fungal_CDPS', 'furan',
  'glycocin', 'guanidinotides', 'hglE-KS', 'hserlactone', 'hydrogen-cyanide',
  'hydroxytropolone', 'indole', 'isocyanide', 'isocyanide-nrp', 'ladderane',
  'lanthipeptide-class-i', 'lanthipeptide-class-ii', 'lanthipeptide-class-iii',
  'lanthipeptide-class-iv', 'lanthipeptide-class-v', 'lassopeptide', 'leupeptin',
  'linaridin', 'lincosamides', 'lipolanthine', 'melanin', 'methanobactin',
  'microviridin', 'mycosporine', 'nitropropanoic_acid', 'nucleoside', 'oligosaccharide',
  'opine-like-metallophore', 'other', 'phenazine', 'phosphoglycolipid', 'phosphonate',
  'phosphonate-like', 'polyhalogenated-pyrrole', 'polyyne', 'prodigiosin', 'proteusin',
  'pyrrolidine', 'ranthipeptide', 'redox-cofactor', 'resorcinol', 'sactipeptide',
  'spliceotide', 't3nrps-iterative', 'terpene', 'terpene-precursor', 'thioamide-NRP',
  'thioamitides', 'transAT-PKS', 'transAT-PKS-like', 'triceptide', 'tropodithietic-acid',
];
