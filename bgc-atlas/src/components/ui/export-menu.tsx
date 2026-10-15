'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiFetch, withBase } from '@/lib/basePath';
import { toast } from '@/lib/hooks/use-toast';
import { EXPORT_ROW_CAP, type ExportFormat } from '@/lib/export/format';

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'csv', label: 'CSV' },
  { format: 'tsv', label: 'TSV' },
  { format: 'json', label: 'JSON' },
];

interface ExportCheck { ok: boolean; rows?: number; total?: number; capped?: boolean; reason?: string }

export interface ExportMenuProps {
  pageRows: number;
  onPageExport: (format: ExportFormat) => void;
  total: number;
  /** `/api/<list>/export?<query>` without format; null when the full result cannot be exported. */
  exportPath: string | null;
  allDisabledReason?: string | null;
  align?: 'start' | 'end';
}

// "All matching" asks the server first (`check=1`, validates without spending the
// export budget) so a refusal shows on the page; the file is then a plain link.
export function ExportMenu({
  pageRows, onPageExport, total, exportPath, allDisabledReason, align = 'end',
}: ExportMenuProps) {
  const [pending, setPending] = useState(false);
  const capped = total > EXPORT_ROW_CAP;
  const allLabel = capped
    ? `first ${EXPORT_ROW_CAP.toLocaleString()} of ${total.toLocaleString()}`
    : `${total.toLocaleString()} ${total === 1 ? 'row' : 'rows'}`;
  const allDisabled = !exportPath || total === 0;

  const exportAll = async (format: ExportFormat) => {
    if (!exportPath || pending) return;
    setPending(true);
    const url = `${exportPath}${exportPath.includes('?') ? '&' : '?'}format=${format}`;
    try {
      const res = await apiFetch(`${url}&check=1`);
      const check = await res.json().catch(() => null) as ExportCheck | null;
      if (!check?.ok) {
        toast({
          variant: 'destructive',
          title: 'Export not started',
          description: check?.reason ?? `The server answered ${res.status}.`,
        });
        return;
      }
      const a = document.createElement('a');
      a.href = withBase(url);
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast({
        title: 'Export started',
        description: check.capped
          ? `The first ${check.rows?.toLocaleString()} of ${check.total?.toLocaleString()} rows, in table order. Your browser is saving the file.`
          : `${check.rows?.toLocaleString()} rows. Your browser is saving the file.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Export not started',
        description: error instanceof Error ? error.message : 'Please try again later.',
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pageRows === 0 || pending} aria-busy={pending}>
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Export
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs">
            This page ({pageRows.toLocaleString()} {pageRows === 1 ? 'row' : 'rows'})
          </DropdownMenuLabel>
          {FORMATS.map(({ format, label }) => (
            <DropdownMenuItem key={`page-${format}`} onSelect={() => onPageExport(format)}>
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs">
            All matching ({allLabel})
          </DropdownMenuLabel>
          {FORMATS.map(({ format, label }) => (
            <DropdownMenuItem
              key={`all-${format}`}
              disabled={allDisabled}
              onSelect={() => exportAll(format)}
            >
              {label}
            </DropdownMenuItem>
          ))}
          {!exportPath && allDisabledReason && (
            <p className="px-2 pb-1.5 pt-1 text-xs leading-snug text-muted-foreground">
              {allDisabledReason}
            </p>
          )}
          {exportPath && capped && (
            <p className="px-2 pb-1.5 pt-1 text-xs leading-snug text-muted-foreground">
              Larger results: the whole tables are on the Downloads page.
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
