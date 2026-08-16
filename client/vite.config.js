import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * This project is self-contained: Vite reads client/.env, and nothing here
 * reaches outside the client folder.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  const required = ['VITE_API_BASE_URL'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(
      `\nLAMS client cannot start: missing environment variable(s): ${missing.join(', ')}.\n` +
        'Copy .env.example to .env inside the client folder and set them.\n'
    );
  }

  const port = Number(env.VITE_DEV_PORT || 5173);

  return {
    plugins: [react()],
    server: { port, strictPort: true },
    preview: { port },
    build: { outDir: 'dist', sourcemap: mode !== 'production' },
  };
});
