import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://127.0.0.1:${process.env.API_PORT ?? 34600}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 35300,
    proxy: {
      '/api': api,
      '/assets': api,
    },
  },
});
