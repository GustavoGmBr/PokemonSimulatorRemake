import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://127.0.0.1:${process.env.API_PORT ?? 34600}`;

export default defineConfig({
  plugins: [react()],
  // /assets/ é a rota das sprites no servidor; os arquivos da interface vão para outra pasta
  build: { assetsDir: 'static' },
  server: {
    host: '127.0.0.1',
    port: 35300,
    proxy: {
      '/api': api,
      '/assets': api,
    },
  },
});
