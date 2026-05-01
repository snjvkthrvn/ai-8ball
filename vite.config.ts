import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf('node_modules/three') >= 0) {
            return 'three';
          }

          if (id.indexOf('node_modules/react') >= 0 || id.indexOf('node_modules/react-dom') >= 0) {
            return 'react-vendor';
          }
        },
      },
    },
  },
});
