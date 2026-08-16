import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'https://robodeal.vercel.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
