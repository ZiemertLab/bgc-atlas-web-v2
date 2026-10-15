export interface GenbankValidationResult {
  valid: boolean;
  error?: string;
  hasLocus?: boolean;
  hasFeatures?: boolean;
  hasOrigin?: boolean;
  hasAntiSMASH?: boolean;
  detectedType?: 'genbank' | 'unknown';
}

const VALID_GENBANK_EXTENSIONS = ['.gbk', '.genbank', '.gbff', '.gb'];
const MAX_FILENAME_LENGTH = 255;

// BiG-SLiCE query mode keeps a **/*.gbk file only if its extension-stripped basename matches one
// of these; anything else is silently ignored.
const BIGSLICE_NAME_PATTERNS = [
  /^BGC[0-9]{7}$/,        // MIBiG >= 2.0
  /^.+\.cluster[0-9]+$/,  // antiSMASH4 clustergbks
  /^.+\.region[0-9]+$/,   // antiSMASH5 clustergbks
];

// Matches a trailing GenBank extension (case-insensitive), mirroring Python's splitext behavior.
const GENBANK_EXT_RE = /\.(gbk|genbank|gbff|gb)$/i;

export function hasValidGenbankExtension(filename: string): boolean {
  const lowerFilename = filename.toLowerCase();
  return VALID_GENBANK_EXTENSIONS.some(ext => lowerFilename.endsWith(ext));
}

export function sanitizeFilename(filename: string): string {
  // Remove any path components (., .., /, \)
  let sanitized = filename.replace(/^.*[\/\\]/, '');

  sanitized = sanitized.replace(/\s+/g, '_');

  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '');

  // Remove leading dots to prevent hidden files
  sanitized = sanitized.replace(/^\.+/, '');

  if (sanitized.length === 0) {
    sanitized = 'unnamed_file.gbk';
  }

  if (sanitized.length > MAX_FILENAME_LENGTH) {
    const lastDot = sanitized.lastIndexOf('.');
    if (lastDot > 0) {
      const ext = sanitized.substring(lastDot);
      const base = sanitized.substring(0, MAX_FILENAME_LENGTH - ext.length);
      sanitized = base + ext;
    } else {
      sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH);
    }
  }

  return sanitized;
}

export function stripGenbankExtension(filename: string): string {
  return filename.replace(GENBANK_EXT_RE, '');
}

export function isBigSliceRecognizedName(basename: string): boolean {
  return BIGSLICE_NAME_PATTERNS.some((re) => re.test(basename));
}

// Names that don't already match get a `.regionNNN` suffix; the result ends in `.gbk` and is
// unique against `existingFilenames`.
export function toBigSliceQueryFilename(
  sanitizedName: string,
  index: number,
  existingFilenames: Set<string>
): string {
  const base = stripGenbankExtension(sanitizedName) || 'query';
  const regionNum = String(index + 1).padStart(3, '0');

  let candidate = isBigSliceRecognizedName(base)
    ? `${base}.gbk`
    : `${base}.region${regionNum}.gbk`;

  // Guarantee uniqueness while keeping the name pattern-valid: appending another `.regionNNN`
  // segment still matches `^.+\.region[0-9]+$` and keeps the `.gbk` extension.
  let bump = index + 1;
  while (existingFilenames.has(candidate)) {
    bump += 1;
    candidate = `${stripGenbankExtension(candidate)}.region${String(bump).padStart(3, '0')}.gbk`;
  }

  return candidate;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export interface FileCollectionValidationResult {
  valid: boolean;
  error?: string;
  invalidFiles?: string[];
  totalSize?: number;
  fileCount?: number;
}

// Strips NULs (rejected by PostgreSQL) and control characters from external tools' errors before storage.
export function sanitizeErrorMessage(
  errorMessage: string,
  maxLength: number = 5000
): string {
  if (!errorMessage) return '';

  let sanitized = errorMessage;

  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '... (truncated)';
  }

  sanitized = sanitized.replace(/\0/g, '');

  // Control characters except \n, \r, \t.
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  return sanitized;
}
