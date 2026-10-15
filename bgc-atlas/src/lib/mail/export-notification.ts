import { buildMailTransport } from '@/lib/mail/transport';
import { RETENTION_DAYS } from '@/lib/export/export-dir';

// Plain text, to the reader only, and nothing internal.

export const exportJobUrl = (exportJobId: string) =>
  `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/exports/${exportJobId}`;

interface ExportEmail {
  to: string;
  exportJobId: string;
  /** What was exported, as a reader would name it: "GCF-000042", "your search results". */
  what: string;
}

const SIGNATURE = '\n-- \nBGC Atlas';

const send = async (to: string, subject: string, text: string): Promise<void> => {
  const mail = buildMailTransport();
  if (!mail) return;
  await mail.transporter.sendMail({ from: mail.from, to, subject, text });
};

export function exportReadyText(
  { exportJobId, what }: Omit<ExportEmail, 'to'>,
  /** Regions the export covered, including the missing ones. */
  regions: number,
  missingFiles: number,
): string {
  const packaged = Math.max(0, regions - missingFiles);
  const missing = missingFiles > 0
    ? `${missingFiles.toLocaleString('en-US')} more could not be included.\n`
    : '';
  return `Your export of ${what} is ready: ${packaged.toLocaleString('en-US')} regions.\n${missing}\n`
    + `${exportJobUrl(exportJobId)}\n\n`
    + `The file is kept for ${RETENTION_DAYS} days.\n${SIGNATURE}`;
}

export function exportFailedText({ exportJobId, what }: Omit<ExportEmail, 'to'>): string {
  return `Your export of ${what} could not be completed.\n\n`
    + `${exportJobUrl(exportJobId)}\n${SIGNATURE}`;
}

export async function sendExportReadyEmail(
  email: ExportEmail,
  regions: number,
  missingFiles: number,
): Promise<void> {
  await send(email.to, 'Your BGC Atlas export is ready', exportReadyText(email, regions, missingFiles));
}

export async function sendExportFailedEmail(email: ExportEmail): Promise<void> {
  await send(email.to, 'Your BGC Atlas export failed', exportFailedText(email));
}
