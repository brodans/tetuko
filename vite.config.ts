import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Expose Vercel build flag to client code so automation can be disabled on Vercel deployments.
    'import.meta.env.VITE_VERCEL': JSON.stringify(process.env.VERCEL ? '1' : '0'),
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:14200', changeOrigin: true },
      '/ep': { target: 'http://127.0.0.1:14200', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        /*
         * `return undefined` = "jangan dikumpulkan ke chunk mana pun".
         *
         * Semua paket di daftar itu hanya dibutuhkan setelah pengguna menekan
         * tombolnya: QRIS (`qrcode-generator`) saat tombol QRIS ditekan, PDF
         * (`jspdf`) saat laporan diunduh. Semuanya sudah di-`lazy()` di sisi
         * komponen.
         */
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet')) return 'leaflet';
            if (id.includes('firebase')) return 'firebase';
            if (id.includes('motion')) return 'motion';
            // Ditunggu sampai tombol ditekan — jangan dikumpulkan ke `vendor`.
            if (
              id.includes('qrcode-generator') ||
              id.includes('jspdf') ||
              id.includes('canvg') ||
              id.includes('dompurify') ||
              id.includes('html2canvas') ||
              id.includes('core-js')
            ) {
              return undefined;
            }
            return 'vendor';
          }
          if (id.includes('src/data/')) {
            return 'data';
          }
        }
      }
    }
  }
});
