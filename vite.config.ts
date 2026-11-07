import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  root: path.resolve('src/renderer'),
  base: './',
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
  build: { outDir: path.resolve('dist/renderer'), emptyOutDir: true },
})
