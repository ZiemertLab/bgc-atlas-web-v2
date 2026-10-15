import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Empty PostCSS so vitest doesn't load the app's Tailwind config.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    css: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
