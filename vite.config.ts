import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // manifold-3d tự nạp file .wasm; không cho Vite gộp sẵn nó.
  optimizeDeps: { exclude: ['manifold-3d'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
