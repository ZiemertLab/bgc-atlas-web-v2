// Display-only labels keyed on the raw `data_sources.name`; filters, ids and API params keep
// the raw name.
export const DATA_SOURCE_DISPLAY_NAMES: Record<string, string> = {
  // The three Microflora Danica sources are distinct datasets from one project
  // (long-read whole-metagenome assemblies, and long- and short-read MAG
  // collections), and two of them share a study row. Short, so each fits on one
  // line in the /studies Source column.
  custom_microflora_danica: 'MFD metagenomes',
  'Microflora Danica (long-read)': 'MFD long-read MAGs',
  'Microflora Danica (short-read)': 'MFD short-read MAGs',
  custom_deep_sea_hydrothermal: 'Deep-Sea Hydrothermal',
  custom_fram_ras: 'FRAM RAS',
  custom_ocean_surface: 'Ocean Surface',
  custom_ziemert_lab: 'Ziemert Lab',
  custom_great_barrier_reef: 'Great Barrier Reef',
  custom_helgoland_2020: 'Helgoland 2020',
  'Ocean Microbiomics Database v2': 'OMDB',
};

export function formatDataSourceName(name: string): string {
  return DATA_SOURCE_DISPLAY_NAMES[name] ?? name;
}

// Keep in sync with `data_sources.source_url`; the row APIs don't carry it.
export const DATA_SOURCE_URLS: Record<string, string> = {
  custom_microflora_danica: 'https://www.nature.com/articles/s41586-025-09794-2',
  custom_deep_sea_hydrothermal: 'https://doi.org/10.1038/s41597-026-06612-w',
  custom_fram_ras: 'https://doi.org/10.1594/PANGAEA.946508',
  custom_ocean_surface: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12678497/',
  custom_ziemert_lab: 'https://doi.org/10.1093/gigascience/giaf135',
  custom_great_barrier_reef: 'https://doi.org/10.1038/s41586-026-10778-z',
  custom_helgoland_2020: 'https://doi.org/10.1186/s40168-023-01557-3',
  'Microflora Danica (long-read)': 'https://www.nature.com/articles/s41586-025-09794-2',
  'Microflora Danica (short-read)': 'https://www.nature.com/articles/s41586-025-09794-2',
  GEM: 'https://genome.jgi.doe.gov/portal/GEMs/GEMs.home.html',
  'Ocean Microbiomics Database v2': 'https://omdb.microbiomics.io/',
  OWC: 'https://doi.org/10.1128/msystems.00680-25',
  SMAG: 'https://microbma.github.io/project/SMAG.html',
  'SPIRE MAGs': 'https://spire.embl.de/',
  TPMC: 'https://ngdc.cncb.ac.cn/tpmc',
  GTDB: 'https://gtdb.ecogenomic.org/',
  MGnify: 'https://www.ebi.ac.uk/metagenomics/',
  metalog: 'https://metalog.embl.de/',
  SPIRE: 'https://spire.embl.de',
};

export function getDataSourceUrl(name: string): string | null {
  return DATA_SOURCE_URLS[name] ?? null;
}
