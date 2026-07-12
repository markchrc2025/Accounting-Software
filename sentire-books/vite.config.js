import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // jsPDF has optional peer deps (canvg, dompurify) not needed for our usage
      external: ['canvg', 'dompurify'],
    },
  },
  optimizeDeps: {
    include: ['jspdf', 'html2canvas'],
  },
});
