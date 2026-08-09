import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Hai trang: index.html (app kho, KHÔNG đụng) + sale.html (app lên đơn, bọc Supabase).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        kho:  fileURLToPath(new URL('./index.html', import.meta.url)),
        sale: fileURLToPath(new URL('./sale.html', import.meta.url)),
      },
    },
  },
})
