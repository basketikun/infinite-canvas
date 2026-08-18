// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const distributionDefines = {
  __BLOCKOUT_APP_ID__: JSON.stringify(
    process.env.BLOCKOUT_APP_ID || 'com.wassermanproductions.blockout'
  ),
  __BLOCKOUT_WINDOWS_CONFIG_NAMESPACE__: JSON.stringify(
    process.env.BLOCKOUT_WINDOWS_CONFIG_NAMESPACE || 'blockout'
  ),
  __BLOCKOUT_MAINTAINER_CREDIT__: JSON.stringify(
    process.env.BLOCKOUT_MAINTAINER_CREDIT || ''
  )
}

export default defineConfig({
  main: {
    define: distributionDefines,
    build: {
      outDir: 'out/main',
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    define: distributionDefines,
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@engine': resolve(__dirname, 'src/engine'),
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
