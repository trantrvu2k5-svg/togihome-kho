import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Build ĐỘC LẬP app XƯỞNG — chỉ xuong.html, ra dist-xuong → project togihome-xuong.
//   KHÔNG có index.html/main.js (app kho). xuong.html đổi tên thành index.html sau build (root domain xưởng).
//   PROTOTYPE hiện TĨNH (số giả, chưa gọi DB). Nối Supabase + đăng nhập = BƯỚC 4 (sau khi CEO duyệt bố cục).
export default defineConfig({
  // App xưởng TỰ CHỨA (chỉ xuong.html + bundle) — KHÔNG copy public/ (tránh kéo bundle app khác + ảnh vào dist-xuong).
  publicDir: false,
  build: {
    outDir: 'dist-xuong',
    emptyOutDir: true,
    rollupOptions: {
      input: { xuong: fileURLToPath(new URL('./xuong.html', import.meta.url)) },
    },
  },
})
