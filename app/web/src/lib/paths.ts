// Helpers for paths inside the server's file-browser jail (FILES_ROOT, default /mnt).

export const FILES_ROOT = '/mnt';

export function joinPath(base: string, name: string): string {
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
}

export function parentPath(path: string): string {
  if (path === FILES_ROOT || path === '/') return FILES_ROOT;
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  const parent = idx <= 0 ? '/' : trimmed.slice(0, idx);
  // Never climb above the jail root.
  return parent.length < FILES_ROOT.length ? FILES_ROOT : parent;
}
