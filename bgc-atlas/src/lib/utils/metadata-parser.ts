import { ecosystemBadgeNoBorder } from './ecosystem-palette';

type SampleLocationShape = {
  lat?: number;
  lon?: number;
  meta?: {
    geo_loc_name?: string;
    sample_meta_map?: {
      geographic_location_country_and_or_sea_region?: Array<{ value?: string }>;
    };
  };
};

export function parseLocation(sample: unknown): string {
  if (!sample || typeof sample !== 'object') return 'Unknown';
  const { lat, lon, meta } = sample as SampleLocationShape;

  if (typeof lat === 'number' && typeof lon === 'number') {
    return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  }

  if (!meta || typeof meta !== 'object') return 'Unknown';

  if (meta.geo_loc_name) {
    return normalizeLocation(meta.geo_loc_name);
  }

  const region = meta.sample_meta_map?.geographic_location_country_and_or_sea_region?.[0]?.value;
  if (region) {
    return normalizeLocation(region);
  }

  return 'Unknown';
}

function normalizeLocation(location: string): string {
  if (!location) return 'Unknown';
  
  const loc = location.trim();
  
  if (loc.includes(':')) {
    return loc.replace(':', ',');
  }
  
  if (loc.includes('USA: ')) {
    return loc.replace('USA: ', 'USA, ');
  }

  if (loc.includes(', laboratory')) {
    return loc.replace(', laboratory', '');
  }

  return loc;
}

export type PrimaryBiomeKey = 'host-associated' | 'environmental' | 'engineered' | 'mixed' | 'unknown';

const PRIMARY_BIOME_COLORS: Record<PrimaryBiomeKey, string> = {
  'host-associated': ecosystemBadgeNoBorder('host-associated'),
  environmental: ecosystemBadgeNoBorder('environmental'),
  engineered: ecosystemBadgeNoBorder('engineered'),
  mixed: ecosystemBadgeNoBorder('mixed'),
  unknown: ecosystemBadgeNoBorder('unknown'),
};

const PRIMARY_BIOME_ALIASES: Record<string, PrimaryBiomeKey> = {
  'host associated': 'host-associated',
  'animal associated': 'host-associated',
  'animal host': 'host-associated',
  'human': 'host-associated',
  'human associated': 'host-associated',
  'plant associated': 'host-associated',
  'plant associated material': 'host-associated',
  'plant host': 'host-associated',
  'leaf': 'host-associated',
  'plant matter': 'host-associated',
  'rhizosphere': 'host-associated',
  'rhizoplane': 'host-associated',
  'phylloplane': 'host-associated',
  'rhizosphere environment': 'host-associated',
  'plant associated environment': 'host-associated',
  'animal associated environment': 'host-associated',
  'animal-associated-environment': 'host-associated',
  'animal manure': 'environmental',
  'environment determined by a biofilm on an animal surface': 'host-associated',

  'environmental': 'environmental',
  'terrestrial biome': 'environmental',
  'aquatic': 'environmental',
  'aquatic biome': 'environmental',
  'detritus': 'environmental',
  'marine': 'environmental',
  'marine biome': 'environmental',
  'marine benthic biome': 'environmental',
  'marine benthic feature': 'environmental',
  'marine pelagic biome': 'environmental',
  'marginal sea biome': 'environmental',
  'ocean': 'environmental',
  'ocean biome': 'environmental',
  'coastal sea water': 'environmental',
  'coastal water body': 'environmental',
  'lagoon': 'environmental',
  'bay': 'environmental',
  'inlet': 'environmental',
  'beach': 'environmental',
  'continental shelf': 'environmental',
  'estuary': 'environmental',
  'estuarine biome': 'environmental',
  'brackish water': 'environmental',
  'moor': 'environmental',
  'marine salt marsh biome': 'environmental',
  'saline marsh': 'environmental',
  'mangrove biome': 'environmental',
  'neritic epipelagic zone biome': 'environmental',
  'deep marine sediment': 'environmental',
  'marine hydrothermal vent': 'environmental',
  'marine hydrothermal vent biome': 'environmental',
  'hydrothermal vent': 'environmental',
  'freshwater': 'environmental',
  'freshwater river': 'environmental',
  'fresh water': 'environmental',
  'freshwater biome': 'environmental',
  'freshwater lake': 'environmental',
  'freshwater lake biome': 'environmental',
  'lake water': 'environmental',
  'freshwater river biome': 'environmental',
  'large river biome': 'environmental',
  'lake': 'environmental',
  'lake sediment': 'environmental',
  'lake bottom mud': 'environmental',
  'hypereutrophic lake': 'environmental',
  'saline lake': 'environmental',
  'alkaline salt lake': 'environmental',
  'pond': 'environmental',
  'pond bed': 'environmental',
  'river': 'environmental',
  'river water': 'environmental',
  'mud': 'environmental',
  'cold seep': 'environmental',
  'canyon': 'environmental',
  'mud volcano': 'environmental',
  'anaerobic sludge': 'environmental',
  'gravel': 'environmental',
  'container of an intermittent pond': 'environmental',
  'river valley': 'environmental',
  'lentic water body': 'environmental',
  'surface water': 'environmental',
  'drinking water': 'environmental',
  'drinking water reservoir': 'environmental',
  'groundwater': 'environmental',
  'aquifer': 'environmental',
  'terrestrial': 'environmental',
  'soil': 'environmental',
  'forest': 'environmental',
  'forest biome': 'environmental',
  'forest soil': 'environmental',
  'forested area': 'environmental',
  'area of mixed forest': 'environmental',
  'area of evergreen forest': 'environmental',
  'area of deciduous forest': 'environmental',
  'area of tundra': 'environmental',
  'area of barren land': 'environmental',
  'bark': 'environmental',
  'area of rocky shore': 'environmental',
  'desert': 'environmental',
  'desert area': 'environmental',
  'desert biome': 'environmental',
  'desert sand': 'environmental',
  'grassland biome': 'environmental',
  'grassland area': 'environmental',
  'grassland soil': 'environmental',
  'plain': 'environmental',
  'flood plain': 'environmental',
  'flooded savanna biome': 'environmental',
  'savanna biome': 'environmental',
  'prairie': 'environmental',
  'shrubland biome': 'environmental',
  'tropical biome': 'environmental',
  'alpine biome': 'environmental',
  'alpine soil': 'environmental',
  'mountain': 'environmental',
  'montane forest': 'environmental',
  'montane grassland biome': 'environmental',
  'tundra': 'environmental',
  'tundra biome': 'environmental',
  'polar biome': 'environmental',
  'permafrost': 'environmental',
  'peatland': 'environmental',
  'ice-bearing permafrost thawing process': 'environmental',
  'ice bearing permafrost thawing process': 'environmental',
  'glacier': 'environmental',
  'cryosphere': 'environmental',
  'aerosol': 'environmental',
  'alkaline water': 'environmental',
  'anaerobic sediment': 'environmental',
  'biofilm material': 'environmental',
  'coniferous forest biome': 'environmental',
  'anaerobic mud': 'environmental',
  'air': 'environmental',
  'sediment': 'environmental',
  'sedimentary stratum': 'environmental',
  'wetland': 'environmental',
  'freshwater wetland ecosystem': 'environmental',
  'peat soil': 'environmental',
  'fen': 'environmental',
  'palsa': 'environmental',
  'blanket bog': 'environmental',
  'biocrust': 'environmental',
  'cave': 'environmental',
  'field': 'environmental',
  'vegetated area': 'environmental',
  'biofilm': 'environmental',
  'dense settlement biome': 'environmental',
  'cliff': 'environmental',
  'dune': 'environmental',
  'island': 'environmental',
  'peninsula': 'environmental',
  'coast': 'environmental',
  'ridge': 'environmental',
  'plateau': 'environmental',
  'rock': 'environmental',
  'coral reef': 'environmental',
  'marine coral reef biome': 'environmental',
  'kelp forest': 'environmental',
  'mediterranean sea biome': 'environmental',
  'mediterranean': 'environmental',
  'microbial mat': 'environmental',
  'geyser': 'environmental',
  'hot spring': 'environmental',
  'liquid water': 'environmental',
  'brine': 'environmental',
  'brine pool': 'environmental',
  'cryoconite deposit': 'environmental',
  'planktonic material': 'environmental',
  'alas': 'environmental',
  'algal material': 'environmental',
  'sand': 'environmental',
    'agricultural field': 'environmental',
    'agricultural soil': 'environmental',
    'greenhouse soil': 'environmental',
    'contaminated soil': 'environmental',
    'agricultural ecosystem': 'environmental',
    'arable land': 'environmental',
    'area of cropland': 'environmental',
    'cropland biome': 'environmental',
    'paddy field': 'environmental',
    'contaminated water': 'environmental',
    'oil palm plantation': 'environmental',
    'banana plantation': 'environmental',
    'planted forest': 'environmental',
    'pasturable land': 'environmental',
  'bush area': 'environmental',
  'bulk soil': 'environmental',
  'channel': 'environmental',
  'currency note': 'environmental',
  'organic material': 'environmental',
  'endolithic environment': 'environmental',

  'built environment': 'engineered',
  'engineered': 'engineered',
  'anthropogenic': 'engineered',
  'anthropogenic environment': 'engineered',
  'anthropogenic contamination feature': 'engineered',
  'anthropogenic environmental material': 'engineered',
  'anthropogenic terrestrial biome': 'engineered',
  'urban': 'engineered',
  'urban biome': 'engineered',
  'city': 'engineered',
  'coral bleaching process': 'engineered',
  'populated place': 'engineered',
  'informal settlement': 'engineered',
  'hospital': 'engineered',
  'building': 'engineered',
  'commercial building': 'engineered',
  'research facility': 'engineered',
  'garden': 'engineered',
  'laboratory facility': 'engineered',
  'human house': 'engineered',
  'sewage': 'engineered',
  'waste water': 'engineered',
  'wastewater': 'engineered',
  'industrial wastewater': 'engineered',
  'activated sludge': 'engineered',
  'bioreactor': 'engineered',
  'aerobic bioreactor': 'engineered',
  'anaerobic bioreactor': 'engineered',
  'biogas plant': 'engineered',
  'solid waste': 'engineered',
  'compost': 'engineered',
  'mesocosm': 'engineered',
  'feedlot': 'engineered',
  'animal aquaculture process': 'engineered',
  'drainage canal': 'engineered',
  'drainage basin': 'engineered',
  'acid mine drainage': 'engineered',
  'ditch water': 'engineered',
  'ditch': 'engineered',
  'negative control': 'engineered',
  'dairy': 'engineered',
  'hydrocarbon-based environmental material': 'engineered',
  'oil': 'engineered',
  'fracking liquid': 'engineered',

  'mixed': 'mixed',
};

interface PrimaryBiomeRule {
  pattern: RegExp;
  value: PrimaryBiomeKey;
}

const PRIMARY_BIOME_RULES: PrimaryBiomeRule[] = [
  { pattern: /host/, value: 'host-associated' },
  { pattern: /(animal|human|mammal|plant|root-associated)/, value: 'host-associated' },
  { pattern: /(environment|aquatic|marine|freshwater|terrestrial|soil|extreme|microbial)/, value: 'environmental' },
  { pattern: /(built|engineer|anthropogenic|urban|industrial)/, value: 'engineered' },
  { pattern: /mixed/, value: 'mixed' },
];

export function extractPrimaryBiome(environment: string): PrimaryBiomeKey {
  if (!environment) return 'unknown';

  const cleaned = environment
    .replace(/^root:\s*/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .trim();

  if (!cleaned) return 'unknown';

  const [firstLevelRaw] = cleaned.split(':').map(segment => segment.trim()).filter(Boolean);
  if (!firstLevelRaw) return 'unknown';

  const normalized = firstLevelRaw.toLowerCase().replace(/[^a-z\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'unknown';

  if (PRIMARY_BIOME_ALIASES[normalized]) {
    return PRIMARY_BIOME_ALIASES[normalized];
  }

  for (const rule of PRIMARY_BIOME_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.value;
    }
  }

  if (normalized === 'host-associated' || normalized === 'environmental' || normalized === 'engineered' || normalized === 'mixed') {
    return normalized as PrimaryBiomeKey;
  }

  return 'unknown';
}

export function getEnvironmentColor(environment: string): string {
  const key = extractPrimaryBiome(environment);
  return PRIMARY_BIOME_COLORS[key];
}

// metalog/SPIRE biomes are flat, and the API's COALESCE(level_N, environment_biome) pads
// every empty level with the same term ("tundra biome > tundra biome > …").
export function collapseConsecutiveLevels(levels: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const level of levels) {
    const v = (level ?? '').trim();
    if (!v) continue;
    if (out.length === 0 || out[out.length - 1].toLowerCase() !== v.toLowerCase()) {
      out.push(v);
    }
  }
  return out;
}

export function formatBiomeLabel(environment: string): string {
  if (!environment) return 'Unknown';

  const trimmed = environment.replace(/^root:\s*/i, '').trim();
  if (!trimmed) return 'Unknown';

  const base = trimmed.replace(/\([^)]*\)/g, ' ').trim();

  const segments = base
    .split(':')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return 'Unknown';

  const labelSource = segments[0].toUpperCase() === 'ENVO' && segments.length > 1
    ? segments.slice(1).join(':')
    : segments[0];

  if (!labelSource) return 'Unknown';

  return labelSource
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
