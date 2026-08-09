import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Build ĐỘC LẬP app SALE — chỉ sale.html, ra dist-sale. KHÔNG có index.html/main.js (app kho).
// sale.html sẽ được đổi tên thành index.html sau build (root của domain sale).
export default defineConfig({
  build: {
    outDir: 'dist-sale',
    emptyOutDir: true,
    rollupOptions: {
      input: { sale: fileURLToPath(new URL('./sale.html', import.meta.url)) },
    },
  },
})
