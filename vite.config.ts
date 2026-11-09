import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  publicDir: 'catalog',
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5173,
  },
})