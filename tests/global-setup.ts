import { request } from '@playwright/test';

/** The tests upload photos, videos and files into apps, so turn uploads on (a fresh install starts with links only). */
export default async function globalSetup() {
  const api = await request.newContext({ baseURL: 'http://127.0.0.1:4399', extraHTTPHeaders: { 'x-jhino': '1' } });
  await api.post('/api/auth/login', { data: { email: 'owner@test.local', password: 'owner-password-123' } });
  const csrf = (await (await api.get('/api/me')).json()).csrf;
  const r = await api.put('/api/admin/settings', { data: { uploads: true }, headers: { 'x-csrf-token': csrf } });
  if (!r.ok()) throw new Error(`Could not turn uploads on for the tests: ${r.status()} ${await r.text()}`);
  await api.dispose();
}
