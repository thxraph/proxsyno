// Human-friendly formatting helpers.

export function formatBytes(bytes: number | undefined | null, decimals = 1): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export function formatBytesFromKb(kb: number | undefined | null, decimals = 1): string {
  if (kb === undefined || kb === null) return '—';
  return formatBytes(kb * 1024, decimals);
}

// bytes-per-second to a readable rate
export function formatBitrate(bps: number | undefined | null): string {
  if (bps === undefined || bps === null || Number.isNaN(bps)) return '—';
  return `${formatBytes(bps, 1)}/s`;
}

export function formatUptime(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export function formatDate(ms: number | undefined | null): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

export function formatPercent(value: number | undefined | null, decimals = 0): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

// Tiny classname combiner (avoids a clsx dependency).
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
