'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';
import { GcfEnvironmentChart } from '@/components/charts/gcf-environment-chart';
import { decimalsForSpan, formatEnvValue, formatEnvRange } from '@/lib/utils/environment-fields';
import type { EnvFieldSummary } from '@/lib/utils/environment-fields';

type Props = {
  fields: EnvFieldSummary[];
  totalSamples: number;
  isLoading: boolean;
};

function Caption({ field, totalSamples }: { field: EnvFieldSummary; totalSamples: number }) {
  const decimals = decimalsForSpan(field.max - field.min);
  const unit = field.unit ? ` ${field.unit}` : '';

  return (
    <div className="mt-2 space-y-1">
      <p className="text-sm text-muted-foreground">
        median{' '}
        <span className="font-mono tabular-nums text-foreground">
          {formatEnvValue(field.median, decimals)}
          {unit}
        </span>{' '}
        · range{' '}
        <span className="font-mono tabular-nums text-foreground">
          {formatEnvRange(field.min, field.max, decimals)}
        </span>{' '}
        · n ={' '}
        <span className="font-mono tabular-nums text-foreground">
          {field.n.toLocaleString()}
        </span>{' '}
        of {totalSamples.toLocaleString()} samples
      </p>
      {field.nExcluded > 0 && (
        <p className="text-xs text-muted-foreground">
          {field.nExcluded.toLocaleString()} value{field.nExcluded === 1 ? '' : 's'} outside the
          plausible range excluded.
        </p>
      )}
      {(field.nBelow > 0 || field.nAbove > 0) && (
        <p className="text-xs text-muted-foreground">
          Bars span the middle 98% of the values;{' '}
          {(field.nBelow + field.nAbove).toLocaleString()} outside it are counted in the end bars.
        </p>
      )}
    </div>
  );
}

export function GcfEnvironmentPanel({ fields, totalSamples, isLoading }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Defaults to the most-measured field (fields[0]).
  const selected = useMemo(
    () => fields.find((f) => f.key === selectedKey) ?? fields[0],
    [fields, selectedKey]
  );

  if (isLoading) return <ChartSkeleton height={280} />;
  if (!selected) return null;

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        Measurements recorded for the samples this family was found in. Values come from the
        source metadata and are not normalised across sources; analytes reported in more than one
        unit are listed once per unit.
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {fields.map((field) => {
          const isActive = field.key === selected.key;
          return (
            <Button
              key={field.key}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5"
              aria-pressed={isActive}
              onClick={() => setSelectedKey(field.key)}
            >
              {field.label}
              {field.unit && (
                <span className={isActive ? 'opacity-80' : 'text-muted-foreground'}>
                  {field.unit}
                </span>
              )}
              <span className="font-mono tabular-nums text-xs opacity-70">
                {field.n.toLocaleString()}
              </span>
            </Button>
          );
        })}
      </div>

      <GcfEnvironmentChart field={selected} />
      <Caption field={selected} totalSamples={totalSamples} />
    </div>
  );
}
