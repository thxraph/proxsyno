import type { ApiErrorBody } from '../lib/types';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const BASE = '/api';

function redirectToLogin() {
  if (window.location.pathname !== '/login') {
    // Preserve where the user was trying to go.
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'unknown';
  let message = res.statusText || 'Request failed';
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body && body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    // non-JSON error body; keep defaults
  }
  return new ApiError(res.status, code, message);
}

interface RequestOptions {
  // When true, a 401 will NOT trigger a redirect (used by the auth/me probe).
  noAuthRedirect?: boolean;
  signal?: AbortSignal;
}

async function handle<T>(res: Response, opts: RequestOptions): Promise<T> {
  if (res.status === 401 && !opts.noAuthRedirect) {
    redirectToLogin();
    throw new ApiError(401, 'unauthorized', 'Session expired');
  }
  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return (await res.json()) as T;
  }
  // Caller expected JSON but server returned something else.
  return undefined as T;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: {},
    signal: opts.signal,
  };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  return handle<T>(res, opts);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PUT', path, body, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),

  // Multipart upload (used by Files page). Browser sets the boundary header.
  upload: async (path: string, files: File[], opts: RequestOptions = {}): Promise<void> => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
      signal: opts.signal,
    });
    await handle<void>(res, opts);
  },

  // Returns an absolute URL for streaming downloads (used in <a href>).
  downloadUrl: (filePath: string): string =>
    `${BASE}/files/download?path=${encodeURIComponent(filePath)}`,
};

export type { RequestOptions };
