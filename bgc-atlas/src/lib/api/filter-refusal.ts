import { NextResponse } from 'next/server';

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

// Each refusal replaces a wider answer at HTTP 200. The text goes in both `error` and `message`
// since browse pages each read one. Null for anything else, so the caller's 500 branch runs.
export const filterRefusalResponse = (error: unknown): NextResponse | null => {
  if (error instanceof UnhonourableQueryError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        message: error.message,
        rejected: error.conditions,
      },
      { status: 400 },
    );
  }
  if (error instanceof MalformedFilterPayloadError) {
    return NextResponse.json(
      { success: false, error: error.message, message: error.message, rejected: [] },
      { status: 400 },
    );
  }
  if (error instanceof UnknownGoldBucketError) {
    return NextResponse.json(
      { success: false, error: error.message, message: error.message, rejected: [error.bucket] },
      { status: 400 },
    );
  }
  if (error instanceof FamilyClassFilterError) {
    return NextResponse.json(
      { success: false, error: error.message, message: error.message, rejected: error.rejected },
      { status: 400 },
    );
  }
  if (error instanceof CategoryShareFilterError) {
    return NextResponse.json(
      { success: false, error: error.message, message: error.message, rejected: error.rejected },
      { status: 400 },
    );
  }
  if (error instanceof UnknownSourceTypeError) {
    return NextResponse.json(
      {
        success: false,
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
