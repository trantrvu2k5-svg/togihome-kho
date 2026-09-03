// WP-11d [B] · TEST 2 RPC tham_so_tai_chinh. BEGIN/ROLLBACK — không đổi số thật.
//   Chứng: ceo/ke_toan ghi được · sale/xuong/tho + anon bị chặn · bề mặt đúng 20/45 · ma_ky lạ RAISE không sinh dòng.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const cfg = await docConfig(); cfg.statement_timeout = 15000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const UID = { ceo: '76763d59-6146-472a-89c7-1e8327b77090', ke_toan: '9dc067f3-6fb5-453e-b11d-f3dd74a255be',
  sale: '69379400-91e6-48cc-bcbf-e5a7ccdfa560', xuong: 'e4964e23-5a07-4e86-a06c-facb4d3f9f5f', tho: '4fdb3e35-4d66-40ef-9df8-2161df94e50d' }
const K = '2026-08'
const asRole = async (uid) => { await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]) }
const asAnon = async () => { await c.query('set local role anon'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'anon' })]) }
const reset = async () => { await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)") }
// gọi trong savepoint; trả {ok, msg}
async function call(fn, params, uid) {
  await c.query('savepoint s')
  try { if (uid === 'anon') await asAnon(); else await asRole(uid)
    const r = await c.query(`select kho.${fn} r`, params); await reset()
    return { ok: true, r: r.rows[0].r }
  } catch (e) { await c.query('rollback to savepoint s'); await reset().catch(() => {}); return { ok: false, msg: (e.message || '').split('\n')[0], code: e.code } }
}
const RPC1 = 'luu_tham_so_ban_hang($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)'
const RPC2 = 'luu_cau_hinh_van_hanh($1,$2,$3,$4,$5,$6,$7,$8,$9)'
const V1 = [K, 123, 7, 11, 0.03, 0.01, 0.01, 1, 2, 3, 99, 5, 6, 'TEST_2a']       // 13 cột
const V2 = [K, 12, '["02:00","14:00"]', 9, 1, 2, 3, 4, 5]                          // 8 cột (vat=12 đè)

try {
  await c.query('begin')
  // ── 2a ceo ghi được + readback đúng ──
  await c.query('savepoint a')
  const a1 = await call(RPC1, V1, UID.ceo); const a2 = await call(RPC2, V2, UID.ceo)
  const row = (await c.query(`select dt_muc_tieu,so_don_ke_hoach,ghi_chu,vat,gio_mo_cua,ghi_de,n_ads,tran_sale from kho.tham_so_tai_chinh where ma_ky=$1`, [K])).rows[0]
  ok('2a ceo gọi 2 RPC → ok', a1.ok && a2.ok, JSON.stringify(a1.msg || a2.msg))
  ok('2a SELECT readback khớp giá trị truyền (dt=123·ghi_chu·vat=12·ghi_de=9·n_ads=1·tran_sale=5)',
    Number(row.dt_muc_tieu) === 123 && row.ghi_chu === 'TEST_2a' && Number(row.vat) === 12 && Number(row.ghi_de) === 9 && Number(row.n_ads) === 1 && Number(row.tran_sale) === 5,
    JSON.stringify(row))
  await c.query('rollback to savepoint a')

  // ── 2b ke_toan ok · sale/xuong/tho chặn ──
  const kt = await call(RPC1, V1, UID.ke_toan)
  ok('2b ke_toan → ok', kt.ok, kt.msg)
  for (const vai of ['sale', 'xuong', 'tho']) {
    const r = await call(RPC1, V1, UID[vai])
    ok(`2b ${vai} → CHẶN`, !r.ok && /không được sửa/.test(r.msg || ''), r.ok ? 'LỌT!' : r.msg)
  }
  // ── 2c anon chặn ở EXECUTE ──
  const an = await call(RPC1, V1, 'anon')
  ok('2c anon → CHẶN ở EXECUTE', !an.ok && (an.code === '42501' || /permission denied/i.test(an.msg || '')), an.ok ? 'LỌT!' : (an.code + ' ' + an.msg))

  // ── 2d 25 cột ngoài danh sách KHÔNG đổi ──
  await c.query('savepoint d')
  const OUT = ['he_so_m', 'he_so_nhom', 'dg_gio_tk', 'gio_l1', 'gio_l2', 'gio_l3', 'cnc_lap_trinh', 'setup_to_hop',
    'ngay_ap_dung', 'ky_tinh', 'ship_du_toan', 'che_do_chia_viec', 'quy_dau_ky', 'nguong_k3_le', 'mau_toi_thieu_don',
    'nguong_kenh_yeu', 'mau_toi_thieu_khach', 'nguong_lap_day_thap', 'nguong_lap_day_cao', 'nguong_no_gia',
    'nguong_cod_ket', 'nguong_lai_hut_tien', 'coc_toi_thieu_du_an_pct', 'bien_muc_tieu', 'dt_muc_tieu']
  // (dt_muc_tieu là cột RPC1 ghi → để kiểm ngược: nó PHẢI đổi; 24 cột trên nó phải nguyên)
  const before = (await c.query(`select ${OUT.join(',')} from kho.tham_so_tai_chinh where ma_ky=$1`, [K])).rows[0]
  await call(RPC1, V1, UID.ceo); await call(RPC2, V2, UID.ceo)
  const after = (await c.query(`select ${OUT.join(',')} from kho.tham_so_tai_chinh where ma_ky=$1`, [K])).rows[0]
  const doiNgoai = OUT.filter(k => k !== 'dt_muc_tieu' && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  ok('2d 24 cột NGOÀI danh sách KHÔNG đổi cột nào (bề mặt = 20/45)', doiNgoai.length === 0, 'đổi ngoài: ' + doiNgoai.join(','))
  ok('2d′ kiểm ngược: dt_muc_tieu (trong danh sách) CÓ đổi → 123', Number(after.dt_muc_tieu) === 123, String(after.dt_muc_tieu))
  await c.query('rollback to savepoint d')

  // ── 2e ma_ky lạ → RAISE, không sinh dòng ──
  const cBefore = (await c.query('select count(*) n from kho.tham_so_tai_chinh')).rows[0].n
  const bad = await call(RPC1, ['1900-01', ...V1.slice(1)], UID.ceo)
  const cAfter = (await c.query('select count(*) n from kho.tham_so_tai_chinh')).rows[0].n
  ok('2e ma_ky lạ → RAISE "chưa có" + KHÔNG sinh dòng', !bad.ok && /chưa có tham số/.test(bad.msg || '') && cBefore === cAfter, (bad.msg || '') + ' · count ' + cBefore + '→' + cAfter)

  await c.query('rollback')
} catch (e) { console.log('LỖI NGOÀI DỰ KIẾN:', e.message); try { await c.query('rollback') } catch {}; F++ }

console.log(`\n═══ test_rpc_tham_so: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
