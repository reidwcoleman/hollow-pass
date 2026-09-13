import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.GH_PAGES ? '/hollow-pass/' : '/',
  build: { chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: 'index.html', car: 'car.html' } } },
});
