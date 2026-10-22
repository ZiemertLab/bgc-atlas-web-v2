import { NextResponse } from 'next/server';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildMailTransport } from '@/lib/mail/transport';
import { isSingleEmailAddress } from '@/lib/mail/address';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  assembliesForSample, decodeMetadataBytes, metadataProblems, parseAndValidateCsv,
} from '@/lib/metadata/validation';
import { contributeRateLimit, getClientIp, checkRateLimit } from '@/lib/rate-limit';
import {
  CONTRIBUTE_ASSEMBLY_MAX_BYTES,
  CONTRIBUTE_MAX_ASSEMBLY_FILES,
  CONTRIBUTE_METADATA_MAX_BYTES,
  CONTRIBUTE_REQUEST_MAX_BYTES,
} from '@/lib/contribute/limits';
import { serverError } from '@/lib/api/errors';
import { receiveMultipart, type FilePolicy, type ReceivedUpload } from '@/lib/contribute/multipart';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


// nginx caps the request at 500 MB (see lib/contribute/limits.ts).
const MAX_ASSEMBLY_FILES = CONTRIBUTE_MAX_ASSEMBLY_FILES;
const MAX_ASSEMBLY_FILE_BYTES = CONTRIBUTE_ASSEMBLY_MAX_BYTES;
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

const REQUIRED_FIELDS = ['name', 'institute', 'email', 'description'] as const;

/**
 * Uploads received at once, per server process. The body is streamed to disk
 * (lib/contribute/multipart.ts), so this no longer bounds memory -- request.formData()
 * held up to nginx's 500 MB per upload -- but it still bounds concurrent writes
 * to the uploads volume from one form nobody submits twice a day.
 */
const MAX_CONCURRENT_UPLOADS = 2;
let uploadsInFlight = 0;
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

const checkAssembly = (filename: string, mimeType: string) => {
  if (!ASSEMBLY_EXTENSION_RE.test(filename)) {
    return `Assembly file '${filename}' must be FASTA (.fa, .fna, .fasta, .fas, .faa) with optional .gz compression.`;
  }
  if (!ALLOWED_ASSEMBLY_TYPES.has(mimeType)) {
    return `Assembly file '${filename}' has unsupported content type '${mimeType}'.`;
  }
  return null;
};

const checkMetadata = (filename: string, mimeType: string) => {
  if (!METADATA_EXTENSION_RE.test(filename)) {
    return `Metadata file '${filename}' must be CSV, TSV, TXT, or TAB.`;
  }
  if (!ALLOWED_METADATA_TYPES.has(mimeType)) {
    return `Metadata file '${filename}' has unsupported content type '${mimeType}'.`;
  }
  return null;
};

const UPLOAD_POLICIES: Record<string, FilePolicy> = {
  assemblies: {
    maxCount: MAX_ASSEMBLY_FILES,
    tooMany: (count) => `Too many assembly files (${count}). Submit one assembly file per contribution.`,
    maxBytes: MAX_ASSEMBLY_FILE_BYTES,
    check: checkAssembly,
    tooLarge: (filename) =>
      `Assembly file '${filename}' is too large. Maximum per-file size is ${formatBytes(MAX_ASSEMBLY_FILE_BYTES)}.`,
  },
  metadata: {
    maxCount: 1,
    tooMany: () => 'Submit one metadata file per contribution.',
    maxBytes: MAX_METADATA_FILE_BYTES,
    check: checkMetadata,
    tooLarge: (filename) =>
      `Metadata file '${filename}' is too large. Maximum metadata size is ${formatBytes(MAX_METADATA_FILE_BYTES)}.`,
    keepContent: true,
  },
};

// The acknowledgement is sent to this address, so it must be one address: a
// list here made the form a mail relay under the atlas From address.
const SINGLE_ADDRESS_ERROR = 'Please enter a single valid email address.';

/**
 * The contact fields' column widths (varchar(255)). Checked before the upload is
 * stored: the database refused a longer name only after a 490 MB file had arrived,
 * and the route then deleted it.
 */
const FIELD_MAX_LENGTH: Partial<Record<(typeof REQUIRED_FIELDS)[number], number>> = {
  name: 255,
  institute: 255,
  email: 255,
};
const FIELD_LABEL: Record<(typeof REQUIRED_FIELDS)[number], string> = {
  name: 'Contact name',
  institute: 'Institute',
  email: 'Email',
  description: 'Description',
};
const fieldLengthError = (fields: Partial<Record<string, string | string[]>>) => {
  for (const [field, max] of Object.entries(FIELD_MAX_LENGTH) as [(typeof REQUIRED_FIELDS)[number], number][]) {
    const raw = fields[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value && value.length > max) return `${FIELD_LABEL[field]} is too long (${max} characters at most).`;
  }
  return null;
};

/** Refuse a form whose fields are already wrong before its upload is written. */
const checkFieldsBeforeFile = (fields: Record<string, string>) =>
  fields.email !== undefined && !isSingleEmailAddress(fields.email.trim())
    ? SINGLE_ADDRESS_ERROR
    : fieldLengthError(fields);

const saveSubmission = async (
  submissionDir: string,
  fields: SubmissionFields,
) => {
  const summaryPath = path.join(submissionDir, 'submission.json');
  await writeFile(summaryPath, JSON.stringify(fields, null, 2), 'utf8');
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "1 assembly, 1 metadata file (12 samples)": what arrived, without anything the submitter typed. */
const filesReceived = (fields: SubmissionFields, sampleCount: number): string => {
  const parts: string[] = [];
  if (fields.assemblies.length > 0) parts.push(plural(fields.assemblies.length, 'assembly', 'assemblies'));
  if (fields.metadata) {
    parts.push(`1 metadata file${sampleCount > 0 ? ` (${plural(sampleCount, 'sample', 'samples')})` : ''}`);
  }
  return parts.join(', ');
};

/** One line, bounded: submitter text going into a Subject header. */
const headerText = (value: string, max = 80) => value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/**
 * Two emails, so submitter-written text only ever reaches the team.
 *
 * The acknowledgement used to quote the submitter's name, institute, description and
 * file names back to the address in the form -- any single address -- under the atlas
 * From address: text of the sender's choosing, relayed to a recipient of their
 * choosing. It now says only what arrived. Everything the submitter wrote goes in a
 * separate notification to CONTRIBUTION_CC, with Reply-To set to the submitter.
 *
 * A submission with no files is not acknowledged at all (see the route): it was
 * only ever an email to an address the sender chose.
 */
const sendContributionEmails = async (fields: SubmissionFields, sampleCount: number = 0) => {
  const mailConfig = buildMailTransport();
  if (!mailConfig) return;
  const { transporter, from } = mailConfig;

  const team = (process.env.CONTRIBUTION_CC || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const hasFiles = fields.assemblies.length > 0 || !!fields.metadata;

  if (team.length > 0) {
    const details = [
      `Submission ID: ${fields.submissionId}`,
      `Name: ${fields.name}`,
      `Institute: ${fields.institute}`,
      `Email: ${fields.email}`,
      `Description: ${fields.description}`,
      `Assemblies: ${fields.assemblies.length > 0 ? fields.assemblies.join(', ') : 'None provided'}`,
      `Metadata file: ${fields.metadata ?? 'None provided'}${sampleCount > 0 ? ` (${plural(sampleCount, 'sample', 'samples')} parsed)` : ''}`,
    ];
    try {
      await transporter.sendMail({
        from,
        to: team,
        replyTo: fields.email,
        subject: `BGC Atlas contribution: ${headerText(fields.name)} (${headerText(fields.institute)})`,
        text: `A contribution was submitted to BGC Atlas.${hasFiles ? '' : ' It has no files attached, so the submitter was not sent an acknowledgement.'}\n\n${details.join('\n')}\n\nReplying to this message reaches the submitter.`,
      });
    } catch (error) {
      console.error('Failed to send the contribution notification to the team', error);
    }
  }

  if (hasFiles) {
    try {
      await transporter.sendMail({
        from,
        to: fields.email,
        subject: `BGC Atlas contribution received (${fields.submissionId})`,
        text: [
          'Hello,',
          '',
          'Thank you for contributing to BGC Atlas. We received your submission and will follow up if we need additional information.',
          '',
          `Submission ID: ${fields.submissionId}`,
          `Files received: ${filesReceived(fields, sampleCount)}`,
          '',
          'If you did not submit this, you can ignore this message.',
          '',
          'Best regards,',
          'The BGC Atlas Team',
        ].join('\n'),
      });
    } catch (error) {
      console.error('Failed to send the contribution acknowledgement', error);
    }
  }
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

  const envelopeError = validateRequestEnvelope(request);
  if (envelopeError) return envelopeError;

  if (uploadsInFlight >= MAX_CONCURRENT_UPLOADS) {
    return NextResponse.json(
      { error: 'Another contribution is being uploaded right now. Please try again in a minute.' },
      { status: 503, headers: { 'Retry-After': '60' } },
    );
  }
  uploadsInFlight += 1;

  try {
    const fields: SubmissionFields = {
      submissionId: createSubmissionId(),
      name: '',
      institute: '',
      email: '',
      description: '',
      assemblies: [],
    };
    const submissionDir = path.join(getUploadsDir(), fields.submissionId);

    let upload: ReceivedUpload;
    try {
      upload = await receiveMultipart(request, {
        dir: submissionDir,
        files: UPLOAD_POLICIES,
        safeName: sanitizeFilename,
        checkFieldsBeforeFile,
      });
    } catch (error) {
      await rm(submissionDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    for (const field of REQUIRED_FIELDS) {
      const value = (upload.fields[field] ?? '').trim();
      if (!value) {
        await rm(submissionDir, { recursive: true, force: true }).catch(() => undefined);
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 },
        );
      }
      fields[field] = value;
    }

    if (!isSingleEmailAddress(fields.email)) {
      await rm(submissionDir, { recursive: true, force: true }).catch(() => undefined);
      return NextResponse.json({ error: SINGLE_ADDRESS_ERROR }, { status: 400 });
    }
    const lengthError = fieldLengthError(fields);
    if (lengthError) {
      await rm(submissionDir, { recursive: true, force: true }).catch(() => undefined);
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }

    const metadataFile = upload.files.find((f) => f.field === 'metadata') ?? null;

    // Metadata that does not validate is refused, not half-stored: the page blocks
    // Submit until the file is fixed, and this is the same rule for any other caller.
    const metadata = metadataFile?.content
      ? await parseAndValidateCsv(decodeMetadataBytes(metadataFile.content))
      : null;
    const problems = metadata ? metadataProblems(metadata.parsingResult, metadata.validationResult) : [];
    if (problems.length > 0) {
      await rm(submissionDir, { recursive: true, force: true }).catch(() => undefined);
      return NextResponse.json(
        { error: `The metadata file needs fixing before it can be submitted: ${problems.join(' | ')}`, problems },
        { status: 400 },
      );
    }
    fields.assemblies = upload.files.filter((f) => f.field === 'assemblies').map((f) => f.savedName);
    // Created by the first file; a file-less submission still keeps its record here.
    await mkdir(submissionDir, { recursive: true });

    try {
      let sampleCount = 0;
      const contributionData = {
        submission_id: fields.submissionId,
        name: fields.name,
        institute: fields.institute,
        email: fields.email,
        description: fields.description,
        assembly_count: fields.assemblies.length,
        status: 'pending',
      };

      if (metadata && metadataFile) {
        fields.metadata = metadataFile.savedName;
        const validSamples = metadata.validationResult.samples.filter((s) => s.valid && s.data);
        // 0 is a value: depth 0, 0 degrees C, salinity 0, the equator. A truthiness
        // test stored every one of them as NULL.
        const num = (v: number | undefined | null) => (v === undefined || v === null ? null : String(v));
        const text = (v: string | undefined | null) => (v === undefined || v === null || v === '' ? null : v);

        // One transaction: a failure part-way used to leave the contribution row and
        // some of its samples behind while the route deleted the uploaded files.
        await prisma.$transaction(async (tx) => {
          const contribution = await tx.userContribution.create({
            data: { ...contributionData, metadata_provided: true },
          });
          await tx.userContributionSample.createMany({
            data: validSamples.map(({ data, warnings }) => {
              const sample = data!;
              return {
                contribution_id: contribution.id,
                sample_alias: sample.sample_alias,
                // The file's own assembly_filenames column when it has one, else the
                // alias matched against the uploaded names.
                assembly_filenames: sample.assembly_filenames?.length
                  ? sample.assembly_filenames
                  : assembliesForSample(sample.sample_alias, fields.assemblies, validSamples.length),
                latitude: num(sample.latitude),
                longitude: num(sample.longitude),
                geographic_location: text(sample.geographic_location),
                location_resolution: text(sample.location_resolution),
                geolocation_name: text(sample.geolocation_name),
                environment_biome: text(sample.environment_biome),
                environment_feature: text(sample.environment_feature),
                environment_material: text(sample.environment_material),
                environmental_package: text(sample.environmental_package),
                depth_min_meters: num(sample.depth_min_meters),
                depth_max_meters: num(sample.depth_max_meters),
                elevation_meters: num(sample.elevation_meters),
                temperature: num(sample.temperature),
                ph: num(sample.ph),
                salinity: num(sample.salinity),
                salinity_unit: text(sample.salinity_unit),
                current_precipitation_mm: num(sample.current_precipitation_mm),
                mean_annual_precipitation_mm: num(sample.mean_annual_precipitation_mm),
                mean_annual_temperature: num(sample.mean_annual_temperature),
                collection_date: sample.collection_date ? new Date(sample.collection_date) : null,
                collection_date_end: sample.collection_date_end ? new Date(sample.collection_date_end) : null,
                description: text(sample.description),
                host_taxid: sample.host_taxid ?? null,
                host_scientific_name: text(sample.host_scientific_name),
                external_id: text(sample.external_id),
                accession: text(sample.accession),
                additional_metadata: (sample.additional_metadata || {}) as unknown as Prisma.InputJsonValue,
                validation_warnings: (warnings || []) as unknown as Prisma.InputJsonValue,
              };
            }),
          });
        });
        sampleCount = validSamples.length;

        console.log(`Stored ${sampleCount} samples for contribution ${fields.submissionId}`);
      } else if (fields.assemblies.length > 0) {
        await prisma.userContribution.create({
          data: { ...contributionData, metadata_provided: false },
        });
      }

      await saveSubmission(submissionDir, fields);

      // Each email catches its own failure: a mail outage must not fail a saved submission.
      await sendContributionEmails(fields, sampleCount);

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
  } finally {
    uploadsInFlight -= 1;
  }
}
