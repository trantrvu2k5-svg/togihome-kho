import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { doiTenIndex } from './ops/vite_doi_ten.mjs'
export default defineConfig({
  publicDir: false,
  plugins: [doiTenIndex('sanpham.html')],
  build: { outDir: 'dist-sanpham', emptyOutDir: true,
    rollupOptions: { input: { sanpham: fileURLToPath(new URL('./sanpham.html', import.meta.url)) } } },
})
