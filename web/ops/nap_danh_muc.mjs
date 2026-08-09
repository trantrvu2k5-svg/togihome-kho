// Nạp dữ liệu mặc định 5 danh mục từ HẰNG trong web/public/togihome_sale.html vào schema kho.
//   Idempotent: ON CONFLICT DO UPDATE -> chạy lại KHÔNG nhân dòng.
//   KHÔNG nạp khách (bảng khach để RỖNG — dữ liệu khách trong file là bịa).
//   node ops/nap_danh_muc.mjs
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'

const SRC = new URL('../public/togihome_sale.html', import.meta.url).pathname
const html = readFileSync(SRC, 'utf8')

// Trích 1 hằng `const NAME = <literal>` bằng cách cân ngoặc, bỏ qua chuỗi.
function layHang(ten) {
  const m = html.indexOf('const ' + ten + ' =')
  if (m < 0) throw new Error('Không thấy hằng ' + ten)
  let i = html.indexOf('[', m); if (i < 0) i = html.indexOf('{', m)
  const open = html[i], close = open === '[' ? ']' : '}'
  let depth = 0, s = i, str = null, esc = false
  for (; i < html.length; i++) {
    const ch = html[i]
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === str) str = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue }
    if (ch === open) depth++
    else if (ch === close) { depth--; if (depth === 0) { i++; break } }
  }
  return new Function('return (' + html.slice(s, i) + ')')()
}

const BRAND0 = layHang('BRAND0'), SP0 = layHang('SP0'), MAU0 = layHang('MAU0'),
      VC0 = layHang('VC0'), VL0 = layHang('VL0')
const nz = v => (v === undefined || v === '' ? null : v)

const c = new pg.Client(await docConfig()); await c.connect()
try {
  await c.query('begin')
  for (const b of BRAND0)
    await c.query(`insert into kho.thuong_hieu(ma,ten,domain,nguoi_ads) values($1,$2,$3,$4)
       on conflict(ma) do update set ten=excluded.ten,domain=excluded.domain,nguoi_ads=excluded.nguoi_ads`,
      [b.c, b.n, nz(b.dom), nz(b.nguoiId)])
  for (const s of SP0)
    await c.query(`insert into kho.san_pham_mau(ma,ten,kich_thuoc,vat_lieu,file_tk,to_hop,cnc,gia_von) values($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict(ma) do update set ten=excluded.ten,kich_thuoc=excluded.kich_thuoc,vat_lieu=excluded.vat_lieu,file_tk=excluded.file_tk,to_hop=excluded.to_hop,cnc=excluded.cnc,gia_von=excluded.gia_von`,
      [s.ma, s.ten, nz(s.kt), nz(s.vl), nz(s.fileTK), s.toHop ?? null, s.cnc ?? null, s.giaVon ?? null])
  for (const m of MAU0)
    await c.query(`insert into kho.mau_sac(ma,ten,hex) values($1,$2,$3)
       on conflict(ma) do update set ten=excluded.ten,hex=excluded.hex`, [m.c, m.n, nz(m.hex)])
  for (const v of VC0)
    await c.query(`insert into kho.don_vi_van_chuyen(ten) values($1) on conflict(ten) do nothing`, [v])
  for (const v of VL0)
    await c.query(`insert into kho.vat_lieu_ban(ma,ten,tho) values($1,$2,$3)
       on conflict(ma) do update set ten=excluded.ten,tho=excluded.tho`, [v.c, v.n, nz(v.tho)])
  await c.query('commit')

  console.log('=== ĐÃ NẠP (số dòng mỗi bảng) ===')
  for (const t of ['thuong_hieu','san_pham_mau','mau_sac','don_vi_van_chuyen','vat_lieu_ban','khach']) {
    const n = (await c.query(`select count(*)::int n from kho.${t}`)).rows[0].n
    console.log(`  kho.${t}: ${n}` + (t === 'khach' ? ' (để RỖNG — không nạp khách bịa)' : ''))
  }
} catch (e) { await c.query('rollback'); console.error('❌', e.message); process.exit(2) }
finally { await c.end() }
