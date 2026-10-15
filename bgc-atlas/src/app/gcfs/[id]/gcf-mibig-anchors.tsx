'use client';

import { ExternalLink } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { TooltipBadge } from '@/components/ui/tooltip-badge';
import type { GcfDetail } from '@/lib/hooks/use-gcf-detail';

export type MibigAnchor = NonNullable<GcfDetail['mibigAnchors']>[number];

// MIBiG 4.x serves only versioned accessions (BGC0000467.5); without a version the anchor is left unlinked.
export function mibigHref(accession: string, version: number | null | undefined): string | null {
  if (version === null || version === undefined) return null;
  return `https://mibig.secondarymetabolites.org/repository/${accession}.${version}/`;
}

/** The compound this family is named for, plus how many others the reference lists. */
function primaryCompound(anchor: MibigAnchor): { name: string; extra: number } | null {
  if (anchor.compounds.length === 0) return null;
  return { name: anchor.compounds[0], extra: anchor.compounds.length - 1 };
}

// Only the nearest reference (anchors are sorted by distance) plus a count, so the chip fits a phone row.
export function MibigAnchorChip({ anchors }: { anchors: MibigAnchor[] }) {
  if (anchors.length === 0) return null;
  const nearest = anchors[0];
  const compound = primaryCompound(nearest);
  const label = compound ? compound.name : nearest.accession;
  const others = anchors.length - 1;

  return (
    <TooltipBadge
      variant="outline"
      className="border-brand/40 bg-brand/5 text-brand"
      tooltip={
        others > 0
          ? `Characterized relative: ${label} (${nearest.accession}) and ${others} other ${
              others === 1 ? 'reference' : 'references'
            } cluster with this family`
          : `Characterized relative: ${label} (${nearest.accession}) clusters with this family`
      }
    >
      {/* min-w-0 + truncate: compound names reach 60 characters and would overflow the header on a phone. */}
      <span className="inline-block max-w-[22ch] truncate align-bottom sm:max-w-[36ch]">
        {label}
      </span>
      {others > 0 && <span className="ml-1 opacity-70">+{others}</span>}
    </TooltipBadge>
  );
}

// Rendered only when the family has an anchor; almost none do.
export function MibigAnchorsPanel({ anchors }: { anchors: MibigAnchor[] }) {
  if (anchors.length === 0) return null;

  return (
    <CollapsibleSection
      title={`Characterized relatives (${anchors.length.toLocaleString()})`}
      defaultOpen={anchors.length <= 3}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pr-4 font-medium">Accession</th>
              <th className="py-1.5 pr-4 font-medium">Compound</th>
              <th className="py-1.5 pr-4 font-medium">Producer</th>
              <th className="py-1.5 pr-0 text-right font-medium">Distance</th>
            </tr>
          </thead>
          <tbody>
            {anchors.map((anchor) => {
              const href = mibigHref(anchor.accession, anchor.mibigVersion);
              const compound = primaryCompound(anchor);
              return (
                <tr key={anchor.accession} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-4 align-top font-mono text-[13px] whitespace-nowrap">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand underline-offset-4 hover:underline"
                        title={`${anchor.accession} in the MIBiG repository`}
                      >
                        {anchor.accession}
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      anchor.accession
                    )}
                  </td>
                  <td className="py-2 pr-4 align-top">
                    {compound ? (
                      <>
                        {compound.name}
                        {compound.extra > 0 && (
                          <span
                            className="ml-1 text-muted-foreground"
                            title={anchor.compounds.join(', ')}
                          >
                            +{compound.extra.toLocaleString()}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 align-top italic text-muted-foreground">
                    {anchor.producer ?? '—'}
                  </td>
                  <td className="py-2 pr-0 text-right align-top font-mono tabular-nums whitespace-nowrap">
                    {anchor.distance === null ? '—' : anchor.distance.toFixed(3)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}
