import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
        '@xterm/xterm',
        '@xterm/addon-fit',
        '@xterm/addon-webgl',
        '@xterm/xterm/css/xterm.css',
        'isomorphic-git',
      ],
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
