import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { mapSampleRowToSample, type SampleRow } from '@/lib/api/samples-query';
import { serverError } from '@/lib/api/errors';

export async function GET(_request: Request, context: { params: Promise<{ id?: string }> }) {
  const params = await context.params;
  const sampleId = params?.id;

  if (!sampleId || typeof sampleId !== 'string') {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid sample id',
        message: 'A valid sample id must be provided.',
      },
      { status: 400 }
    );
  }

  try {
    const payload = await getOrSetCache<{ sample: ReturnType<typeof mapSampleRowToSample> | null }>(
      // Versioned: an older entry lacks checkmTool / checkmSource (provenance).
      `samples:detail:v2:${sampleId}`,
      async () => {
        // Physicochemical and genome-QC columns are read from `samples`: adding
        // them to sample_summary means a multi-GB cascade rebuild.
        const rows = await prisma.$queryRaw<SampleRow[]>(Prisma.sql`
          SELECT sb.*,
                 -- fresh values override the MV's stale copies
                 s.salinity, s.salinity_unit, s.temperature, s.ph,
                 s.dissolved_oxygen, s.dissolved_oxygen_unit,
                 s.nitrate, s.nitrate_unit, s.nitrite, s.nitrite_unit,
                 s.ammonium, s.ammonium_unit, s.phosphate, s.phosphate_unit,
                 s.conductivity, s.conductivity_unit,
                 s.dissolved_organic_carbon, s.dissolved_organic_carbon_unit,
                 s.filtration_lower_threshold_um, s.filtration_upper_threshold_um,
                 s.checkm_completeness, s.checkm_contamination,
                 s.checkm_tool, s.checkm_source,
                 s.genome_size, s.genome_quality
          FROM sample_summary sb
          JOIN samples s ON s.id = sb.id
          WHERE sb.id::text = ${sampleId}
          LIMIT 1
        `);
        const row = rows[0];
        return { sample: row ? mapSampleRowToSample(row) : null };
      },
      300,
    );

    if (!payload.sample) {
      return NextResponse.json(
        {
          success: false,
          error: 'Sample not found',
          message: 'No sample exists with the provided id.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: payload.sample,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    return serverError(error, 'Failed to load sample detail');
  }
}
