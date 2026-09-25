import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './auth.js';

/*
 * Jhino Mini App Spec v1 manifest: declares the record collections an app uses.
 * It can only restrict (types, required, protected fields, "own" visibility);
 * it never grants a person more than their role allows.
 */
export const FIELD_TYPES = ['text', 'longtext', 'number', 'money', 'boolean', 'date', 'datetime', 'time', 'select', 'url', 'email', 'phone', 'user', 'file', 'files', 'json'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export interface FieldDef { type: FieldType; required?: boolean; maxLength?: number; options?: string[]; protected?: boolean; min?: number; max?: number; default?: unknown }
export interface CollectionDef { fields: Record<string, FieldDef>; visibility?: 'all' | 'own'; title?: string; create?: 'all' | 'editors' }
export interface Manifest {
  specVersion: 1; name?: string; version?: string; sdkVersion?: number;
  capabilities?: string[]; collections?: Record<string, CollectionDef>;
}

const CAPABILITIES = ['data', 'realtime', 'files', 'kv'];
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const bad = (msg: string) => new HttpError(400, 'INVALID_MANIFEST', msg);

export function validateManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('The manifest must be a JSON object.');
  const m = raw as Record<string, any>;
  if (m.specVersion !== 1) throw bad('This app needs Jhino Mini App Spec version 1 ("specVersion": 1).');
  if (m.sdkVersion !== undefined && m.sdkVersion !== 1) throw bad(`This app asks for SDK version ${m.sdkVersion}; this Jhino supports version 1.`);
  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities)) throw bad('"capabilities" must be a list.');
    const unknown = m.capabilities.filter((c: unknown) => !CAPABILITIES.includes(String(c)));
    if (unknown.length) throw bad(`This package requests an unsupported capability: ${unknown.join(', ')}.`);
  }
  const collections: Record<string, CollectionDef> = {};
  if (m.collections !== undefined) {
    if (!m.collections || typeof m.collections !== 'object' || Array.isArray(m.collections)) throw bad('"collections" must be an object.');
    const names = Object.keys(m.collections);
    if (names.length > 100) throw bad('Too many collections (limit 100).');
    for (const name of names) {
      if (!NAME.test(name)) throw bad(`Collection name "${name}" can only use letters, numbers, - and _.`);
      const c = m.collections[name];
      if (!c || typeof c.fields !== 'object' || Array.isArray(c.fields)) throw bad(`Collection "${name}" needs a "fields" object.`);
      if (c.visibility !== undefined && c.visibility !== 'all' && c.visibility !== 'own') throw bad(`Collection "${name}": visibility must be "all" or "own".`);
      const fields: Record<string, FieldDef> = {};
      const fieldNames = Object.keys(c.fields);
      if (fieldNames.length > 80) throw bad(`Collection "${name}" has too many fields (limit 80).`);
      for (const fname of fieldNames) {
        if (!NAME.test(fname)) throw bad(`Field name "${fname}" in "${name}" can only use letters, numbers, - and _.`);
        const f = c.fields[fname];
        if (!f || !FIELD_TYPES.includes(f.type)) throw bad(`Field "${name}.${fname}" has an unknown type "${f?.type}". Use one of: ${FIELD_TYPES.join(', ')}.`);
        if (f.type === 'select' && (!Array.isArray(f.options) || !f.options.length || f.options.some((o: unknown) => typeof o !== 'string'))) {
          throw bad(`Field "${name}.${fname}" is a select and needs a list of text "options".`);
        }
        fields[fname] = {
          type: f.type, required: !!f.required, protected: !!f.protected,
          maxLength: typeof f.maxLength === 'number' ? Math.min(f.maxLength, 200_000) : undefined,
          options: f.type === 'select' ? f.options.map(String) : undefined,
          min: typeof f.min === 'number' ? f.min : undefined, max: typeof f.max === 'number' ? f.max : undefined,
          default: f.default,
        };
      }
      collections[name] = { fields, visibility: c.visibility === 'own' ? 'own' : 'all', create: c.create === 'editors' ? 'editors' : 'all', title: typeof c.title === 'string' ? c.title.slice(0, 80) : undefined };
    }
  }
  return {
    specVersion: 1, name: typeof m.name === 'string' ? m.name.slice(0, 80) : undefined,
    version: typeof m.version === 'string' ? m.version.slice(0, 40) : undefined, sdkVersion: 1,
    capabilities: m.capabilities, collections: Object.keys(collections).length ? collections : undefined,
  };
}

/** Read the embedded manifest and/or jhino.json. If both exist they must match. */
export function extractManifest(root: string, entryHtml: string): Manifest | null {
  let embedded: unknown;
  const tag = entryHtml.match(/<script[^>]{0,300}id=["']jhino-manifest["'][^>]{0,300}>([\s\S]{0,1000000}?)<\/script>/i);
  if (tag) {
    try { embedded = JSON.parse(tag[1]); } catch { throw bad('The embedded jhino-manifest is not valid JSON.'); }
  }
  let external: unknown;
  const file = path.join(root, 'jhino.json');
  if (fs.existsSync(file)) {
    try { external = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw bad('jhino.json is not valid JSON.'); }
  }
  if (embedded !== undefined && external !== undefined && JSON.stringify(canonical(embedded)) !== JSON.stringify(canonical(external))) {
    throw bad('The manifest inside index.html and jhino.json are different. Keep one, or make them identical.');
  }
  const raw = embedded ?? external;
  return raw === undefined ? null : validateManifest(raw);
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as any)[k])]));
  return v;
}

/* ---------------- record validation ---------------- */
export interface ValidateContext {
  isCreate: boolean;
  canProtected: boolean;
  isMember: (userId: string) => boolean;
  isFile: (fileId: string) => boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export function validateRecord(def: CollectionDef, next: Record<string, unknown>, prev: Record<string, unknown> | null, ctx: ValidateContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    if (!(key in def.fields)) throw new HttpError(400, 'VALIDATION_FAILED', `Unknown field "${key}".`, { field: key });
  }
  for (const [key, f] of Object.entries(def.fields)) {
    let v = next[key];
    const before = prev ? prev[key] : undefined;
    if (f.protected && !ctx.canProtected) {
      const changed = JSON.stringify(v ?? null) !== JSON.stringify(ctx.isCreate ? (f.default ?? null) : (before ?? null));
      if (v !== undefined && changed) throw new HttpError(403, 'FORBIDDEN', `Only people who can edit can change "${key}".`, { field: key });
      v = ctx.isCreate ? f.default : before;
    }
    if (v === undefined || v === null || v === '') {
      if (v === undefined && ctx.isCreate && f.default !== undefined) v = f.default;
      if ((v === undefined || v === null || v === '') && f.required) throw new HttpError(400, 'VALIDATION_FAILED', `"${key}" is required.`, { field: key });
      if (v === undefined) continue;
      if (v === null || v === '') { out[key] = v; continue; }
    }
    out[key] = checkValue(key, f, v, ctx);
  }
  return out;
}

function fail(key: string, msg: string): never {
  throw new HttpError(400, 'VALIDATION_FAILED', `"${key}" ${msg}`, { field: key });
}

function checkValue(key: string, f: FieldDef, v: unknown, ctx: ValidateContext): unknown {
  switch (f.type) {
    case 'text': case 'longtext': case 'url': case 'email': case 'phone': {
      if (typeof v !== 'string') fail(key, 'must be text.');
      const max = f.maxLength ?? (f.type === 'longtext' ? 100_000 : 2000);
      if ((v as string).length > max) fail(key, `can be at most ${max} characters.`);
      if (f.type === 'url' && !/^(https?:\/\/|mailto:|tel:)/i.test(v as string)) fail(key, 'must start with http:// or https://.');
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+$/.test(v as string)) fail(key, 'must be an email address.');
      return v;
    }
    case 'number': case 'money': {
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(key, 'must be a number.');
      if (f.type === 'money' && !Number.isInteger(v)) fail(key, 'must be a whole number of the smallest unit (for example paisa or cents).');
      if (f.min !== undefined && (v as number) < f.min) fail(key, `must be at least ${f.min}.`);
      if (f.max !== undefined && (v as number) > f.max) fail(key, `must be at most ${f.max}.`);
      return v;
    }
    case 'boolean': if (typeof v !== 'boolean') fail(key, 'must be true or false.'); return v;
    case 'date': if (typeof v !== 'string' || !DATE.test(v)) fail(key, 'must be a date like 2026-09-24.'); return v;
    case 'time': if (typeof v !== 'string' || !TIME.test(v)) fail(key, 'must be a time like 14:30.'); return v;
    case 'datetime': if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) fail(key, 'must be a date and time.'); return new Date(v as string).toISOString();
    case 'select': if (typeof v !== 'string' || !f.options!.includes(v)) fail(key, `must be one of: ${f.options!.join(', ')}.`); return v;
    case 'user': if (typeof v !== 'string' || !ctx.isMember(v)) fail(key, 'must be a person who has access to this app.'); return v;
    case 'file': if (typeof v !== 'string' || !ctx.isFile(v)) fail(key, 'must be a file uploaded to this app.'); return v;
    case 'files': {
      if (!Array.isArray(v) || v.length > 100 || v.some((x) => typeof x !== 'string' || !ctx.isFile(x))) fail(key, 'must be a list of files uploaded to this app.');
      return v;
    }
    case 'json': {
      const s = JSON.stringify(v);
      if (s.length > 200_000) fail(key, 'is too large.');
      return v;
    }
  }
}
