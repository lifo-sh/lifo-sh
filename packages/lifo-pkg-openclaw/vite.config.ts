import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    dts({ tsconfigPath: './tsconfig.build.json' }),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        '@lifo-sh/core',
      ],
    },
  },
  resolve: {
    alias: {
      // In tests, resolve @lifo-sh/core from source to avoid @lifo-sh/ui dist issue
      '@lifo-sh/core': resolve(__dirname, '../core/src/index.ts'),
      // Stub @lifo-sh/ui since it's browser-only and dynamically imported
      '@lifo-sh/ui': resolve(__dirname, 'tests/__mocks__/@lifo-sh/ui.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
