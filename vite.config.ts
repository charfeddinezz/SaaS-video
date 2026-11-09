import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/ui/main.tsx',
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    open: true,
    port: 5173,
  },
})