import { NextResponse } from 'next/server';
import { decodeMetadataBytes, metadataProblems, parseAndValidateCsv } from '@/lib/metadata/validation';
import { serverError } from '@/lib/api/errors';
import { CONTRIBUTE_METADATA_MAX_BYTES } from '@/lib/contribute/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The submit route's limit, so a file that passes validation is not refused at submit.
const MAX_FILE_SIZE = CONTRIBUTE_METADATA_MAX_BYTES;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('metadata') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No metadata file provided' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024} MB` },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.tsv') && !fileName.endsWith('.txt') && !fileName.endsWith('.tab')) {
      return NextResponse.json(
        { error: 'Invalid file type. Must be CSV, TSV, or TXT' },
        { status: 400 }
      );
    }

    // BOM dropped, UTF-16 decoded (decodeMetadataBytes).
    const fileContent = decodeMetadataBytes(new Uint8Array(await file.arrayBuffer()));

    if (!fileContent.trim()) {
      return NextResponse.json(
        { error: 'File is empty' },
        { status: 400 }
      );
    }

    const { parsingResult, validationResult } = await parseAndValidateCsv(fileContent);
    // The submit route's own verdict, so the page blocks exactly what it would refuse:
    // rows that could not be read count, not just samples that failed validation.
    const problems = metadataProblems(parsingResult, validationResult);

    return NextResponse.json({
      success: true,
      parsing: {
        format: parsingResult.format,
        delimiter: parsingResult.delimiter,
        totalRows: parsingResult.samples.length,
        errors: parsingResult.errors,
      },
      validation: {
        valid: problems.length === 0,
        problems,
        totalSamples: validationResult.totalSamples,
        validSamples: validationResult.validSamples,
        invalidSamples: validationResult.invalidSamples,
        samples: validationResult.samples.map((sample) => ({
          sampleAlias: sample.sampleAlias,
          valid: sample.valid,
          errors: sample.errors,
          warnings: sample.warnings,
          data: sample.data,
        })),
      },
    });
  } catch (error) {
    return serverError(error, 'Validation error');
  }
}
