import { ExternalLink } from 'lucide-react';

import { buildDataSourceUrl } from '@/lib/utils/data-source-links';
import { formatDataSourceName, getDataSourceUrl } from '@/lib/utils/data-source-name';

// A BGC has one sample, but its data source array can hold two entries (e.g. metalog + SPIRE).
const PILL_BASE = 'inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs';

interface BgcSourceCellProps {
  dataSourceNames: string[] | null | undefined;
  sampleExternalId: string | null;
}

export function BgcSourceCell({ dataSourceNames, sampleExternalId }: BgcSourceCellProps) {
  const sources = (Array.isArray(dataSourceNames) ? dataSourceNames : []).filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0,
  );

  if (sources.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {sources.map((name) => {
        const label = formatDataSourceName(name);
        const sampleHref = buildDataSourceUrl(name, sampleExternalId);
        const href = sampleHref ?? getDataSourceUrl(name);
        if (href) {
          return (
            <a
              key={name}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${PILL_BASE} text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground`}
              title={sampleHref ? `View ${sampleExternalId} on ${label}` : `About ${label}`}
            >
              {label}
              <ExternalLink className="h-3 w-3" />
            </a>
          );
        }
        return (
          <span key={name} className={`${PILL_BASE} text-foreground`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
