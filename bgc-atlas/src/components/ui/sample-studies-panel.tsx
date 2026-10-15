'use client';

import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { StatRow } from '@/components/ui/stat-leader-row';
import { useSampleStudies } from '@/lib/hooks/use-samples';
import type { SampleStudy } from '@/lib/types';

const TOP_ENVIRONMENTS = 5;

// Placeholders a source wrote instead of an environment; they are not one.
const NOT_AN_ENVIRONMENT = /^(unknown|missing|not (applicable|provided|collected)|n\/?a|none|null|-)$/i;

const LINK = 'text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground';

interface SampleStudiesPanelProps {
  sampleId: string;
}

function StudyCard({ study }: { study: SampleStudy }) {
  const ids: { label: string; value: string; href?: string }[] = [];
  const bioproject = study.bioproject?.trim();
  // Often the same PRJ id twice; the linked BioProject then says it once.
  if (study.accession && study.accession.trim() !== bioproject) ids.push({ label: 'Accession', value: study.accession });
  if (bioproject) {
    ids.push({
      label: 'BioProject',
      value: bioproject,
      href: /^PRJ[A-Z]+[0-9]+$/i.test(bioproject)
        ? `https://www.ncbi.nlm.nih.gov/bioproject/${encodeURIComponent(bioproject)}`
        : undefined,
    });
  }
  if (study.secondary_accession) ids.push({ label: 'Secondary', value: study.secondary_accession });

  // Largest first; a study can carry over a thousand distinct environments
  // (GTDB has 1,396), so only the top few are listed.
  const envs = Object.entries(study.environment_distribution ?? {})
    .filter(([env]) => !NOT_AN_ENVIRONMENT.test(env.trim()))
    .sort((a, b) => b[1] - a[1]);
  const others = study.related_samples.slice(0, 6);
  const moreSamples = study.sample_count - others.length;

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          {study.study_type && <div className="section-label">{study.study_type}</div>}
          <h3 className="text-base font-medium leading-snug">
            {study.title || study.study_name || study.external_id || 'Untitled study'}
          </h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {ids.map(({ label, value, href }) => (
              <span key={label}>
                <span className="text-muted-foreground">{label} </span>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className={`font-mono ${LINK}`}>{value}</a>
                ) : (
                  <span className="font-mono">{value}</span>
                )}
              </span>
            ))}
          </div>
          {study.center_name && <div className="text-xs text-muted-foreground">{study.center_name}</div>}
        </div>

        {study.abstract && (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground line-clamp-3">{study.abstract}</p>
        )}

        <div className="grid gap-6 md:grid-cols-[repeat(2,minmax(0,22rem))] md:gap-12">
          <div className="min-w-0">
            <div className="section-label mb-2.5">Samples</div>
            <dl className="space-y-1 text-sm">
              <StatRow label="In this study" value={study.sample_count.toLocaleString()} />
              {envs.slice(0, TOP_ENVIRONMENTS).map(([env, count]) => (
                <StatRow key={env} label={env} value={count.toLocaleString()} />
              ))}
            </dl>
            {envs.length > TOP_ENVIRONMENTS && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                +{(envs.length - TOP_ENVIRONMENTS).toLocaleString()} more environments
              </p>
            )}
          </div>

          {others.length > 0 && (
            <div className="min-w-0">
              <div className="section-label mb-2.5">Other samples</div>
              <ul className="space-y-1 text-sm">
                {others.map((s) => (
                  <li key={s.id} className="min-w-0 break-all text-xs">
                    <Link href={`/samples/${s.id}`} className={`font-mono ${LINK}`}>
                      {s.name || s.external_id}
                    </Link>
                    {s.environment_biome && (
                      <span className="ml-2 break-normal text-muted-foreground">{s.environment_biome}</span>
                    )}
                  </li>
                ))}
              </ul>
              {moreSamples > 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">+{moreSamples.toLocaleString()} more</p>
              )}
            </div>
          )}
        </div>

        <Link href={`/studies/${study.id}`} className={`inline-block text-sm ${LINK}`}>
          View study
        </Link>
      </CardContent>
    </Card>
  );
}

export function SampleStudiesPanel({ sampleId }: SampleStudiesPanelProps) {
  const { data: studiesData, isLoading, error, hasLoaded } = useSampleStudies(sampleId);

  if (isLoading || !hasLoaded) {
    return <p className="text-sm text-muted-foreground">Loading studies…</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">Failed to load studies: {error.message}</p>;
  }

  if (!studiesData?.success || !studiesData.data || studiesData.data.length === 0) {
    return <p className="text-sm text-muted-foreground">No study is linked to this sample.</p>;
  }

  const studies = studiesData.data;
  const summary = studiesData.summary;

  return (
    <div className="space-y-4">
      {/* A summary only adds something when there is more than one study to sum. */}
      {studies.length > 1 && (
        <Card>
          <CardContent>
            <div className="section-label mb-2.5">Across {studies.length.toLocaleString()} studies</div>
            <dl className="max-w-[22rem] space-y-1 text-sm">
              <StatRow label="Samples" value={summary.total_related_samples.toLocaleString()} />
              {summary.bioprojects.length > 0 && (
                <StatRow label="BioProjects" value={summary.bioprojects.length.toLocaleString()} />
              )}
              {summary.center_names.length > 0 && (
                <StatRow label="Centers" value={summary.center_names.length.toLocaleString()} />
              )}
            </dl>
          </CardContent>
        </Card>
      )}
      {studies.map((study) => <StudyCard key={study.id} study={study} />)}
    </div>
  );
}
