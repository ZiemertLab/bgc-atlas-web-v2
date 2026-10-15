'use client';

import Link from 'next/link';

import { useStudies } from '@/lib/hooks/use-studies';

// A ?studyKey= scope arrives by URL, so without this chip the table silently shows a fraction
// of the corpus. Names the study by title, falling back like the study page's h1.
export function StudyScopeChip({ studyKey, onClear }: { studyKey: string; onClear: () => void }) {
  const { data } = useStudies({ key: studyKey, limit: 1 });
  const study = data.data?.data?.[0];
  const title = study ? study.title || study.study_name || study.study_key : studyKey;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-muted-foreground">Showing samples from study</span>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded border bg-muted px-2 py-1">
        {study ? (
          <Link href={`/studies/${study.study_id}`} className="min-w-0 truncate hover:underline" title={title}>
            {title}
          </Link>
        ) : (
          <span className="min-w-0 truncate font-mono" title={title}>{title}</span>
        )}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear study filter"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
