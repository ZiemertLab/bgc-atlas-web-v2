import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';
import { isValidUuid } from '@/lib/entity-loaders';

const ensureRecord = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const parseLimit = (raw: string | null) => {
  const fallback = 100;
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), 500);
};

const parseOffset = (raw: string | null) => {
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const parseDate = (raw: string | null) => {
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return new Date(timestamp);
};

const buildWhere = (
  sampleId: string,
  params: {
    key?: string;
    source?: string;
    minDate?: Date;
    maxDate?: Date;
  }
): Prisma.SampleMeasurementWhereInput => {
  const where: Prisma.SampleMeasurementWhereInput = {
    sample_id: sampleId,
  };

  if (params.key) {
    where.key = {
      contains: params.key,
      mode: 'insensitive',
    };
  }

  if (params.source) {
    where.source = {
      contains: params.source,
      mode: 'insensitive',
    };
  }

  if (params.minDate || params.maxDate) {
    where.measured_at = {};
    if (params.minDate) {
      where.measured_at.gte = params.minDate;
    }
    if (params.maxDate) {
      where.measured_at.lte = params.maxDate;
    }
  }

  return where;
};

export async function GET(request: Request, context: { params: Promise<{ id?: string }> }) {
  const routeParams = await context.params;
  const sampleId = routeParams?.id;

  if (!sampleId || typeof sampleId !== 'string' || !isValidUuid(sampleId)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid sample id',
        message: 'A valid sample id must be provided.',
      },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  const limit = parseLimit(params.get('limit'));
  const offset = parseOffset(params.get('offset'));
  const keyFilter = params.get('key')?.trim() || undefined;
  const sourceFilter = params.get('source')?.trim() || undefined;
  const minDate = parseDate(params.get('minDate'));
  const maxDate = parseDate(params.get('maxDate'));

  try {
    const where = buildWhere(sampleId, {
      key: keyFilter,
      source: sourceFilter,
      minDate,
      maxDate,
    });

    // Filter-dependent state is cached apart from the page slice, so paging
    // reuses it.
    const filterKey = `samples:${sampleId}:measurements:filter:${JSON.stringify({
      key: keyFilter ?? null,
      source: sourceFilter ?? null,
      minDate: minDate?.toISOString() ?? null,
      maxDate: maxDate?.toISOString() ?? null,
    })}`;

    const SUMMARY_CAP = 1000;
    const filterState = await getOrSetCache<
      | { notFound: true }
      | {
          notFound: false;
          totalInDatabase: number;
          totalFiltered: number;
          summaryMeasurements: Awaited<ReturnType<typeof prisma.sampleMeasurement.findMany>>;
        }
    >(
      filterKey,
      async () => {
        const sampleExists = await prisma.sample.findUnique({
          where: { id: sampleId },
          select: { id: true },
        });
        if (!sampleExists) {
          return { notFound: true };
        }

        const [totalInDatabase, totalFiltered] = await Promise.all([
          prisma.sampleMeasurement.count({ where: { sample_id: sampleId } }),
          prisma.sampleMeasurement.count({ where }),
        ]);

        const summaryMeasurements = await prisma.sampleMeasurement.findMany({
          where,
          orderBy: [
            { measured_at: 'desc' },
            { created_at: 'desc' },
          ],
          take: Math.min(totalFiltered, SUMMARY_CAP),
        });

        return { notFound: false, totalInDatabase, totalFiltered, summaryMeasurements };
      },
      300,
    );

    if ('notFound' in filterState && filterState.notFound) {
      return NextResponse.json(
        {
          success: false,
          error: 'Sample not found',
          message: 'No sample exists with the provided id.',
        },
        { status: 404 }
      );
    }

    const { totalInDatabase, totalFiltered, summaryMeasurements } = filterState as {
      notFound: false;
      totalInDatabase: number;
      totalFiltered: number;
      summaryMeasurements: Awaited<ReturnType<typeof prisma.sampleMeasurement.findMany>>;
    };

    const pageKey = `samples:${sampleId}:measurements:page:${JSON.stringify({
      key: keyFilter ?? null,
      source: sourceFilter ?? null,
      minDate: minDate?.toISOString() ?? null,
      maxDate: maxDate?.toISOString() ?? null,
      limit,
      offset,
    })}`;
    const measurementsPage = await getOrSetCache(
      pageKey,
      () => prisma.sampleMeasurement.findMany({
        where,
        orderBy: [
          { measured_at: 'desc' },
          { created_at: 'desc' },
        ],
        skip: offset,
        take: limit,
      }),
      300,
    );

    const formatMeasurement = (measurement: typeof measurementsPage[number]) => ({
      id: measurement.id,
      key: measurement.key,
      value: measurement.value,
      unit: measurement.unit ?? undefined,
      measured_at: toIsoString(measurement.measured_at),
      source: measurement.source ?? undefined,
      metadata: ensureRecord(measurement.metadata),
      created_at: toIsoString(measurement.created_at)!,
    });

    const measurementsByKey = summaryMeasurements.reduce<Record<string, ReturnType<typeof formatMeasurement>[]>>((acc, measurement) => {
      const formatted = formatMeasurement(measurement);
      if (!acc[measurement.key]) {
        acc[measurement.key] = [];
      }
      acc[measurement.key].push(formatted);
      return acc;
    }, {});

    const keyStatistics = Object.entries(measurementsByKey).map(([key, measurements]) => {
      const numericValues = measurements
        .map((measurement) => Number(measurement.value))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);

      const statistics = numericValues.length
        ? {
            count: numericValues.length,
            min: numericValues[0],
            max: numericValues[numericValues.length - 1],
            mean: Number(
              (
                numericValues.reduce((acc, value) => acc + value, 0) /
                numericValues.length
              ).toFixed(3)
            ),
            median: (() => {
              const mid = Math.floor(numericValues.length / 2);
              if (numericValues.length % 2 === 0) {
                return Number(((numericValues[mid - 1] + numericValues[mid]) / 2).toFixed(3));
              }
              return Number(numericValues[mid].toFixed(3));
            })(),
          }
        : undefined;

      const sources = new Set<string>();
      const units = new Set<string>();
      let earliest: string | null = null;
      let latest: string | null = null;

      measurements.forEach((measurement) => {
        if (measurement.source) {
          sources.add(measurement.source);
        }
        if (measurement.unit) {
          units.add(measurement.unit);
        }
        if (measurement.measured_at) {
          if (!earliest || measurement.measured_at < earliest) {
            earliest = measurement.measured_at;
          }
          if (!latest || measurement.measured_at > latest) {
            latest = measurement.measured_at;
          }
        }
      });

      return {
        key,
        total_measurements: measurements.length,
        unique_sources: Array.from(sources).sort(),
        date_range: {
          earliest,
          latest,
        },
        units: Array.from(units).sort(),
        statistics,
      };
    });

    const uniqueSources = new Set<string>();
    const uniqueKeys = new Set<string>();
    let earliestDate: string | null = null;
    let latestDate: string | null = null;

    summaryMeasurements.forEach((measurement) => {
      uniqueKeys.add(measurement.key);
      if (measurement.source) {
        uniqueSources.add(measurement.source);
      }
      const measuredAt = toIsoString(measurement.measured_at);
      if (measuredAt) {
        if (!earliestDate || measuredAt < earliestDate) {
          earliestDate = measuredAt;
        }
        if (!latestDate || measuredAt > latestDate) {
          latestDate = measuredAt;
        }
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        measurements: measurementsPage.map(formatMeasurement),
        measurements_by_key: measurementsByKey,
      },
      pagination: {
        total: totalFiltered,
        limit,
        offset,
        has_more: offset + limit < totalFiltered,
      },
      summary: {
        total_measurements: totalFiltered,
        total_in_database: totalInDatabase,
        unique_keys: uniqueKeys.size,
        unique_sources: Array.from(uniqueSources).sort(),
        date_range: {
          earliest: earliestDate,
          latest: latestDate,
        },
        key_statistics: keyStatistics.sort((a, b) => b.total_measurements - a.total_measurements),
      },
      filters: {
        key: keyFilter,
        source: sourceFilter,
        min_date: minDate ? minDate.toISOString() : undefined,
        max_date: maxDate ? maxDate.toISOString() : undefined,
      },
    });
  } catch (error) {
    return serverError(error, 'Failed to load sample measurements');
  }
}
