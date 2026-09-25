import { defineConfig } from '@playwright/test';

const PORT = 4399;
export default defineConfig({
  testDir: 'tests',
  globalSetup: './tests/global-setup.ts',
  testIgnore: ['**/global-setup.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1280, height: 820 } },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `node -e "require('fs').rmSync('test-data',{recursive:true,force:true})" && node dist/server/index.js`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: './test-data',
      ADMIN_EMAIL: 'owner@test.local',
      ADMIN_NAME: 'Olivia Owner',
      ADMIN_PASSWORD: 'owner-password-123',
      PUBLIC_URL: '',
      // Tests never send real email: codes stay readable in the Super Admin email log.
      RESEND_API_KEY: '',
      SMTP_URL: '',
      // Compress test videos from 1 MB up, so the real ffmpeg path runs in tests.
      COMPRESS_VIDEO_MB: '1',
      // Many tests run from one address: keep the general write limit out of their way.
      API_WRITES_PER_MIN: '100000',
      RATE_LIMIT_SCALE: '1000',
      // Continue with Google against the stand-in provider in tests/oauth.spec.ts.
      GOOGLE_CLIENT_ID: 'test-client',
      GOOGLE_CLIENT_SECRET: 'test-secret',
      JHINO_OAUTH_TEST_BASE: 'http://127.0.0.1:4398',
      BOOKING_TICK_MS: '1500',
    },
  },
});
