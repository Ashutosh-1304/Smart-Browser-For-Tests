import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite serves the React renderer. base:'./' keeps asset paths relative so the
// production build also works when Electron loads it via file://.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
