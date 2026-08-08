// xuat_quy_doi.mjs — XUẤT các dòng DA_DUYET của kho.quy_doi ra JSON (để sau copy sang plugin).
//   Mỗi mô tả: mã kho mặc định + he_so + GIÁ VỐN đọc động từ kho (KHÔNG lưu trong bảng).
//   Deterministic: sắp theo mo_ta_thiet_ke, dấu thời gian = MAX(tao_luc) trong dữ liệu (không phải
//   giờ máy) -> hai lần xuất liền nhau ra file GIỐNG HỆT từng byte (tiện so bằng git).
//   Dòng nào mã kho chưa có giá vốn: vẫn xuất, gia_von_kho=null + CẢNH BÁO ra màn hình.
//   Ghi ra scratch/ trong repo kho (CHƯA copy sang plugin). In đường dẫn.
//   Chạy: cd web && DB_HOST=... DB_USER=... DB_PASS=... node ops/xuat_quy_doi.mjs
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))                 // web/ops
const OUT = resolve(__dir, '..', '..', 'scratch', 'quy_doi_export.json')  // repo-kho/scratch/

const c = new pg.Client(await docConfig()); await c.connect()
try {
  const rows = (await c.query(
    `select q.mo_ta_thiet_ke, q.ma_plugin, q.ma_kho, q.he_so_quy_doi,
            t.gia_von_bq gia_von_kho,
            to_char(max(q.tao_luc) over (), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') moc
       from kho.quy_doi q
       left join kho.vat_tu v on v.ma = q.ma_kho
       left join kho.ton    t on t.vat_tu_id = v.id
      where q.trang_thai = 'DA_DUYET' and q.la_mac_dinh = true
      order by q.mo_ta_thiet_ke asc`)).rows

  const moc = rows.length ? rows[0].moc : 'khong_co_du_lieu'
  const quy_doi = rows.map(r => ({
    mo_ta_thiet_ke: r.mo_ta_thiet_ke,
    ma_plugin: r.ma_plugin,
    ma_kho: r.ma_kho,
    he_so_quy_doi: Number(r.he_so_quy_doi),
    gia_von_kho: r.gia_von_kho == null ? null : Number(r.gia_von_kho),
  }))
  const doc = { thoi_gian_xuat: moc, so_dong: quy_doi.length, quy_doi }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8')

  const thieu = quy_doi.filter(r => r.gia_von_kho == null)
  console.log(`Xuất ${quy_doi.length} dòng DA_DUYET -> ${OUT}`)
  console.log(`Dấu thời gian (theo dữ liệu): ${moc}`)
  if (thieu.length) {
    console.log(`⚠ CẢNH BÁO: ${thieu.length} dòng mã kho CHƯA CÓ GIÁ VỐN (gia_von_kho=null), kéo sang plugin không dùng được ngay:`)
    thieu.forEach(r => console.log(`   - ${r.mo_ta_thiet_ke} → ${r.ma_kho}`))
  } else {
    console.log('Mọi dòng đều có giá vốn.')
  }
} finally { await c.end() }
process.exit(0)
