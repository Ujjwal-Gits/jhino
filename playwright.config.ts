import { defineConfig } from '@playwright/test';

const PORT = 4399;
export default defineConfig({
  testDir: 'tests',
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
      // Compress test videos from 1 MB up, so the real ffmpeg path runs in tests.
      COMPRESS_VIDEO_MB: '1',
    },
  },
});
