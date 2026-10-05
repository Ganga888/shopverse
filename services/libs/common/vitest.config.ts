import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      // Thin adapters around live infrastructure (process bootstrap, OTel SDK, pg/ioredis factories) are
      // exercised by the compose end-to-end run rather than unit tests.
      exclude: ['src/index.ts', 'src/server.ts', 'src/tracing.ts', 'src/db.ts', 'src/redis.ts'],
    },
  },
});
