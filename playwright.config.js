import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 120000,
  use: { baseURL: 'http://127.0.0.1:8091', headless: true, launchOptions: { executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'node server.js', url: 'http://127.0.0.1:8091/healthz', env: { PORT: '8091', ALLOWED_ORIGINS: 'http://127.0.0.1:8091' }, reuseExistingServer: false },
});
