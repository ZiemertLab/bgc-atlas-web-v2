/**
 * Read a multipart upload as it arrives, writing its files straight to disk. Server only.
 *
 * request.formData() holds the whole body in memory -- up to nginx's 500 MB --
 * before a byte of it can be written anywhere, so a few uploads at once could
 * take the heap of the process that serves the whole site. Here a file part is
 * piped to its file as it streams in, a size limit stops it the moment it is
 * crossed, and a part that is refused stops the read before the rest is sent.
 *
 * What a part may be is the caller's (`FilePolicy.check`); this module only
 * enforces it. Files land in `dir`, created before the body is read. On an error
 * the caller removes `dir`: written files are not cleaned up here.
 */
import Busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { UserFacingError } from '@/lib/api/errors';

export interface FilePolicy {
  /** More parts than this under the field is an error, worded by tooMany. */
  maxCount: number;
  tooMany: (count: number) => string;
  maxBytes: number;
  /** A refusal for this file, judged from its name and declared type, or null. */
  check: (filename: string, mimeType: string) => string | null;
  /** The message when the file passes maxBytes. */
  tooLarge: (filename: string) => string;
  /** Keep the bytes in memory as well, for a small file the route reads back. */
  keepContent?: boolean;
  /**
   * Check the file's content as it streams past, for checks that need the bytes
   * (a hash, a format sniff). `finish` runs once the file is on disk; it throws to
   * refuse the file, and what it returns is kept as `ReceivedFile.inspection`. With
   * an inspector, an empty file is the inspector's to judge, not silently skipped.
   */
  inspect?: (filename: string) => FileInspector;
}

export interface FileInspector {
  push: (chunk: Buffer) => void;
  finish: (bytes: number) => unknown;
}

export interface ReceivedFile {
  field: string;
  /** As the client named it. */
  filename: string;
  /** Under `dir`. */
  savedName: string;
  bytes: number;
  content?: Buffer;
  /** What the policy's inspector returned. */
  inspection?: unknown;
}

export interface ReceivedUpload {
  fields: Record<string, string>;
  files: ReceivedFile[];
}

export interface ReceiveOptions {
  dir: string;
  files: Record<string, FilePolicy>;
  /** Sanitises a client filename into a name safe to write under `dir`. */
  safeName: (filename: string) => string;
  /**
   * Judged on the fields received so far, before each file is written: a form
   * whose text fields are already wrong is refused before its upload is stored.
   */
  checkFieldsBeforeFile?: (fields: Record<string, string>) => string | null;
  maxFieldBytes?: number;
  maxFields?: number;
  /** All files together, with the message for passing it. */
  maxTotalBytes?: number;
  tooLargeTotal?: string;
}

export async function receiveMultipart(request: Request, options: ReceiveOptions): Promise<ReceivedUpload> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!request.body) throw new UserFacingError('The upload was empty.', 400);

  // One byte over the largest policy: the per-file counter below enforces each
  // policy's own limit, and busboy's is only the backstop.
  const largest = Math.max(...Object.values(options.files).map((p) => p.maxBytes)) + 1;
  let busboy: Busboy.Busboy;
  try {
    busboy = Busboy({
      headers: { 'content-type': contentType },
      limits: {
        fileSize: largest,
        fieldSize: options.maxFieldBytes ?? 1024 * 1024,
        fields: options.maxFields ?? 50,
        files: Object.values(options.files).reduce((n, p) => n + p.maxCount, 0) + 1,
      },
    });
  } catch {
    throw new UserFacingError('Expected multipart/form-data upload.', 415);
  }

  const fields: Record<string, string> = {};
  const files: ReceivedFile[] = [];
  const counts: Record<string, number> = {};
  const writes: Promise<void>[] = [];
  const open = new Set<Readable>();
  let totalBytes = 0;
  const body = Readable.fromWeb(request.body as import('node:stream/web').ReadableStream);
  let failure: Error | null = null;
  // Before parsing, so each file's pipe is attached the moment its part starts:
  // a listener added later would miss what had already been read, or an error.
  await mkdir(options.dir, { recursive: true });

  return new Promise<ReceivedUpload>((resolve, reject) => {
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      // Stop reading: the client is told now, not after sending the rest.
      body.unpipe(busboy);
      body.destroy();
      // A file still streaming would otherwise wait forever for the rest of a
      // body that is no longer being read, and its write with it.
      for (const stream of open) stream.destroy(error);
      Promise.allSettled(writes).then(() => reject(error));
    };

    busboy.on('field', (name, value, info) => {
      if (info.valueTruncated) {
        fail(new UserFacingError(`The ${name} field is too long.`, 413));
        return;
      }
      fields[name] = value;
    });

    busboy.on('file', (field, stream, info) => {
      const policy = options.files[field];
      const filename = info.filename ?? '';
      // A part this form does not take, or a file input left empty.
      if (failure || !policy || !filename) {
        stream.resume();
        return;
      }
      counts[field] = (counts[field] ?? 0) + 1;
      const refusal =
        options.checkFieldsBeforeFile?.(fields)
        ?? (counts[field] > policy.maxCount ? policy.tooMany(counts[field]) : null)
        ?? policy.check(filename, info.mimeType);
      if (refusal) {
        stream.resume();
        fail(new UserFacingError(refusal, 400));
        return;
      }

      const savedName = options.safeName(filename);
      const target = path.join(options.dir, savedName);
      const record: ReceivedFile = { field, filename, savedName, bytes: 0 };
      // Listed now, so the result keeps the order the client sent the files in.
      files.push(record);
      open.add(stream);
      const chunks: Buffer[] = [];
      const inspector = policy.inspect?.(filename);
      const tooLarge = () => new UserFacingError(policy.tooLarge(filename), 413);
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          record.bytes += chunk.length;
          totalBytes += chunk.length;
          const over = record.bytes > policy.maxBytes
            ? tooLarge()
            : options.maxTotalBytes !== undefined && totalBytes > options.maxTotalBytes
              ? new UserFacingError(options.tooLargeTotal ?? 'The upload is too large.', 413)
              : null;
          if (over) {
            // Stop the body now: a destroyed part is still drained by busboy to
            // its end, so waiting for the pipeline to reject read the whole file.
            fail(over);
            callback(over);
            return;
          }
          if (policy.keepContent) chunks.push(chunk);
          try {
            inspector?.push(chunk);
          } catch (error) {
            fail(error as Error);
            callback(error as Error);
            return;
          }
          callback(null, chunk);
        },
      });
      // busboy truncates at its own limit and says so here.
      stream.on('limit', () => {
        const error = tooLarge();
        fail(error);
        counter.destroy(error);
      });

      const write = pipeline(stream, counter, createWriteStream(target, { flags: 'wx' }))
        .then(async () => {
          open.delete(stream);
          if (inspector) record.inspection = inspector.finish(record.bytes);
          // An empty file is no file, as formData()'s size 0 was.
          if (record.bytes === 0) await unlink(target).catch(() => undefined);
          else if (policy.keepContent) record.content = Buffer.concat(chunks);
        })
        .catch((error: Error) => {
          open.delete(stream);
          stream.resume();
          fail(error);
        });
      writes.push(write);
    });

    busboy.on('error', () => fail(new UserFacingError('The upload could not be read. Please try again.', 400)));
    busboy.on('close', () => {
      Promise.all(writes).then(() => {
        if (failure) return;
        resolve({ fields, files: files.filter((f) => f.bytes > 0) });
      });
    });

    body.on('error', (error) => fail(failure ?? error));
    body.pipe(busboy);
  });
}
