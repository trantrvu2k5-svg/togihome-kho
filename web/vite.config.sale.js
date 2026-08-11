import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { doiTenIndex } from './ops/vite_doi_ten.mjs'

// Build ĐỘC LẬP app SALE — chỉ sale.html, ra dist-sale. KHÔNG có index.html/main.js (app kho).
// Plugin doiTenIndex tự đổi sale.html → index.html sau build (root domain sale) — KHÔNG còn mv tay.
export default defineConfig({
  plugins: [doiTenIndex('sale.html')],
  build: {
    outDir: 'dist-sale',
    emptyOutDir: true,
    rollupOptions: {
      input: { sale: fileURLToPath(new URL('./sale.html', import.meta.url)) },
    },
  },
})
