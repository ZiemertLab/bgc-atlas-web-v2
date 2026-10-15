'use client';

import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/basePath';
import { formatDataSourceName } from '@/lib/utils/data-source-name';

export type DataSourceFilterOption = { label: string; value: string };

/** Option values are source names: the /api/bgcs `dataSource` filter matches data_source_names. */
export function useDataSourceOptions(): DataSourceFilterOption[] {
  const [options, setOptions] = useState<DataSourceFilterOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/data-sources')
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        if (Array.isArray(payload?.data)) {
          const opts: DataSourceFilterOption[] = payload.data
            .filter((d: { name?: string }) => typeof d?.name === 'string' && d.name.trim().length > 0)
            .map((d: { name: string }) => ({ label: formatDataSourceName(d.name), value: d.name }))
            .sort((a: DataSourceFilterOption, b: DataSourceFilterOption) => a.label.localeCompare(b.label));
          setOptions(opts);
        }
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return options;
}
