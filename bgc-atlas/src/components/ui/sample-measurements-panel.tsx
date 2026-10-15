'use client';

import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSampleMeasurements } from '@/lib/hooks/use-samples';

interface SampleMeasurementsPanelProps {
  sampleId: string;
}

export function SampleMeasurementsPanel({ sampleId }: SampleMeasurementsPanelProps) {
  const { data: measurementsData, isLoading, error, hasLoaded } = useSampleMeasurements(sampleId);

  const formatDateTime = (value: string | null | undefined) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Loading and empty both render nothing: this sits under the Environment
  // summary, and a skeleton that resolves to "no measurements" for most
  // samples was a whole empty card.
  if (isLoading || !hasLoaded) return null;

  if (error) {
    return (
      <p className="text-sm text-destructive">Failed to load measurements: {error.message}</p>
    );
  }

  if (!measurementsData?.success || !measurementsData.data.measurements || measurementsData.data.measurements.length === 0) {
    return null;
  }

  const measurementsByKey = measurementsData.data.measurements_by_key;
  const measurementsByKeyEntries = Object.entries(measurementsByKey ?? {}).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  // Most sources record neither a unit nor a time; an always-empty column is noise.
  const all = measurementsByKeyEntries.flatMap(([, ms]) => ms);
  const hasUnit = all.some((m) => m.unit);
  const hasTime = all.some((m) => formatDateTime(m.measured_at));

  return (
    <CollapsibleSection title="Recorded measurements" badge={measurementsByKeyEntries.length.toLocaleString()}>
      <div className="overflow-x-auto">
        <Table className="table-fixed text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[38%]">Key</TableHead>
              <TableHead>Value</TableHead>
              {hasUnit && <TableHead>Unit</TableHead>}
              {hasTime && <TableHead>Measured</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {measurementsByKeyEntries.flatMap(([key, measurements]) =>
              measurements.map((measurement, i) => {
                const metadata =
                  measurement.metadata && Object.keys(measurement.metadata).length > 0
                    ? JSON.stringify(measurement.metadata)
                    : null;
                return (
                  <TableRow key={measurement.id} className="align-top">
                    <TableCell className="py-1.5 whitespace-normal text-muted-foreground break-words">{i === 0 ? key : ''}</TableCell>
                    <TableCell className="py-1.5 whitespace-normal font-mono tabular-nums break-all">
                      {measurement.value || '—'}
                      {metadata ? <div className="mt-0.5 text-[11px] text-muted-foreground break-all">{metadata}</div> : null}
                    </TableCell>
                    {hasUnit && <TableCell className="py-1.5">{measurement.unit ?? ''}</TableCell>}
                    {hasTime && (
                      <TableCell className="py-1.5 whitespace-nowrap text-muted-foreground">{formatDateTime(measurement.measured_at) ?? ''}</TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </CollapsibleSection>
  );
}
