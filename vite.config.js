import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { createApi } from './server/api.js';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, root, '');
  const api = createApi({ directory: fileURLToPath(new URL('./data/', import.meta.url)), key: env.MESHY_API_KEY || process.env.MESHY_API_KEY });
  return {
    plugins: [react(), { name: 'local-model-api', configureServer(server) { server.middlewares.use(api); }, configurePreviewServer(server) { server.middlewares.use(api); } }],
    server: { host: '127.0.0.1' }, preview: { host: '127.0.0.1' },
  };
});
