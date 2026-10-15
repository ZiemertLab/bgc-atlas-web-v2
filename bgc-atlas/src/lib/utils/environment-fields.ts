// Shared by the API route and the GCF environment panel.

export const MIN_VALUES_TO_OFFER = 5;
/** Below this the panel draws the values themselves, not bars. */
export const MIN_VALUES_FOR_HISTOGRAM = 25;
export const HISTOGRAM_BINS = 30;

export type EnvFieldDef = {
  key: string;
  label: string;
  /** Empty for a dimensionless field like pH. */
  unit: string;
  /** Column on `samples`. */
  column: string;
  unitColumn?: string;
  /**
   * Required value of `unitColumn`. Multi-unit analytes are offered once per unit, not
   * converted: the sources state no basis to convert on.
   */
  unitValue?: string;
  /** Plausibility bound; values outside it are dropped and counted. */
  min?: number;
  max?: number;
};

export const ENVIRONMENT_FIELDS: EnvFieldDef[] = [
  // Upper bound sits below a junk population starting at 414 °C (mostly Ocean Microbiomics v2).
  { key: 'temperature', label: 'Temperature', unit: '°C', column: 'temperature', min: -25, max: 150 },
  { key: 'depth', label: 'Depth', unit: 'm', column: 'depth', min: 0, max: 11100 },
  { key: 'ph', label: 'pH', unit: '', column: 'ph', min: 0, max: 14 },
  {
    key: 'salinity',
    label: 'Salinity',
    unit: 'psu',
    column: 'salinity',
    unitColumn: 'salinity_unit',
    unitValue: 'psu',
    min: 0,
    max: 45,
  },
  {
    key: 'conductivity',
    label: 'Conductivity',
    unit: 'mS/cm',
    column: 'conductivity',
    unitColumn: 'conductivity_unit',
    unitValue: 'mS/cm',
    min: 0,
  },
  { key: 'elevation', label: 'Elevation', unit: 'm', column: 'elevation_meters', min: -500, max: 9000 },
  {
    key: 'oxygen_umol_kg',
    label: 'Dissolved O₂',
    unit: 'µmol/kg',
    column: 'dissolved_oxygen',
    unitColumn: 'dissolved_oxygen_unit',
    unitValue: 'µmol/kg',
    min: 0,
  },
  {
    key: 'oxygen_mg_l',
    label: 'Dissolved O₂',
    unit: 'mg/L',
    column: 'dissolved_oxygen',
    unitColumn: 'dissolved_oxygen_unit',
    unitValue: 'mg/L',
    min: 0,
  },
  {
    key: 'nitrate_umol_l',
    label: 'Nitrate',
    unit: 'µmol/L',
    column: 'nitrate',
    unitColumn: 'nitrate_unit',
    unitValue: 'µmol/L',
    min: 0,
  },
  {
    key: 'nitrate_mg_l',
    label: 'Nitrate',
    unit: 'mg/L',
    column: 'nitrate',
    unitColumn: 'nitrate_unit',
    unitValue: 'mg/L',
    min: 0,
  },
  {
    key: 'nitrite_umol_l',
    label: 'Nitrite',
    unit: 'µmol/L',
    column: 'nitrite',
    unitColumn: 'nitrite_unit',
    unitValue: 'µmol/L',
    min: 0,
  },
  {
    key: 'phosphate_umol_l',
    label: 'Phosphate',
    unit: 'µmol/L',
    column: 'phosphate',
    unitColumn: 'phosphate_unit',
    unitValue: 'µmol/L',
    min: 0,
  },
  // Ammonium is omitted: nearly all its values carry no unit.
];

export type EnvBin = { x0: number; x1: number; count: number };

export type EnvFieldSummary = {
  key: string;
  label: string;
  unit: string;
  n: number;
  /** Values dropped by the plausibility bound. */
  nExcluded: number;
  min: number;
  p1: number;
  median: number;
  p99: number;
  max: number;
  /** Below MIN_VALUES_FOR_HISTOGRAM, ascending. */
  values?: number[];
  bins?: EnvBin[];
  /** Values outside the binned range, folded into the end bins. */
  nBelow: number;
  nAbove: number;
};

export function decimalsForSpan(span: number): number {
  if (span >= 100) return 0;
  if (span >= 10) return 1;
  if (span >= 1) return 2;
  return 3;
}

export function formatEnvValue(value: number, decimals: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// A negative lower bound gets a spaced dash: "-17–92" reads as one number.
export function formatEnvRange(min: number, max: number, decimals: number): string {
  const lo = formatEnvValue(min, decimals);
  const hi = formatEnvValue(max, decimals);
  return min < 0 ? `${lo} – ${hi}` : `${lo}–${hi}`;
}

// Linear interpolation, as percentile_cont does.
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function summarizeEnvField(
  def: EnvFieldDef,
  raw: readonly (number | null | undefined)[]
): EnvFieldSummary | null {
  const present = raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const kept = present.filter(
    (v) => (def.min === undefined || v >= def.min) && (def.max === undefined || v <= def.max)
  );
  if (kept.length < MIN_VALUES_TO_OFFER) return null;

  const sorted = [...kept].sort((a, b) => a - b);
  const base = {
    key: def.key,
    label: def.label,
    unit: def.unit,
    n: sorted.length,
    nExcluded: present.length - sorted.length,
    min: sorted[0],
    p1: quantile(sorted, 0.01),
    median: quantile(sorted, 0.5),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };

  if (sorted.length < MIN_VALUES_FOR_HISTOGRAM) {
    return { ...base, values: sorted, nBelow: 0, nAbove: 0 };
  }

  // Bin across p1..p99 so an outlier cannot flatten the chart; fall back to the full range,
  // then to one bin when every value is equal.
  let lo = base.p1;
  let hi = base.p99;
  if (hi <= lo) {
    lo = base.min;
    hi = base.max;
  }
  if (hi <= lo) {
    return {
      ...base,
      bins: [{ x0: lo, x1: hi, count: sorted.length }],
      nBelow: 0,
      nAbove: 0,
    };
  }

  const width = (hi - lo) / HISTOGRAM_BINS;
  const bins: EnvBin[] = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
    x0: lo + i * width,
    // Pin the last edge; accumulated float widths overshoot (4000.0000000000005).
    x1: i === HISTOGRAM_BINS - 1 ? hi : lo + (i + 1) * width,
    count: 0,
  }));
  let nBelow = 0;
  let nAbove = 0;
  for (const v of sorted) {
    if (v < lo) nBelow++;
    else if (v > hi) nAbove++;
    const idx = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((v - lo) / width)));
    bins[idx].count++;
  }

  return { ...base, bins, nBelow, nAbove };
}
