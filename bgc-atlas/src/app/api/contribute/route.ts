import { NextResponse } from 'next/server';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildMailTransport } from '@/lib/mail/transport';
import { Prisma, PrismaClient } from '@prisma/client';
import { parseAndValidateCsv } from '@/lib/metadata/validation';
import { contributeRateLimit, getClientIp, checkRateLimit } from '@/lib/rate-limit';
import {
  CONTRIBUTE_ASSEMBLY_MAX_BYTES,
  CONTRIBUTE_MAX_ASSEMBLY_FILES,
  CONTRIBUTE_METADATA_MAX_BYTES,
  CONTRIBUTE_REQUEST_MAX_BYTES,
} from '@/lib/contribute/limits';
import { serverError, UserFacingError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();

// nginx caps the request at 500 MB (see lib/contribute/limits.ts).
const MAX_ASSEMBLY_FILES = CONTRIBUTE_MAX_ASSEMBLY_FILES;
const MAX_ASSEMBLY_FILE_BYTES = CONTRIBUTE_ASSEMBLY_MAX_BYTES;
const MAX_ASSEMBLY_TOTAL_BYTES = CONTRIBUTE_ASSEMBLY_MAX_BYTES;
const MAX_METADATA_FILE_BYTES = CONTRIBUTE_METADATA_MAX_BYTES;
const MAX_CONTRIBUTION_REQUEST_BYTES = CONTRIBUTE_REQUEST_MAX_BYTES;

const ALLOWED_ASSEMBLY_TYPES = new Set([
  '',
  'application/gzip',
  'application/octet-stream',
  'application/x-gzip',
  'application/x-fasta',
  'application/x-gzip-compressed',
  'text/plain',
  'text/x-fasta',
]);

const ALLOWED_METADATA_TYPES = new Set([
  '',
  'application/csv',
  'application/octet-stream',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
]);

const sanitizeFilename = (name: string) => {
  const base = path.basename(name);
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const toStringValue = (value: FormDataEntryValue | null) =>
  typeof value === 'string' ? value.trim() : value instanceof File ? value.name : '';

const REQUIRED_FIELDS = ['name', 'institute', 'email', 'description'] as const;
const ASSEMBLY_EXTENSION_RE = /\.(fa|fna|fasta|fas|faa)(\.gz)?$/i;
const METADATA_EXTENSION_RE = /\.(csv|tsv|txt|tab)$/i;

type SubmissionFields = Record<(typeof REQUIRED_FIELDS)[number], string> & {
  submissionId: string;
  assemblies: string[];
  metadata?: string;
};

const getUploadsDir = () => {
  const uploadsDir = process.env.USER_UPLOADS_DIR;
  if (!uploadsDir || uploadsDir.trim() === '') {
    throw new Error('User uploads directory is not configured. Set USER_UPLOADS_DIR in the environment.');
  }
  return uploadsDir;
};

const createSubmissionId = () => {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
  return `${timestamp}-${crypto.randomUUID()}`;
};

const formatBytes = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const parseContentLength = (request: Request) => {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const validateRequestEnvelope = (request: Request) => {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Expected multipart/form-data upload.' },
      { status: 415 },
    );
  }

  const contentLength = parseContentLength(request);
  if (contentLength === null) {
    return NextResponse.json(
      { error: 'Content-Length header is required for uploads.' },
      { status: 411 },
    );
  }

  if (contentLength > MAX_CONTRIBUTION_REQUEST_BYTES) {
    return NextResponse.json(
      { error: `Upload request is too large. Maximum request size is ${formatBytes(MAX_CONTRIBUTION_REQUEST_BYTES)}.` },
      { status: 413 },
    );
  }

  return null;
};

const validateAssemblyFiles = (files: File[]) => {
  if (files.length > MAX_ASSEMBLY_FILES) {
    return `Too many assembly files (${files.length}). Submit one assembly file per contribution.`;
  }

  let totalBytes = 0;
  for (const file of files) {
    if (file.size === 0) continue;
    const filename = file.name || 'assembly';
    totalBytes += file.size;

    if (file.size > MAX_ASSEMBLY_FILE_BYTES) {
      return `Assembly file '${filename}' is too large. Maximum per-file size is ${formatBytes(MAX_ASSEMBLY_FILE_BYTES)}.`;
    }
    if (!ASSEMBLY_EXTENSION_RE.test(filename)) {
      return `Assembly file '${filename}' must be FASTA (.fa, .fna, .fasta, .fas, .faa) with optional .gz compression.`;
    }
    if (!ALLOWED_ASSEMBLY_TYPES.has(file.type)) {
      return `Assembly file '${filename}' has unsupported content type '${file.type}'.`;
    }
  }

  if (totalBytes > MAX_ASSEMBLY_TOTAL_BYTES) {
    return `Assembly uploads are too large. Maximum total assembly size is ${formatBytes(MAX_ASSEMBLY_TOTAL_BYTES)}.`;
  }

  return null;
};

const validateMetadataFile = (file: File | null) => {
  if (!file || file.size === 0) return null;
  const filename = file.name || 'metadata';

  if (file.size > MAX_METADATA_FILE_BYTES) {
    return `Metadata file '${filename}' is too large. Maximum metadata size is ${formatBytes(MAX_METADATA_FILE_BYTES)}.`;
  }
  if (!METADATA_EXTENSION_RE.test(filename)) {
    return `Metadata file '${filename}' must be CSV, TSV, TXT, or TAB.`;
  }
  if (!ALLOWED_METADATA_TYPES.has(file.type)) {
    return `Metadata file '${filename}' has unsupported content type '${file.type}'.`;
  }

  return null;
};

const writeFileChunk = async (stream: ReturnType<typeof createWriteStream>, chunk: Uint8Array) => {
  const buffer = Buffer.from(chunk);
  if (!stream.write(buffer)) {
    await new Promise<void>((resolve, reject) => {
      stream.once('drain', resolve);
      stream.once('error', reject);
    });
  }
};

const closeFileStream = async (stream: ReturnType<typeof createWriteStream>) => {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
};

const saveFile = async (dir: string, file: File, maxBytes: number) => {
  const safeName = sanitizeFilename(file.name || 'file');
  const targetPath = path.join(dir, safeName);
  const reader = file.stream().getReader();
  const writer = createWriteStream(targetPath, { flags: 'wx' });
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new UserFacingError(`File '${file.name}' exceeded ${formatBytes(maxBytes)} while streaming.`, 413);
      }

      await writeFileChunk(writer, value);
    }

    await closeFileStream(writer);
  } catch (error) {
    writer.destroy();
    await unlink(targetPath).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return safeName;
};

const saveSubmission = async (
  submissionDir: string,
  fields: SubmissionFields,
) => {
  const summaryPath = path.join(submissionDir, 'submission.json');
  await writeFile(summaryPath, JSON.stringify(fields, null, 2), 'utf8');
};

const sendAcknowledgementEmail = async (fields: SubmissionFields, sampleCount: number = 0) => {
  const mailConfig = buildMailTransport();
  if (!mailConfig) return;

  const ccRaw = process.env.CONTRIBUTION_CC || '';
  const cc = ccRaw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const { transporter, from } = mailConfig;
  const to = fields.email;
  const subject = `BGC Atlas contribution received (${fields.submissionId})`;
  const body = `Hello ${fields.name},\n\nThank you for contributing to BGC Atlas. We received your submission and will follow up if we need additional information.\n\nSubmission ID: ${fields.submissionId}\nInstitute: ${fields.institute}\nDescription: ${fields.description}\nAssemblies: ${fields.assemblies.length > 0 ? fields.assemblies.join(', ') : 'None provided'}\nMetadata file: ${fields.metadata ?? 'None provided'}${sampleCount > 0 ? `\nSamples parsed: ${sampleCount}` : ''}\n\nBest regards,\nThe BGC Atlas Team`;

  await transporter.sendMail({
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    replyTo: to,
    subject,
    text: body,
  });
};

export async function POST(request: Request) {
  // Uploads up to 500 MB to CephFS; the general 100/min limit is far too loose.
  const clientIp = getClientIp(request);
  const rateLimitResult = await checkRateLimit(contributeRateLimit, clientIp);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: rateLimitResult.error },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimitResult.reset - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(rateLimitResult.limit),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
        },
      },
    );
  }

  try {
    const envelopeError = validateRequestEnvelope(request);
    if (envelopeError) return envelopeError;

    const formData = await request.formData();

    const fields: SubmissionFields = {
      submissionId: createSubmissionId(),
      name: '',
      institute: '',
      email: '',
      description: '',
      assemblies: [],
    };

    for (const field of REQUIRED_FIELDS) {
      const value = toStringValue(formData.get(field));
      if (!value) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 },
        );
      }
      fields[field] = value;
    }

    const assemblyEntries = formData.getAll('assemblies').filter((entry): entry is File => entry instanceof File);
    const metadataEntry = formData.get('metadata');
    const metadataFile = metadataEntry instanceof File ? metadataEntry : null;

    const assemblyValidationError = validateAssemblyFiles(assemblyEntries);
    if (assemblyValidationError) {
      return NextResponse.json({ error: assemblyValidationError }, { status: 400 });
    }

    const metadataValidationError = validateMetadataFile(metadataFile);
    if (metadataValidationError) {
      return NextResponse.json({ error: metadataValidationError }, { status: 400 });
    }

    const uploadsRoot = getUploadsDir();
    const submissionDir = path.join(uploadsRoot, fields.submissionId);
    await mkdir(submissionDir, { recursive: true });

    try {
      for (const file of assemblyEntries) {
        if (file.size === 0) continue;
        const savedName = await saveFile(submissionDir, file, MAX_ASSEMBLY_FILE_BYTES);
        fields.assemblies.push(savedName);
      }

      let sampleCount = 0;

      if (metadataFile && metadataFile.size > 0) {
        const metadataName = await saveFile(submissionDir, metadataFile, MAX_METADATA_FILE_BYTES);
        fields.metadata = metadataName;

        const metadataContent = await metadataFile.text();
        const { validationResult } = await parseAndValidateCsv(metadataContent);

        const contribution = await prisma.userContribution.create({
          data: {
            submission_id: fields.submissionId,
            name: fields.name,
            institute: fields.institute,
            email: fields.email,
            description: fields.description,
            assembly_count: fields.assemblies.length,
            metadata_provided: true,
            status: 'pending',
          },
        });

        const validSamples = validationResult.samples.filter((s) => s.valid && s.data);

        for (const sampleResult of validSamples) {
          const sample = sampleResult.data!;

          // Assemblies belong to a sample by filename convention.
          const assemblyFilenames = fields.assemblies.filter((filename) =>
            filename.toLowerCase().includes(sample.sample_alias.toLowerCase())
          );

          await prisma.userContributionSample.create({
            data: {
              contribution_id: contribution.id,
              sample_alias: sample.sample_alias,
              assembly_filenames: assemblyFilenames,
              latitude: sample.latitude ? String(sample.latitude) : null,
              longitude: sample.longitude ? String(sample.longitude) : null,
              geographic_location: sample.geographic_location || null,
              location_resolution: sample.location_resolution || null,
              geolocation_name: sample.geolocation_name || null,
              environment_biome: sample.environment_biome || null,
              environment_feature: sample.environment_feature || null,
              environment_material: sample.environment_material || null,
              environmental_package: sample.environmental_package || null,
              depth_min_meters: sample.depth_min_meters ? String(sample.depth_min_meters) : null,
              depth_max_meters: sample.depth_max_meters ? String(sample.depth_max_meters) : null,
              elevation_meters: sample.elevation_meters ? String(sample.elevation_meters) : null,
              temperature: sample.temperature ? String(sample.temperature) : null,
              ph: sample.ph ? String(sample.ph) : null,
              salinity: sample.salinity ? String(sample.salinity) : null,
              salinity_unit: sample.salinity_unit || null,
              current_precipitation_mm: sample.current_precipitation_mm ? String(sample.current_precipitation_mm) : null,
              mean_annual_precipitation_mm: sample.mean_annual_precipitation_mm ? String(sample.mean_annual_precipitation_mm) : null,
              mean_annual_temperature: sample.mean_annual_temperature ? String(sample.mean_annual_temperature) : null,
              collection_date: sample.collection_date ? new Date(sample.collection_date) : null,
              collection_date_end: sample.collection_date_end ? new Date(sample.collection_date_end) : null,
              description: sample.description || null,
              host_taxid: sample.host_taxid || null,
              host_scientific_name: sample.host_scientific_name || null,
              external_id: sample.external_id || null,
              accession: sample.accession || null,
              additional_metadata: (sample.additional_metadata || {}) as unknown as Prisma.InputJsonValue,
              validation_warnings: (sampleResult.warnings || []) as unknown as Prisma.InputJsonValue,
            },
          });

          sampleCount++;
        }

        console.log(`Stored ${sampleCount} samples for contribution ${fields.submissionId}`);
      } else if (fields.assemblies.length > 0) {
        await prisma.userContribution.create({
          data: {
            submission_id: fields.submissionId,
            name: fields.name,
            institute: fields.institute,
            email: fields.email,
            description: fields.description,
            assembly_count: fields.assemblies.length,
            metadata_provided: false,
            status: 'pending',
          },
        });
      }

      await saveSubmission(submissionDir, fields);

      try {
        await sendAcknowledgementEmail(fields, sampleCount);
      } catch (emailError) {
        console.error('Failed to send acknowledgement email', emailError);
      }

      return NextResponse.json({
        success: true,
        submissionId: fields.submissionId,
        sampleCount,
      });
    } catch (processingError) {
      await rm(submissionDir, { recursive: true, force: true }).catch(() => undefined);
      throw processingError;
    }
  } catch (err) {
    return serverError(err, 'Contribution processing failed');
  }
}
