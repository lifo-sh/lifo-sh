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
				'@lifo-sh/ui',
			],
			output: {
				// Preserve console logs in output
				compact: false,
				// Don't use any minification that drops console
				generatedCode: {
					constBindings: true,
				},
			},
		},
		minify: false, // Disable minification to preserve console logs
	},
	worker: {
		format: 'es',
	},
	esbuild: {
		drop: [], // Don't drop console or debugger statements
	},
	test: {
		globals: true,
		environment: 'node',
	},
});
