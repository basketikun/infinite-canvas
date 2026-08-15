import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  base: './',
  root: resolve(__dirname, 'src/renderer/web'),
  plugins: [react()],
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist/workbench'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/web/index.html')
    }
  }
})
