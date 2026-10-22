import { NextResponse } from 'next/server';

import { FILTER_REFUSED_CODE } from '@/lib/api/refusal-codes';

import {
  parseGoldBucket,
  parseSourceTypes,
  UnknownGoldBucketError,
  UnknownSourceTypeError,
} from '@/lib/api/samples-query';
import { MalformedFilterPayloadError } from '@/lib/filters/types';
import { CategoryShareFilterError } from '@/lib/gcf/category-share';
import { FamilyClassFilterError } from '@/lib/gcf/family-class';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';

/** The `?completeness=` values a BGC listing can honour. */
export const COMPLETENESS_VALUES = ['complete', 'partial'] as const;

/**
 * An unknown `?completeness=`. `bgcs.is_complete` is a non-null boolean, so anything other
 * than complete or partial has no meaning; both backends used to drop it and answer with the
 * whole corpus.
 */
export class UnknownCompletenessError extends Error {
  readonly rejected: string[];

  constructor(rejected: string[]) {
    super(
      `Unknown completeness: ${rejected.join(', ')}.`
      + ` Valid values are ${COMPLETENESS_VALUES.join(', ')}.`,
    );
    this.name = 'UnknownCompletenessError';
    this.rejected = rejected;
  }
}

/** Throws UnknownCompletenessError for any value it cannot honour; absent or blank is no filter. */
export const parseCompleteness = (params: URLSearchParams): void => {
  // Every repeated value is checked: a URL that contradicts itself is broken.
  const rejected = [...new Set(params.getAll('completeness'))].filter(
    (value) => value.trim() && !(COMPLETENESS_VALUES as readonly string[]).includes(value),
  );
  if (rejected.length > 0) throw new UnknownCompletenessError(rejected);
};

// Each refusal replaces a wider answer at HTTP 200. The text goes in both `error` and `message`
// since browse pages each read one. Null for anything else, so the caller's 500 branch runs.
export const filterRefusalResponse = (error: unknown): NextResponse | null => {
  if (error instanceof UnhonourableQueryError) {
    return NextResponse.json(
      {
        success: false,
        code: FILTER_REFUSED_CODE,
        error: error.message,
        message: error.message,
        rejected: error.conditions,
      },
      { status: 400 },
    );
  }
  if (error instanceof MalformedFilterPayloadError) {
    return NextResponse.json(
      { success: false, code: FILTER_REFUSED_CODE, error: error.message, message: error.message, rejected: [] },
      { status: 400 },
    );
  }
  if (error instanceof UnknownGoldBucketError) {
    return NextResponse.json(
      { success: false, code: FILTER_REFUSED_CODE, error: error.message, message: error.message, rejected: [error.bucket] },
      { status: 400 },
    );
  }
  if (error instanceof FamilyClassFilterError) {
    return NextResponse.json(
      { success: false, code: FILTER_REFUSED_CODE, error: error.message, message: error.message, rejected: error.rejected },
      { status: 400 },
    );
  }
  if (error instanceof CategoryShareFilterError) {
    return NextResponse.json(
      { success: false, code: FILTER_REFUSED_CODE, error: error.message, message: error.message, rejected: error.rejected },
      { status: 400 },
    );
  }
  if (error instanceof UnknownCompletenessError) {
    return NextResponse.json(
      { success: false, code: FILTER_REFUSED_CODE, error: error.message, message: error.message, rejected: error.rejected },
      { status: 400 },
    );
  }
  if (error instanceof UnknownSourceTypeError) {
    return NextResponse.json(
      {
        success: false,
        code: FILTER_REFUSED_CODE,
        error: error.message,
        message: error.message,
        rejected: error.unknownTypes,
      },
      { status: 400 },
    );
  }
  return null;
};

// The browse index answers an unknown ?sourceType= with zero hits where the SQL path refuses it;
// check before the OpenSearch branch so both backends refuse the same URL.
export const sourceTypeRefusal = (params: URLSearchParams): NextResponse | null => {
  try {
    parseSourceTypes(params);
    return null;
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }
};

// As sourceTypeRefusal, for `?goldBucket=`.
export const goldBucketRefusal = (params: URLSearchParams): NextResponse | null => {
  try {
    parseGoldBucket(params.get('goldBucket') ?? undefined);
    return null;
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }
};

/**
 * As sourceTypeRefusal, for `?completeness=`: complete or partial. Neither
 * backend has anything to say about another value, and both used to ignore it --
 * the whole corpus, under a chip claiming a filter.
 */
export const completenessRefusal = (params: URLSearchParams): NextResponse | null => {
  try {
    parseCompleteness(params);
    return null;
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }
};

/**
 * The /bgcs filter params as both /api/bgcs backends read them: `sourceType`
 * values trimmed with blanks dropped, `goldBucket` trimmed. The refusals check
 * what the backends would use, so a padded or empty value that was always
 * honoured is not refused now.
 */
const bgcRefusalParams = (params: URLSearchParams): URLSearchParams => {
  const normalized = new URLSearchParams();
  for (const value of params.getAll('sourceType')) {
    if (value.trim()) normalized.append('sourceType', value.trim());
  }
  const bucket = params.get('goldBucket')?.trim();
  if (bucket) normalized.set('goldBucket', bucket);
  for (const value of params.getAll('completeness')) normalized.append('completeness', value);
  return normalized;
};

/**
 * The sentence for the first /bgcs filter value no backend can honour (an
 * unknown sourceType, goldBucket or completeness), or null. For the export,
 * whose refusals are sentences rather than 400 bodies.
 */
export const bgcFilterMessage = (params: URLSearchParams): string | null => {
  const normalized = bgcRefusalParams(params);
  try {
    parseSourceTypes(normalized);
    parseGoldBucket(normalized.get('goldBucket') ?? undefined);
    parseCompleteness(normalized);
    return null;
  } catch (error) {
    if (
      error instanceof UnknownSourceTypeError
      || error instanceof UnknownGoldBucketError
      || error instanceof UnknownCompletenessError
    ) return error.message;
    throw error;
  }
};

/**
 * The 400 for an /api/bgcs-family request whose sourceType, goldBucket or
 * completeness no backend can honour, or null. Checked BEFORE the OpenSearch
 * branch: without it an unknown bucket matched nothing on the index while the SQL
 * fallback dropped it (the answer depended on the backend), an unknown source
 * type returned an empty table, and an unknown completeness the whole corpus.
 */
export const bgcFilterRefusal = (params: URLSearchParams): NextResponse | null => {
  const normalized = bgcRefusalParams(params);
  return sourceTypeRefusal(normalized)
    ?? goldBucketRefusal(normalized)
    ?? completenessRefusal(normalized);
};
