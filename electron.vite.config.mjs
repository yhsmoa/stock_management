import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: ['src/main/main.ts', 'src/preload/preload.ts'],
      formats: ['cjs']
    },
    outDir: 'dist-electron',
    emptyOutDir: true,
    rollupOptions: {
      external: ['electron', 'path', 'fs', 'url', 'child_process'],
      output: {
        entryFileNames: '[name].js'
      }
    }
  }
})