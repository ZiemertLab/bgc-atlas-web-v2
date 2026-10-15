'use client';

import { apiFetch, withBase } from "@/lib/basePath";
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink, Loader2 } from 'lucide-react';

interface AntismashRunSummary {
  id: string;
  name: string | null;
  file_path: string | null;
  num_bgcs: number;
}

interface Assembly {
  id: string;
  external_id: string | null;
  name?: string;
  bgc_count: number;
  created_at: string;
  updated_at: string;
  antismash_runs?: AntismashRunSummary[];
}

interface AssembliesPayload {
  success: boolean;
  data: Assembly[];
  total: number;
  limit?: number;
  offset?: number;
  page_size?: number;
  has_more?: boolean;
  message?: string;
}

interface AssemblyDetailsProps {
  sampleId: string;
}

const PAGE_SIZE = 50;

export function AssemblyDetails({ sampleId }: AssemblyDetailsProps) {
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (offset: number, append: boolean) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const response = await apiFetch(
        `/api/samples/${sampleId}/assemblies?limit=${PAGE_SIZE}&offset=${offset}`,
      );

      if (!response.ok) {
        throw new Error('Failed to fetch assemblies');
      }

      const data = (await response.json()) as AssembliesPayload;

      if (!data.success) {
        throw new Error(data.message || 'Failed to fetch assemblies');
      }

      const page = (data.data || []).slice().sort((a, b) => b.bgc_count - a.bgc_count);
      setTotal(data.total ?? page.length);
      setHasMore(Boolean(data.has_more));
      setAssemblies(prev => (append ? [...prev, ...page] : page));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [sampleId]);

  useEffect(() => {
    setAssemblies([]);
    setTotal(0);
    setHasMore(false);
    fetchPage(0, false);
  }, [sampleId, fetchPage]);

  if (loading) {
    return (
      <div className="p-2 w-full max-w-3xl">
        <div className="mb-3 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs text-muted-foreground">Loading assemblies...</span>
        </div>
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-background px-2 py-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-12" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-2 w-full max-w-3xl">
        <div className="py-4 text-center">
          <p className="mb-1 text-xs text-red-600">Error loading assemblies</p>
          <p className="text-[11px] text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (assemblies.length === 0) {
    return (
      <div className="border-t bg-muted/30 p-4 w-full max-w-md md:max-w-lg">
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground">No assemblies found for this sample</p>
        </div>
      </div>
    );
  }

  const headerLabel = total > assemblies.length
    ? `Assemblies (${assemblies.length.toLocaleString()} of ${total.toLocaleString()})`
    : `Assemblies (${total.toLocaleString()})`;

  return (
    <div className="p-2 w-full max-w-3xl">
      <div className="mb-2">
        <h4 className="text-xs font-medium text-foreground">{headerLabel}</h4>
      </div>

      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="text-[11px] h-8 px-2">Assembly ID</TableHead>
            <TableHead className="text-[11px] h-8 px-2 text-right">BGC Count</TableHead>
            <TableHead className="text-[11px] h-8 px-2 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assemblies.map((assembly) => (
            <TableRow key={assembly.id} className="hover:bg-accent">
              <TableCell className="font-mono text-xs px-2 py-1.5">
                {assembly.external_id || assembly.id}
              </TableCell>
              <TableCell className="px-2 py-1.5 text-right">
                <Badge variant="secondary" className="text-[11px] font-mono tabular-nums">
                  {assembly.bgc_count.toLocaleString()}
                </Badge>
              </TableCell>
              <TableCell className="px-2 py-1.5 text-right">
                <div className="flex justify-end gap-2">
                  {assembly.antismash_runs && assembly.antismash_runs.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px] gap-1.5"
                      asChild
                    >
                      <Link
                        href={`/antismash/${assembly.antismash_runs[0].id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cursor-pointer"
                      >
                        <Image
                          src={withBase("/images/antismash_logo.svg")}
                          alt="antiSMASH"
                          width={12}
                          height={12}
                          className="h-3 w-auto"
                        />
                        View antiSMASH
                      </Link>
                    </Button>
                  )}
                  {assembly.bgc_count > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      asChild
                    >
                      <Link
                        href={`/bgcs?assembly=${encodeURIComponent(assembly.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cursor-pointer"
                      >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        View BGCs
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground self-center">No BGCs</span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {hasMore && (
        <div className="mt-2 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-3 text-[11px]"
            disabled={loadingMore}
            onClick={() => fetchPage(assemblies.length, true)}
          >
            {loadingMore ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Loading...
              </>
            ) : (
              `Load more (${(total - assemblies.length).toLocaleString()} remaining)`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
