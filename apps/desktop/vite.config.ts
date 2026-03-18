import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(({ command }) => ({
	base: command === 'build' ? '/desktop/' : '/',
	server: {
		port: 3001,
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
	},
	preview: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
	},
	resolve: {
		alias: {
			'@lifo-sh/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
		},
	},
}));
