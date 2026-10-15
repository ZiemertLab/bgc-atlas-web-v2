'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { ResizableTable, type TableColumn } from '@/components/ui/resizable-table';
import { TooltipBadge } from '@/components/ui/tooltip-badge';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CURRENT_CLUSTERING } from '@/lib/clustering';
import type { RetiredFamily } from '@/lib/gcf-legacy';

type Successor = RetiredFamily['successors'][number];

/**
 * /gcfs/<id> for a family of a replaced clustering (the detail API answers 410 with this). A re-clustering
 * renumbers families from scratch, so the old family has no single equivalent: the page lists the new families
 * its members are in now, largest share first.
 */
export function RetiredFamilyView({ family }: { family: RetiredFamily }) {
  const shownShared = family.successors.reduce((sum, s) => sum + s.sharedBgcs, 0);
  // share_of_old is over the members still in BGC Atlas, so the shares of ALL successors sum to 1 exactly when
  // every remaining member is in some family now.
  const shownShare = family.successors.reduce((sum, s) => sum + s.shareOfOld, 0);
  const allShown = family.successorCount === family.successors.length;
  const everyMemberPlaced = allShown && shownShare > 0.999;
  // An older clustering's successors were themselves replaced since (August -> v2b2 -> current): their pages go on.
  const successorsRetired = family.successors.some((s) => s.retired);
  const columns: TableColumn<Successor>[] = [
    {
      id: 'name', label: 'Family', width: 290, sortable: false,
      renderCell: (s) => (
        <>
          {s.listed
            ? <Link href={`/gcfs/${s.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{s.name}</Link>
            : <span className="font-mono text-sm text-muted-foreground" title="A single-member fragmented family has no page">{s.name}</span>}
          {s.retired && <span className="ml-2 text-xs text-muted-foreground">replaced</span>}
        </>
      ),
    },
    {
      id: 'alias', label: 'Alias', width: 220, sortable: false,
      renderCell: (s) => <span className="font-mono text-sm text-muted-foreground">{s.petName ?? '–'}</span>,
    },
    {
      id: 'shared', label: 'Members from this family', width: 210, sortable: false,
      headerTooltip: 'BGCs that were primary members of this family and are primary members of that one now.',
      renderCell: (s) => <span className="font-mono text-sm tabular-nums">{s.sharedBgcs.toLocaleString()}</span>,
    },
    {
      id: 'share', label: 'Share', width: 120, sortable: false,
      headerTooltip: "Of this family's members still in BGC Atlas: removed BGCs are not counted.",
      renderCell: (s) => (
        <span className="font-mono text-sm tabular-nums">{(100 * s.shareOfOld).toFixed(s.shareOfOld < 0.1 ? 1 : 0)}%</span>
      ),
    },
  ];

  return (
    <MainLayout>
      <TooltipProvider>
        <div className="mx-auto w-full max-w-[1400px] py-8">
          <header className="mb-6 border-b border-border pb-4">
            <div className="section-label mb-1.5">Gene cluster family · previous clustering</div>
            <div className="atlas-rule mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="font-mono text-2xl font-semibold tracking-tight md:text-3xl">{family.name}</h1>
              {family.petName && (
                <span className="font-mono text-lg font-semibold text-muted-foreground md:text-xl"
                      title="Human-readable alias — for recall only, not an identifier">
                  <span className="sr-only">Alias: </span>
                  {family.petName}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <TooltipBadge variant="outline" className="font-mono" tooltip={`GCF ID: ${family.id}`}>
                {family.id}
              </TooltipBadge>
            </div>
            <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
              This family is from {family.clusteringLabel}
              {family.release && <> (data release <span className="font-mono">{family.release}</span>)</>}, which has
              been replaced
              {successorsRetired
                ? '.'
                : <> by the clustering of <span className="font-mono">{CURRENT_CLUSTERING.release}</span>.</>}{' '}
              Families are numbered afresh in each clustering, so no current family is this one
              {family.successors.length === 0
                ? '.'
                : successorsRetired
                  ? '; its members went to the families below, which have since been replaced in turn. Each one’s ' +
                    'page shows where its members are now.'
                  : '; its members are now in the families below.'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link href="/gcfs">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="size-3.5" />
                  Back to GCFs
                </Button>
              </Link>
              <Link href="/releases" className="text-sm underline-offset-4 hover:underline">What changed</Link>
              <CopyLinkButton className="ml-auto" />
            </div>
          </header>

          <section className="mb-6">
            <div className="section-label mb-2.5">Where its members went</div>
            {family.successors.length === 0 ? (
              <p className="max-w-3xl text-sm text-muted-foreground">
                None of its {family.memberCount.toLocaleString()} members went to a family of the next clustering:
                they were removed from BGC Atlas or left unclustered.
              </p>
            ) : (
              <>
                <ResizableTable columns={columns} data={family.successors} className="min-w-full" stickyFirstColumn />
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {everyMemberPlaced
                    ? 'Every member still in BGC Atlas is in one of these families.'
                    : allShown
                      ? `${shownShared.toLocaleString()} members ${successorsRetired ? 'went to' : 'are in'} these ` +
                        `families; the others ${successorsRetired ? 'were unclustered in the next clustering' : 'are unclustered now'}.`
                      : `The ${family.successors.length} families holding the most of its members, of ` +
                        `${family.successorCount.toLocaleString()} in all.`}
                </p>
              </>
            )}
          </section>
        </div>
      </TooltipProvider>
    </MainLayout>
  );
}
