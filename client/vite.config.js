import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** One .env at the repository root serves the server, the client and migrations. */
const envDir = path.resolve(__dirname, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  const required = ['CLIENT_URL', 'VITE_API_BASE_URL', 'VITE_APP_NAME'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(
      `\nLAMS client cannot start: missing environment variable(s): ${missing.join(', ')}.\n` +
        'Copy .env.example to .env at the repository root and set them.\n' +
        'No default is applied for these settings by design.\n'
    );
  }

  const clientUrl = new URL(env.CLIENT_URL);

  return {
    plugins: [react()],
    envDir,
    server: {
      host: clientUrl.hostname === 'localhost' ? true : clientUrl.hostname,
      port: Number(clientUrl.port || 5173),
      strictPort: true,
    },
    preview: { port: Number(clientUrl.port || 5173) },
    build: { outDir: 'dist', sourcemap: mode !== 'production' },
  };
});
