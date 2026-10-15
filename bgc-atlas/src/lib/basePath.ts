export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(withBase(path), init);
}

// Lets the browser stream the download to disk; a Blob would hold the whole file in memory.
export function downloadFromApi(path: string) {
  const a = document.createElement("a");
  a.href = withBase(path);
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
