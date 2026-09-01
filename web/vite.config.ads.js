import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { doiTenIndex } from './ops/vite_doi_ten.mjs'
export default defineConfig({
  publicDir: false,
  plugins: [doiTenIndex('ads.html')],
  build: { outDir: 'dist-ads', emptyOutDir: true,
    rollupOptions: { input: { ads: fileURLToPath(new URL('./ads.html', import.meta.url)) } } },
})
