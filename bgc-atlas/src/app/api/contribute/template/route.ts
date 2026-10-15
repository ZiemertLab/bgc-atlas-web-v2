import { NextResponse } from 'next/server';
import { getTemplateDownloadContent } from '@/lib/metadata/template';
import { serverError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'tsv') as 'tsv' | 'csv' | 'wide';

    if (!['tsv', 'csv', 'wide'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Must be tsv (default long format), csv, or wide' },
        { status: 400 }
      );
    }

    const { content, filename, contentType } = getTemplateDownloadContent(format);

    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return serverError(error, 'Template download error');
  }
}
