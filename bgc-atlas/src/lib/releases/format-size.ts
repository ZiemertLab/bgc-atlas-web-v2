/**
 * A release file's size as /downloads shows it: binary units labelled GB, as that
 * page always has (the 180 GB archive is 167.9 of these). Shared so the download
 * limit's 429 quotes the same figure the page does.
 */
export function formatReleaseSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return i === 0 ? `${value} B` : `${value.toFixed(1)} ${units[i]}`;
}
