// Resolve a stored file key to a URL the browser can load.
export function publicUrl(key: string): string {
  if (/^https?:\/\//.test(key)) return key;
  return `/app-storage/${key.replace(/^\/+/, "")}`;
}
