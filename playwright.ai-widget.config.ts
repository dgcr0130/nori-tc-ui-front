import { defineConfig } from '@playwright/test'

// 이 시험은 실제 dist와 CSP를 제공하는 자체 서버를 소유하므로 Vite를 기동하지 않는다.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'ai-widget.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: './test-results/ai-widget',
  use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
