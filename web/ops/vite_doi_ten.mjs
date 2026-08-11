import { renameSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Plugin Vite: SAU build, đổi <tenHtml> trong outDir thành index.html.
//   Vì sao: Cloudflare Pages phục vụ root "/" = index.html. Build đa-trang đặt tên file .html theo
//   KEY input (sale/taichinh/xuong) nên ra sale.html… → root 404 nếu không đổi tên. Trước đây phải
//   `mv` tay sau mỗi build (bẫy im lặng). Plugin này chạy trong closeBundle → tự động, không thao tác tay.
//   Chỉ áp lúc build (apply:'build'); dev không đụng. Idempotent: thiếu file thì cảnh báo, không ném.
export function doiTenIndex(tenHtml) {
  let root, outDir
  return {
    name: 'togi-doi-ten-index',
    apply: 'build',
    configResolved(cfg) { root = cfg.root; outDir = cfg.build.outDir },
    closeBundle() {
      const dir = resolve(root, outDir)
      const from = resolve(dir, tenHtml), to = resolve(dir, 'index.html')
      if (existsSync(from)) { renameSync(from, to); console.log(`✔ ${outDir}: ${tenHtml} → index.html`) }
      else if (!existsSync(to)) console.warn(`⚠ ${outDir}: không thấy ${tenHtml} để đổi tên`)
    }
  }
}
