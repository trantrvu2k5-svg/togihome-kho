import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { doiTenIndex } from './ops/vite_doi_ten.mjs'

// Build ĐỘC LẬP app TÀI CHÍNH — chỉ taichinh.html, ra dist-taichinh. KHÔNG có index.html(kho)/sale.
// Plugin doiTenIndex tự đổi taichinh.html → index.html sau build (root domain tài chính) — KHÔNG còn mv tay.
export default defineConfig({
  plugins: [doiTenIndex('taichinh.html')],
  build: {
    outDir: 'dist-taichinh',
    emptyOutDir: true,
    rollupOptions: {
      input: { taichinh: fileURLToPath(new URL('./taichinh.html', import.meta.url)) },
    },
  },
})
