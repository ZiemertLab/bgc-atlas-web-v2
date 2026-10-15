'use client';

import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { StatRow } from '@/components/ui/stat-leader-row';
import { Sample } from '@/lib/types';
import { parseGOLDPath } from '@/lib/utils/gold-parser';
import type { GOLDMetadata } from '@/lib/types/gold-types';
import { hasCoordinates, formatCoordinates } from '@/lib/utils/coordinates';
import { SampleLocationMap } from '@/components/ui/sample-location-map';
import { SampleMeasurementsPanel } from '@/components/ui/sample-measurements-panel';

interface SampleEnvironmentalPanelProps {
  sample: Sample;
}

// Prettify ASCII-stored units for display (µ, subscripts handled in labels).
const prettyUnit = (u?: string | null): string => {
  if (!u) return '';
  const map: Record<string, string> = { uM: 'µM', 'uS/cm': 'µS/cm', um: 'µm' };
  return map[u] ?? u;
};

const present = <T,>(v: T | null | undefined): v is T => v !== undefined && v !== null && v !== '';

const num = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 3 });

const LINK = 'text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground';

type Field = { label: string; value: ReactNode; mono?: boolean };

function FieldList({ title, fields }: { title: string; fields: Field[] }) {
  if (fields.length === 0) return null;
  return (
    <div>
      <div className="section-label mb-2.5">{title}</div>
      <dl className="space-y-1.5 text-sm">
        {fields.map(({ label, value, mono }) => (
          <div key={label} className="flex gap-3">
            <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
            <dd className={`min-w-0 break-words ${mono ? 'font-mono text-xs leading-5' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Every section renders only what the sample has: a genome with no
// measurements shows its classification and location, not three empty cards.
export function SampleEnvironmentalPanel({ sample }: SampleEnvironmentalPanelProps) {
  // --- Classification -------------------------------------------------------
  const classification: Field[] = [];
  const gold = sample.goldEcosystemPath
    ? parseGOLDPath(sample.goldEcosystemPath, sample.goldEcosystemMetadata)
    : null;
  if (gold?.fullPath.length) {
    const confidence = (sample.goldEcosystemMetadata as GOLDMetadata | null | undefined)?.confidence;
    classification.push({
      label: 'GOLD ecosystem',
      value: (
        <>
          {gold.fullPath.join(' › ')}
          {confidence ? <span className="ml-1.5 text-xs text-muted-foreground">({confidence})</span> : null}
        </>
      ),
    });
  }
  const biome = sample.primaryBiome ?? sample.environmentBiome;
  if (present(biome)) classification.push({ label: 'Biome', value: biome });
  if (present(sample.environmentFeature)) classification.push({ label: 'Feature', value: sample.environmentFeature });
  if (present(sample.environmentMaterial)) classification.push({ label: 'Material', value: sample.environmentMaterial });
  if (present(sample.environmentalPackage)) classification.push({ label: 'Package', value: sample.environmentalPackage });
  if (sample.env_terms && sample.env_terms.length > 0) {
    classification.push({ label: 'Terms', value: sample.env_terms.join(', ') });
  }

  // --- Location -------------------------------------------------------------
  const location: Field[] = [];
  const coords = hasCoordinates(sample);
  if (coords) {
    location.push({ label: 'Coordinates', value: formatCoordinates(sample.latitude, sample.longitude), mono: true });
  }
  if (present(sample.geographicLocation)) location.push({ label: 'Place', value: sample.geographicLocation });
  if (present(sample.location) && sample.location !== sample.geographicLocation) {
    location.push({ label: 'Location', value: sample.location });
  }
  if (present(sample.locationResolution)) location.push({ label: 'Resolution', value: sample.locationResolution });
  if (present(sample.depthMin) || present(sample.depthMax)) {
    const lo = present(sample.depthMin) ? num(sample.depthMin) : '?';
    const hi = present(sample.depthMax) ? num(sample.depthMax) : '?';
    location.push({ label: 'Depth', value: lo === hi ? `${lo} m` : `${lo}–${hi} m` });
  } else if (present(sample.depth)) {
    location.push({ label: 'Depth', value: `${num(sample.depth)} m` });
  }

  // --- Collection & host ----------------------------------------------------
  const collection: Field[] = [];
  const date = sample.collectionDate || sample.date;
  if (present(date)) {
    const end = sample.collectionDateEnd && sample.collectionDateEnd !== date ? ` – ${sample.collectionDateEnd}` : '';
    collection.push({ label: 'Date', value: `${date}${end}` });
  }
  const taxonomyHref = (q: string | number, byId: boolean) =>
    `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?${byId ? 'id' : 'name'}=${encodeURIComponent(String(q))}`;
  if (present(sample.hostSpecies)) {
    collection.push({
      label: 'Host',
      value: (
        <a
          href={present(sample.hostTaxid) ? taxonomyHref(sample.hostTaxid, true) : taxonomyHref(sample.hostSpecies, false)}
          target="_blank"
          rel="noopener noreferrer"
          className={`italic ${LINK}`}
        >
          {sample.hostSpecies}
        </a>
      ),
    });
  }
  if (present(sample.hostTaxid)) {
    collection.push({
      label: 'Host TaxID',
      value: (
        <a href={taxonomyHref(sample.hostTaxid, true)} target="_blank" rel="noopener noreferrer" className={LINK}>
          {sample.hostTaxid}
        </a>
      ),
      mono: true,
    });
  }

  // --- Measurements ---------------------------------------------------------
  const filtration = (() => {
    const lo = sample.filtrationLowerThresholdUm;
    const hi = sample.filtrationUpperThresholdUm;
    if (present(lo) && present(hi)) return `${num(lo)}–${num(hi)}`;
    if (present(lo)) return num(lo);
    if (present(hi)) return num(hi);
    return undefined;
  })();
  const fig = (v: number | string | null | undefined, unit: string): string | undefined =>
    !present(v) ? undefined : `${typeof v === 'number' ? num(v) : v}${unit ? ` ${unit}` : ''}`;

  const measurementGroups = [
    {
      title: 'Physicochemical',
      rows: [
        { label: 'Temperature', value: fig(sample.temperature, '°C') },
        { label: 'pH', value: fig(sample.ph, '') },
        { label: 'Salinity', value: fig(sample.salinity, prettyUnit(sample.salinityUnit)) },
        { label: 'Dissolved O₂', value: fig(sample.dissolvedOxygen, prettyUnit(sample.dissolvedOxygenUnit)) },
        { label: 'Conductivity', value: fig(sample.conductivity, prettyUnit(sample.conductivityUnit)) },
      ],
    },
    {
      title: 'Nutrients',
      rows: [
        { label: 'Nitrate', value: fig(sample.nitrate, prettyUnit(sample.nitrateUnit)) },
        { label: 'Nitrite', value: fig(sample.nitrite, prettyUnit(sample.nitriteUnit)) },
        { label: 'Ammonium', value: fig(sample.ammonium, prettyUnit(sample.ammoniumUnit)) },
        { label: 'Phosphate', value: fig(sample.phosphate, prettyUnit(sample.phosphateUnit)) },
        { label: 'DOC', value: fig(sample.dissolvedOrganicCarbon, prettyUnit(sample.dissolvedOrganicCarbonUnit)) },
      ],
    },
    {
      title: 'Sampling',
      rows: [
        { label: 'Filtration', value: filtration && `${filtration} µm` },
        { label: 'Elevation', value: fig(sample.elevationMeters, 'm') },
      ],
    },
    {
      title: 'Climate',
      rows: [
        { label: 'Precipitation', value: fig(sample.currentPrecipitationMm, 'mm') },
        { label: 'Annual precipitation', value: fig(sample.meanAnnualPrecipitationMm, 'mm/yr') },
        { label: 'Annual temperature', value: fig(sample.meanAnnualTemperature, '°C') },
      ],
    },
  ]
    .map((g) => ({ ...g, rows: g.rows.filter((r): r is { label: string; value: string } => present(r.value)) }))
    .filter((g) => g.rows.length > 0);

  const hasFields = classification.length + location.length + collection.length > 0;

  return (
    <div className="space-y-4">
      {(hasFields || coords || measurementGroups.length > 0) && (
        <Card>
          <CardContent className="space-y-6">
            {(hasFields || coords) && (
              <div className={coords ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]' : ''}>
                <div className="min-w-0 space-y-5">
                  <FieldList title="Classification" fields={classification} />
                  <FieldList title="Location" fields={location} />
                  <FieldList title="Collection" fields={collection} />
                </div>
                {coords && (
                  <SampleLocationMap
                    latitude={sample.latitude}
                    longitude={sample.longitude}
                    label={sample.name ?? sample.externalId ?? undefined}
                    height={240}
                  />
                )}
              </div>
            )}

            {measurementGroups.length > 0 && (
              <div className="grid gap-6 sm:grid-cols-[repeat(auto-fill,minmax(16rem,20rem))] sm:gap-x-12">
                {measurementGroups.map((g) => (
                  <div key={g.title} className="min-w-0">
                    <div className="section-label mb-2.5">{g.title}</div>
                    <dl className="space-y-1 text-sm">
                      {g.rows.map((r) => <StatRow key={r.label} label={r.label} value={r.value} />)}
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {!hasFields && !coords && measurementGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">No environmental classification or location recorded for this sample.</p>
      )}

      {/* Every recorded key/value, as loaded; renders nothing when there are none. */}
      <SampleMeasurementsPanel sampleId={sample.id} />
    </div>
  );
}
