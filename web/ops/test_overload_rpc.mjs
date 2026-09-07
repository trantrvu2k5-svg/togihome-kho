// test_overload_rpc.mjs — CỔNG canh CHỒNG OVERLOAD trong schema kho (D-25 việc 1, ngăn lần thứ TƯ
//   "hai bản một hàm" cắn: atp · neo_xuoi · tao_don). PostgREST chọn overload theo payload → vá nhầm ký
//   KHÔNG báo lỗi, app chạy body cũ. Cổng này ĐỎ khi có hàm >1 chữ ký NGOÀI danh sách miễn trừ viết tay.
// Chạy: node ops/test_overload_rpc.mjs
//
// ⚠ DANH SÁCH MIỄN TRỪ VIẾT TAY (KHÔNG sinh tự động — sinh tự động = đóng băng đúng cái bệnh, họ QD-96).
//   Mỗi mục: BỘ chữ ký ĐẦY ĐỦ mong đợi + LÝ DO. Thêm ký thứ 3 vào hàm đã miễn trừ cũng ĐỎ (bộ ký lệch).
//   Chỉ được thêm mục ở đây khi CÓ LÝ DO overload không thể gộp; mặc định là gộp/drop, không miễn trừ.
const MIEN_TRU = {
  // 1-arg (text) LEGACY: test_061 dựng qt bằng RAW INSERT quy_trinh_buoc (không có quy_trinh_phien_ban) → cần bản
  //   đọc-mọi-phiên-bản để validate. 2-arg (text,int DEFAULT) phiên-bản-aware: qt_luu_buoc/qt_xoa_buoc (db/171,173).
  //   0 rpc caller → PostgREST chưa cắn. Dọn 1-arg khi test_061 chuyển sang qt_luu_buoc (PHÁT SINH D-25).
  kiem_quy_trinh:     ['kho.kiem_quy_trinh(text)', 'kho.kiem_quy_trinh(text,integer)'],
  // 1-arg (text) LEGACY (test_061:77 LOI_TRONG, trả sớm) + 2-arg (text,int DEFAULT) WP-08 phiên-bản-aware (app chưa gọi).
  //   0 rpc caller. Gộp khi có caller thật để "thử thật" (PHÁT SINH D-25).
  quy_trinh_cua_loi:  ['kho.quy_trinh_cua_loi(text)', 'kho.quy_trinh_cua_loi(text,integer)'],
  // 2-arg (uuid,text) test-only (test_042) + 3-arg (uuid,text,uuid) PROD (xuong.js:470, ghi người làm). CẢ HAI
  //   tham số BẮT BUỘC (ndef=0) → PostgREST phân định theo SỐ arg, KHÔNG phải cặp default nguy hiểm. Dọn 2-arg khi
  //   test_042 chuyển sang 3-arg (PHÁT SINH D-25).
  tien_mon:           ['kho.tien_mon(uuid,text)', 'kho.tien_mon(uuid,text,uuid)'],
}

import { docConfig } from './conn.mjs'
import pg from 'pg'

const norm = s => s.replace(/\s+/g, '')   // 'kho.f(uuid, text)' -> 'kho.f(uuid,text)'

async function quetOverload(c) {
  const r = await c.query(`
    select p.proname,
           array_agg(p.oid::regprocedure::text order by p.pronargs) sigs
    from pg_proc p
    where p.pronamespace='kho'::regnamespace and p.prokind='f'
    group by p.proname
    having count(*) > 1`)
  return r.rows  // [{proname, sigs:[...]}]
}

function danhGia(rows) {
  const viPham = []
  for (const { proname, sigs } of rows) {
    const got = sigs.map(norm).sort()
    const exp = (MIEN_TRU[proname] || null)
    if (!exp) { viPham.push(`${proname}: CHỒNG ${sigs.length} ký, KHÔNG trong danh sách miễn trừ → ${sigs.join(' · ')}`); continue }
    const want = exp.map(norm).sort()
    if (got.length !== want.length || got.some((s, i) => s !== want[i]))
      viPham.push(`${proname}: bộ ký LỆCH miễn trừ. có=[${got.join(' · ')}] mong=[${want.join(' · ')}]`)
  }
  return viPham
}

const c = new pg.Client(await docConfig())
await c.connect()

// ── VẾ XANH: hiện trạng phải KHỚP miễn trừ ──
const rows0 = await quetOverload(c)
const vp0 = danhGia(rows0)
console.log(`── hiện trạng: ${rows0.length} hàm >1 chữ ký ──`)
for (const r of rows0) console.log(`   ${r.proname}: ${r.sigs.join(' · ')}`)
console.log(vp0.length ? `✗ VI PHẠM:\n   ${vp0.join('\n   ')}` : `✓ XANH: mọi overload nằm trong danh sách miễn trừ (đúng bộ ký)`)

// ── VẾ ĐỎ (chứng cổng kêu): tạo TẠM một overload thứ hai của current_ns() trong transaction → phải ĐỎ đúng tên ──
await c.query('begin')
await c.query(`create function kho.current_ns(p_gia_dummy int) returns uuid language sql as $$ select kho.current_ns() $$`)
const rowsD = await quetOverload(c)
const vpD = danhGia(rowsD)
const batDuoc = vpD.some(v => v.startsWith('current_ns:'))
await c.query('rollback')   // KHÔNG để lại overload giả
console.log(`\n── vế ĐỎ: thêm tạm kho.current_ns(int) → cổng ${batDuoc ? 'BẮT ĐƯỢC ✓ (' + vpD.find(v=>v.startsWith('current_ns:')) + ')' : 'KHÔNG bắt ✗'}`)

await c.end()
const passXanh = vp0.length === 0
const passDo = batDuoc
console.log(`\n═══ CỔNG OVERLOAD: vế XANH ${passXanh ? 'ĐẠT' : 'ĐỎ (' + vp0.length + ' vi phạm)'} · vế chứng-ĐỎ ${passDo ? 'ĐẠT' : 'HỎNG'} ═══`)
process.exit(passXanh && passDo ? 0 : 1)
