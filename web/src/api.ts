export interface User {
  id: string; email: string; name: string; displayName: string | null; isAdmin: boolean; disabled: boolean; canCreate: boolean;
  emailIsAddress: boolean; emailVerified: boolean | null; hasAvatar: boolean; passwordSet: boolean; plan: string;
  /** The name in their addresses: jhino.com/<username> is their page. Null for client accounts. */
  username?: string | null;
  /** What the person's plan includes (null for client accounts). The server checks again on every action. */
  features?: PlanFeatures | null;
}
export interface PlanFeatures { addresses: number; shortLinks: number; customCodes: boolean; passwordLinks: boolean; hideBar: boolean; download: boolean; linkStats: boolean; prioritySupport: boolean; maxUploadMB: number; themeTier: 'free' | 'plus' | 'pro'; branding: 'popup' | 'badge' | 'none'; customPage: boolean; analyticsDays: number }
/** A person's photo, when they have one. `v` busts the cache after a change. */
export const avatarUrl = (u: { id: string; hasAvatar?: boolean } | null | undefined, v: string | number = '') => (u && u.hasAvatar ? `/api/users/${u.id}/avatar${v ? `?v=${v}` : ''}` : null);
export type Role = 'owner' | 'editor' | 'contributor' | 'viewer';
export interface Features { localStorage?: boolean; claudeStorage?: boolean; jhinoSdk?: boolean; indexedDB?: boolean; network?: boolean }
export interface AppSummary {
  id: string; name: string; color: number; ownerId: string; role: Role | null;
  members: { id: string; name: string; role: Role; email?: string }[];
  liveVersion: number; features: Features; privateKeys: string[];
  createdAt: string; updatedAt: string; deletedAt: string | null;
  last: { action: string; at: string; name: string | null } | null;
  built?: boolean;
  brand?: { client: string; field: string; accent: string; logo: boolean; sections: number } | null;
  storage?: { files: number; bytes: number };
  access?: 'private' | 'public' | 'password'; slug?: string | null; rootSlug?: string | null; ownerUsername?: string | null; showBar?: boolean;
}
export interface Version { n: number; fileCount: number; size: number; sourceName: string; createdAt: string; uploadedBy: string; features: Features }
export interface AppDetail extends AppSummary { versions: Version[] }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) { super(message); }
}

let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };

/** Multipart upload with progress (fetch cannot report upload progress). */
export function uploadWithProgress<T = any>(path: string, file: Blob, name: string, onProgress?: (loaded: number, total: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('x-jhino', '1');
    if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded, e.total); };
    xhr.onload = () => {
      let data: any = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data?.error || 'SERVER_ERROR', data?.message || `Upload failed (${xhr.status}).`, data || {}));
    };
    xhr.onerror = () => reject(new ApiError(0, 'CONNECTION_LOST', 'The upload was interrupted. Check your connection and try again.'));
    const fd = new FormData();
    fd.append('file', file, name);
    xhr.send(fd);
  });
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-jhino': '1' };
  if (csrf) headers['x-csrf-token'] = csrf;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', keepalive: method !== 'GET' && !(body instanceof FormData) && (payload?.toString().length ?? 0) < 60000 });
  } catch {
    throw new ApiError(0, 'CONNECTION_LOST', 'Could not reach the Jhino server. Check your connection.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'SERVER_ERROR', data?.message || `Request failed (${res.status}).`, data || {});
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
