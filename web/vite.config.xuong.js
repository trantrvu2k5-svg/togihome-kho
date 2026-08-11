import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { doiTenIndex } from './ops/vite_doi_ten.mjs'

// Build ĐỘC LẬP app XƯỞNG — chỉ xuong.html, ra dist-xuong → project togihome-xuong.
//   KHÔNG có index.html/main.js (app kho). Plugin doiTenIndex tự đổi xuong.html → index.html sau build
//   (root domain xưởng) — KHÔNG còn phải mv tay.
export default defineConfig({
  // App xưởng TỰ CHỨA (chỉ xuong.html + bundle) — KHÔNG copy public/ (tránh kéo bundle app khác + ảnh vào dist-xuong).
  publicDir: false,
  plugins: [doiTenIndex('xuong.html')],
  build: {
    outDir: 'dist-xuong',
    emptyOutDir: true,
    rollupOptions: {
      input: { xuong: fileURLToPath(new URL('./xuong.html', import.meta.url)) },
    },
  },
})
