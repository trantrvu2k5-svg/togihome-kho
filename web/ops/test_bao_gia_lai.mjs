// TEST WP-15b (2) L-10 · bao_gia_lai + đóng dấu ma_ky_bao_gia + cờ hết-hạn (db/224). tx-rollback, 0 rác.
import pg from 'pg'; import { docConfig } from './conn.mjs'; import { readFileSync } from 'fs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const SALE_UID = '6e8ce1ff-984e-458c-9e19-1df68925a298'   // vai sale
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const cfg = await docConfig(); cfg.statement_timeout = 25000
const c = new pg.Client(cfg); await c.connect()
const vai = u => c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: u, role: 'authenticated' })])
const attempt = async fn => { await c.query('savepoint s'); try { const r = await fn(); return { ok: true, r } } catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: (e.message || '').split('\n')[0] } } }
const SP = 'UB8D-O-4C'   // có giá vốn trong san_pham_mau_gia_von

// tạo 1 đơn báo giá (dong) + 1 món sp hợp lệ; trả id. moc_bao_gia stamp ma_ky_bao_gia + han_tra_loi.
async function mkBG(ma, dong) {
  const id = (await c.query(
    "insert into kho.don_hang(ma_don, ten_khach, sdt_khach, trang_thai, dong, gia_chot, doanh_thu) values($1,$2,$3,'bao_gia',$4,1000000,1000000) returning id",
    [ma, 'DEMO-baogialai', '0900000123', dong])).rows[0].id
  await c.query("insert into kho.don_hang_mon(don_id, sp_id, ten, so_luong, gia) values($1,$2,'Tủ UB8D',1,1000000)", [id, SP])
  return id
}

try {
  await c.query('begin')
  await vai(CEO)
  // đảm bảo kỳ hiện hành có he_so_m (gia_san_don cần)
  await attempt(() => c.query("select kho.tinh_he_so_m(kho.ky_gia_hien_hanh())"))

  // ── vế 1: báo giá CÒN HẠN + kỳ đổi → giá KHÔNG đổi ──
  const id1 = await mkBG('BGLAI-1', 'le')
  const r1 = (await c.query("select gia_chot, ma_ky_bao_gia, to_char(han_tra_loi,'YYYY-MM-DD') han from kho.don_hang where id=$1", [id1])).rows[0]
  ok('1a tạo báo giá → moc_bao_gia đóng dấu ma_ky_bao_gia + han_tra_loi (+7)', r1.ma_ky_bao_gia != null && r1.han != null, JSON.stringify(r1))
  // đổi kỳ: mở + xác nhận 2026-10
  await attempt(() => c.query("select kho.mo_ky_moi('2026-10')"))
  await c.query("update kho.tham_so_tai_chinh set xac_nhan_luc=now() where ma_ky='2026-10'")
  const g1sau = (await c.query("select gia_chot from kho.don_hang where id=$1", [id1])).rows[0].gia_chot
  ok('1b kỳ đổi (xác nhận 2026-10) → giá báo giá GIỮ NGUYÊN (lớp 2 QD-103)', String(g1sau) === String(r1.gia_chot), 'cũ=' + r1.gia_chot + ' sau=' + g1sau)
  await c.query("update kho.tham_so_tai_chinh set xac_nhan_luc=null where ma_ky='2026-10'")   // reset để ky_gia về 2026-09... nhưng 10 vẫn mới nhất

  // ── vế 2: quá hạn → sale_bao_gia_ds het_han=true + số ngày đúng ──
  await c.query("update kho.don_hang set han_tra_loi = current_date - 5 where id=$1", [id1])
  // CEO xem được mọi đơn (sale chỉ thấy đơn sale_phu_trach của mình)
  const ds = await attempt(() => c.query("select kho.sale_bao_gia_ds(1000) d"))
  let row2 = null
  if (ds.ok) { const arr = ds.r.rows[0].d.ds || []; row2 = arr.find(x => x.ma_don === 'BGLAI-1') }
  ok('2 sale_bao_gia_ds: BGLAI-1 het_han=true · so_ngay_qua_han=5', !!row2 && row2.het_han === true && row2.so_ngay_qua_han === 5, JSON.stringify(row2 && { het_han: row2.het_han, qh: row2.so_ngay_qua_han, ky: row2.ma_ky_bao_gia }))

  // ── vế 3: bao_gia_lai trên đơn quá hạn → giá/kỳ/hạn đổi + JSON 5 trường ──
  const j3 = await attempt(() => c.query("select kho.bao_gia_lai($1) g", [id1]))
  const g3 = j3.ok ? j3.r.rows[0].g : null
  const after3 = (await c.query("select gia_chot, ma_ky_bao_gia, to_char(han_tra_loi,'YYYY-MM-DD') han, to_char(bao_gia_lai_luc,'YYYY-MM-DD') vet, bao_gia_lai_boi from kho.don_hang where id=$1", [id1])).rows[0]
  ok('3a bao_gia_lai chạy · JSON đủ 5 trường (gia_cu·gia_moi·ky_cu·ky_moi·han_moi)',
    !!g3 && ['gia_cu','gia_moi','ky_cu','ky_moi','han_moi'].every(k => k in g3), JSON.stringify(g3))
  ok('3b DB đổi: gia_chot=gia_moi · ma_ky_bao_gia=ky_moi · vết ai/khi ghi',
    !!g3 && String(after3.gia_chot) === String(g3.gia_moi) && after3.ma_ky_bao_gia === g3.ky_moi && after3.vet != null && after3.bao_gia_lai_boi === CEO, JSON.stringify(after3))
  ok('3c hạn mới = hôm nay + 7 (đơn lẻ)', g3 && after3.han === g3.han_moi, 'han=' + after3.han)

  // ── vế 4: bao_gia_lai trên đơn CÒN HẠN → chặn ──
  const id4 = await mkBG('BGLAI-4', 'le')   // han_tra_loi = +7 (còn hạn)
  const j4 = await attempt(() => c.query("select kho.bao_gia_lai($1) g", [id4]))
  ok('4 bao_gia_lai đơn CÒN HẠN → chặn', !j4.ok && /CHƯA quá hạn/.test(j4.msg || ''), j4.msg)

  // ── vế 5: bao_gia_lai trên đơn NGOÀI (bao_gia/bao_gia_treo): dựng bao_gia rồi chuyển bao_gia_thua → chặn ──
  const id5 = await mkBG('BGLAI-THUA', 'le')
  await c.query("update kho.don_hang set trang_thai='bao_gia_thua', ly_do_thua='gia_cao' where id=$1", [id5])
  const j5 = await attempt(() => c.query("select kho.bao_gia_lai($1) g", [id5]))
  ok('5 bao_gia_lai đơn NGOÀI báo giá (bao_gia_thua) → chặn (không lặp vụ chot_don đơn da_giao)', !j5.ok && /chỉ báo lại đơn CÒN Ở BÁO GIÁ/.test(j5.msg || ''), j5.msg)

  // ── vế 7: đơn dự án gia hạn +21 ──
  const id7 = await mkBG('BGLAI-7', 'du_an')
  await c.query("update kho.don_hang set han_tra_loi=current_date-1 where id=$1", [id7])
  const j7 = await attempt(() => c.query("select kho.bao_gia_lai($1) g", [id7]))
  const han7 = (await c.query("select (han_tra_loi - current_date) n from kho.don_hang where id=$1", [id7])).rows[0].n
  ok('7 đơn dự án báo lại → gia hạn +21 ngày', j7.ok && Number(han7) === 21, 'còn=' + han7 + ' ngày (mong 21)')

  // ── vế 6 (SQL): authenticated KHÔNG UPDATE 3 cột mới ──
  const priv = (await c.query("select bool_or(has_column_privilege('authenticated','kho.don_hang',u,'UPDATE')) any_upd from unnest(array['ma_ky_bao_gia','bao_gia_lai_luc','bao_gia_lai_boi']) u")).rows[0]
  ok('6 authenticated KHÔNG UPDATE 3 cột mới → PATCH sẽ 403 (cột-mới ĐÓNG WP-11b)', priv.any_upd === false, JSON.stringify(priv))

} finally { await c.query('rollback') }

// ── vế 6 (REST live): client PATCH ma_ky_bao_gia → 40x ──
let url = '', anon = ''
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  if (l.startsWith('VITE_SUPABASE_URL=')) url = l.split('=')[1].trim()
  if (l.startsWith('VITE_SUPABASE_ANON_KEY=')) anon = l.split('=')[1].trim()
}
try {
  const res = await fetch(`${url}/rest/v1/don_hang?ma_don=eq.ANY-MA`, {
    method: 'PATCH', headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json', 'Content-Profile': 'kho', 'Accept-Profile': 'kho' },
    body: JSON.stringify({ ma_ky_bao_gia: 'HACK' })
  })
  const body = await res.text()
  ok(`6 REST PATCH ma_ky_bao_gia (client) → chặn (HTTP ${res.status})`, res.status >= 400 && /ma_ky_bao_gia|permission denied/i.test(body), `status=${res.status} body=${body.slice(0, 150)}`)
} catch (e) { ok('6 REST PATCH → chặn', false, 'fetch: ' + e.message) }

await c.end()
console.log(`\n═══ test_bao_gia_lai: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
