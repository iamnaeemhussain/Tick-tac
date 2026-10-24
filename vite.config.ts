import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend build for Tick-Tac Arena.
// - `vite build` outputs to ./dist which the Cloudflare Worker serves as
//   edge-cached static assets (see wrangler.jsonc).
// - `vite dev` (optional HMR workflow) proxies /api — including WebSockets —
//   to `wrangler dev` running on port 8787.
export default defineConfig({
	plugins: [react()],
	build: {
		target: 'es2022',
		outDir: 'dist',
		assetsDir: 'assets',
		sourcemap: false,
		modulePreload: { polyfill: false },
	},
	server: {
		port: 5173,
		proxy: {
			'/api': {
				target: 'http://127.0.0.1:8787',
				ws: true,
				changeOrigin: false,
			},
		},
	},
});
