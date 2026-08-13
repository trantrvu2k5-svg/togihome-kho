import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { doiTenIndex } from './ops/vite_doi_ten.mjs'

// Build ĐỘC LẬP app THIẾT KẾ — chỉ thietke.html, ra dist-thietke → project togihome-thietke.
//   KHÔNG copy public/ (tự chứa: thietke.html + bundle). Plugin doiTenIndex đổi thietke.html → index.html sau build.
export default defineConfig({
  publicDir: false,
  plugins: [doiTenIndex('thietke.html')],
  build: {
    outDir: 'dist-thietke',
    emptyOutDir: true,
    rollupOptions: {
      input: { thietke: fileURLToPath(new URL('./thietke.html', import.meta.url)) },
    },
  },
})
