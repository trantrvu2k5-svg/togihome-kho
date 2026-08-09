import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Build ĐỘC LẬP app TÀI CHÍNH — chỉ taichinh.html, ra dist-taichinh. KHÔNG có index.html(kho)/sale.
// taichinh.html đổi tên thành index.html sau build (root domain tài chính).
export default defineConfig({
  build: {
    outDir: 'dist-taichinh',
    emptyOutDir: true,
    rollupOptions: {
      input: { taichinh: fileURLToPath(new URL('./taichinh.html', import.meta.url)) },
    },
  },
})
