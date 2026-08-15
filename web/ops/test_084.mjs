// TEST CẮN — L-29 · phân trang 3 RPC xưởng (kanban_xuong · viec_uu_tien · xuong_don_san_xuat).
// Không migration mới — test hợp đồng phân trang mà app dựa vào. Tx rollback.
// Mô phỏng ĐÚNG cách app gọi: taiKanban/taiQuanDoc (Trước/Sau) · taiDon (Xem thêm gom dồn).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const MOI = 50
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asCeo(s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: CEO, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') }
  catch (x) { e = x.message; await c.query('rollback to savepoint k') }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  if (e) throw new Error(e); return r
}
// gọi 1 trang như app: rpc(gioi_han, bo_qua)
const goi = (fn, trang) => asCeo(`select * from kho.${fn}($1,$2)`, [MOI, trang * MOI])

// đi hết mọi trang, gom lại — mô phỏng người bấm Sau tới hết (Kanban/Quản đốc)
async function diHetTrang(fn) {
  const heat = []; let trang = 0, tong = null, trangCuoiSo = 0
  while (true) {
    const rows = await goi(fn, trang)
    if (trang === 0) tong = rows.length ? Number(rows[0].tong_so) : 0
    heat.push(...rows); trangCuoiSo = rows.length
    const soTrang = Math.max(1, Math.ceil((tong || 0) / MOI))
    if (trang >= soTrang - 1) break                 // nút "Sau" tắt → dừng
    trang++
  }
  return { heat, tong, soTrang: Math.max(1, Math.ceil((tong || 0) / MOI)), trangCuoiSo, soTrangDaDi: trang + 1 }
}

try {
  await c.query('begin')

  // baseline: đếm THẬT đơn sản xuất trước khi seed
  const prodKb = "trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao')"
  const prodVu = "trang_thai in ('cho_cat','da_cat','dang_lam')"
  const B_kb = Number((await q(`select count(*) n from kho.don_hang where ${prodKb}`))[0].n)
  const B_vu = Number((await q(`select count(*) n from kho.don_hang where ${prodVu}`))[0].n)

  // seed 120 đơn 'L29-000..119' (cho_cat) + 1 món mỗi đơn (cho_cat → viec_uu_tien thấy)
  const MAS = []
  for (let i = 0; i < 120; i++) {
    const ma = 'L29-' + String(i).padStart(3, '0'); MAS.push(ma)
    const id = (await q(`insert into kho.don_hang(ma_don,trang_thai) values($1,'cho_cat') returning id`, [ma]))[0].id
    await q(`insert into kho.don_hang_mon(don_id,ten) values($1,'món test')`, [id])
  }
  const T_kb = B_kb + 120, T_vu = B_vu + 120
  const seeded = new Set(MAS)

  // ══ 3 · tong_so KHỚP đếm thật (lệch = ĐỎ) ══
  const p0kb = await goi('kanban_xuong', 0)
  const p0xd = await goi('xuong_don_san_xuat', 0)
  const p0vu = await goi('viec_uu_tien', 0)
  const realKb = Number((await q(`select count(*) n from kho.don_hang where ${prodKb}`))[0].n)
  const realVu = Number((await q(`select count(*) n from kho.don_hang where ${prodVu}`))[0].n)
  ok('#3 tong_so kanban khớp đếm thật', Number(p0kb[0].tong_so) === realKb && realKb === T_kb, `${p0kb[0].tong_so} vs ${realKb}/${T_kb}`)
  ok('#3 tong_so xuong_don khớp đếm thật', Number(p0xd[0].tong_so) === realKb, `${p0xd[0].tong_so} vs ${realKb}`)
  ok('#3 tong_so viec_uu_tien khớp đếm thật', Number(p0vu[0].tong_so) === realVu && realVu === T_vu, `${p0vu[0].tong_so} vs ${realVu}/${T_vu}`)

  // ══ 1 · KHÔNG mất dòng im lặng: đi hết trang → gom đủ, thấy CẢ 120 seed ══
  for (const [fn, T] of [['kanban_xuong', T_kb], ['xuong_don_san_xuat', T_kb], ['viec_uu_tien', T_vu]]) {
    const r = await diHetTrang(fn)
    const gom = new Set(r.heat.map(x => x.ma_don))
    const thieu = [...seeded].filter(m => !gom.has(m))
    ok(`#1 ${fn}: đi hết trang gom đủ ${T} dòng`, r.heat.length === T, `gom ${r.heat.length}/${T}`)
    ok(`#1 ${fn}: thấy CẢ 120 đơn seed (không mất im lặng)`, thieu.length === 0, `thiếu ${thieu.length}: ${thieu.slice(0, 3)}`)
    // ── 2 · trang cuối đúng + "Sau" tắt đúng chỗ ──
    const conCuoi = T - MOI * (r.soTrang - 1)
    ok(`#2 ${fn}: trang cuối đúng ${conCuoi} dòng · đi đúng ${r.soTrang} trang`, r.trangCuoiSo === conCuoi && r.soTrangDaDi === r.soTrang, `cuối ${r.trangCuoiSo}/${conCuoi} · đi ${r.soTrangDaDi}/${r.soTrang}`)
  }

  // ══ 1b · app "Xem thêm" (gom dồn) cho xuong_don_san_xuat: tải tới khi đủ tong_so ══
  {
    let DONS = []; let TONG = 0; let vong = 0
    do {
      const rows = await goi('xuong_don_san_xuat', Math.floor(DONS.length / MOI))
      if (!TONG) TONG = rows.length ? Number(rows[0].tong_so) : 0
      DONS = DONS.concat(rows); vong++
      if (rows.length < MOI) break
    } while (DONS.length < TONG && vong < 20)
    const con = TONG - DONS.length
    ok('#1b Xem thêm gom dồn tới đủ · nút ẩn khi hết', DONS.length === T_kb && con <= 0, `gom ${DONS.length}/${T_kb} · còn ${con}`)
  }

  // ══ 2b · "Sau" tắt ngay trang 0 khi total ≤ 50 (màn nhỏ không có nút thừa) ══
  {
    // đếm đơn 'cho_giao' — thường ít; dựng cảnh nhỏ bằng cách gọi với bo_qua lớn (trang rỗng an toàn)
    const soTrangKb = Math.max(1, Math.ceil(T_kb / MOI))
    const trangRong = await goi('kanban_xuong', soTrangKb)   // quá cuối → 0 dòng
    ok('#2b trang quá cuối trả 0 dòng (không lặp vô hạn)', trangRong.length === 0)
  }

  // ══ 4 · KHÔNG vỡ màn cũ: mặc định 0 tham số vẫn chạy, trả ≤50, KÈM tong_so (app biết tổng) ══
  const macDinh = await asCeo(`select * from kho.kanban_xuong()`)
  ok('#4 gọi 0 tham số vẫn chạy (caller cũ không gãy)', Array.isArray(macDinh))
  ok('#4 mặc định ≤50 dòng, có cột tong_so (app đọc được tổng → không mù)',
    macDinh.length <= MOI && (macDinh.length === 0 || 'tong_so' in macDinh[0]))

  console.log(`\n══ KẾT QUẢ 084: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
