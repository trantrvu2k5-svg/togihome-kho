// TEST PHẢI CẮN — 141 · WP-42 tầng ghi: dat_muc_ton + tao_po_tu_canh_bao. Tx rollback, 0 dấu vết.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
const near = (a, b, eps = 0.001) => Math.abs(Number(a) - Number(b)) <= eps
let U = {}, NHOM, LOAI, KHO, NCC1, NCC2
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
// vật tư nhóm-van tồn-tối-thiểu + (tuỳ chọn) gia_ncc cho từng NCC
async function mkVT(ma, { min = null, max = null, ton = 0, gia = [] } = {}) {
  const id = (await one(`insert into kho.vat_tu(ma,ten,loai,don_vi_co_so,dvt,ngung_dung,nhom_id,hao_hut_pct,pp_ke_hoach,ton_toi_thieu,muc_dat_len_toi)
     values($1,$1,$2,'tam','tấm',false,$3,0,'ton_toi_thieu',$4,$5) returning id`, [ma, LOAI, NHOM, min, max])).id
  if (ton) await c.query(`insert into kho.ton(vat_tu_id,kho_id,so_luong,gia_von_bq) values($1,$2,$3,0)`, [id, KHO, ton])
  for (const g of gia) await c.query(`insert into kho.gia_ncc(ncc_id,vat_tu_id,don_vi,don_gia,lead_time_ngay,ap_dung_tu) values($1,$2,'tam',$3,4,current_date)`, [g.ncc, id, g.gia])
  return id
}
const nhomOf = async (uid, ma) => { const { r } = await as(uid, `select nhom from kho.canh_bao_dat_hang() where ma=$1`, [ma]); return r?.[0]?.nhom ?? null }

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  await c.query(`set local session_replication_role='replica'`)
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.tho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_tho'`)).a
  NHOM = (await one(`select id from kho.nhom limit 1`)).id
  LOAI = (await one(`select loai from kho.vat_tu where loai is not null limit 1`)).loai
  KHO = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  NCC1 = (await one(`select id from kho.nha_cung_cap order by ten limit 1`)).id
  NCC2 = (await one(`insert into kho.nha_cung_cap(ten) values('T141-NCC2') returning id`)).id   // chỉ 1 NCC thật → dựng NCC 2

  // ── 1 · dat_muc_ton min=10 max=30 → đọc lại đúng ──
  const A = await mkVT('T141-A', { ton: 5 })
  { const r = await as(U.ceo, `select kho.dat_muc_ton($1,10,30) g`, [A], true)   // keep: giữ để đọc lại
    ok('1 dat_muc_ton OK', !r.e, r.e)
    const row = await one(`select ton_toi_thieu, muc_dat_len_toi from kho.vat_tu where id=$1`, [A])
    ok('1 đọc lại min=10 max=30', near(row.ton_toi_thieu, 10) && near(row.muc_dat_len_toi, 30), JSON.stringify(row)) }

  // ── 2 · min=0 max=NULL hợp lệ → dòng rời nhóm chua_co_muc ──
  const B = await mkVT('T141-B', { min: null, ton: 5 })   // min NULL → chua_co_muc
  ok('2a trước: B ở chua_co_muc', (await nhomOf(U.ceo, 'T141-B')) === 'chua_co_muc')
  { const r = await as(U.ceo, `select kho.dat_muc_ton($1,0,null) g`, [B], true)   // keep: giữ để đọc lại nhóm
    ok('2b dat_muc_ton min=0 max=NULL hợp lệ', !r.e, r.e)
    const row = await one(`select ton_toi_thieu, muc_dat_len_toi from kho.vat_tu where id=$1`, [B])
    ok('2c min=0 (tường minh, KHÔNG null) · max NULL', Number(row.ton_toi_thieu) === 0 && row.muc_dat_len_toi === null, JSON.stringify(row))
    ok('2d B RỜI nhóm chua_co_muc', (await nhomOf(U.ceo, 'T141-B')) !== 'chua_co_muc') }

  // ── 3 · max < min → RAISE ; 4 · min âm → RAISE ──
  ok('3 max<min → RAISE', /đặt-lên-tới.*phải >=|lệch/.test((await as(U.ceo, `select kho.dat_muc_ton($1,30,10) g`, [A])).e || ''))
  ok('4 min âm → RAISE', /không được âm/.test((await as(U.ceo, `select kho.dat_muc_ton($1,-1,null) g`, [A])).e || ''))

  // ── 5 · vai tho → chặn (cả 2 RPC) ──
  ok('5a dat_muc_ton vai tho → chặn', /chỉ kho\/ceo/.test((await as(U.tho, `select kho.dat_muc_ton($1,1,2) g`, [A])).e || ''))
  ok('5b tao_po_tu_canh_bao vai tho → chặn', /chỉ kho\/ceo/.test((await as(U.tho, `select kho.tao_po_tu_canh_bao('[]'::jsonb) g`)).e || ''))

  // ── 6 · PO 3 dòng thuộc 2 NCC → 2 don_mua 'moi', 3 dòng con, đơn giá khớp ──
  const V1 = await mkVT('T141-V1', { gia: [{ ncc: NCC1, gia: 500000 }] })
  const V2 = await mkVT('T141-V2', { gia: [{ ncc: NCC1, gia: 700000 }] })
  const V3 = await mkVT('T141-V3', { gia: [{ ncc: NCC2, gia: 900000 }] })
  const dong = JSON.stringify([
    { vat_tu_id: V1, so_luong: 3, ncc_id: NCC1, don_gia: 500000 },
    { vat_tu_id: V2, so_luong: 2, ncc_id: NCC1, don_gia: 700000 },
    { vat_tu_id: V3, so_luong: 4, ncc_id: NCC2, don_gia: 900000 }])
  { const r = await as(U.ceo, `select kho.tao_po_tu_canh_bao($1::jsonb) g`, [dong], true)
    ok('6a tao_po OK', !r.e, r.e)
    const g = r.r?.[0]?.g
    ok('6b tạo đúng 2 PO (gom theo NCC)', g && g.so_po === 2, JSON.stringify(g))
    const poIds = (g?.po || []).map(p => p.po_id)
    const tt = await q(`select trang_thai, count(*)::int n from kho.don_mua where id = any($1::uuid[]) group by trang_thai`, [poIds])
    ok('6c cả 2 PO trạng thái "moi" (đầu chuỗi)', tt.length === 1 && tt[0].trang_thai === 'moi' && tt[0].n === 2, JSON.stringify(tt))
    const dm = await q(`select vat_tu_id, so_luong, dvt, don_gia from kho.don_mua_dong where don_mua_id = any($1::uuid[]) order by don_gia`, [poIds])
    ok('6d tổng 3 dòng con', dm.length === 3, dm.length)
    ok('6e đơn giá khớp (500k/700k/900k) + đơn vị cơ sở "tam"', near(dm[0].don_gia, 500000) && near(dm[1].don_gia, 700000) && near(dm[2].don_gia, 900000) && dm.every(x => x.dvt === 'tam'), JSON.stringify(dm.map(x => [x.don_gia, x.dvt]))) }

  // ── 7 · đơn giá BỊA lệch gia_ncc → RAISE ──
  { const bad = JSON.stringify([{ vat_tu_id: V1, so_luong: 1, ncc_id: NCC1, don_gia: 123456 }])
    ok('7 đơn giá lệch bảng giá NCC → RAISE', /lệch bảng giá NCC/.test((await as(U.ceo, `select kho.tao_po_tu_canh_bao($1::jsonb) g`, [bad])).e || '')) }

  // ── 8 · dòng thiếu ncc_id → RAISE ──
  { const bad = JSON.stringify([{ vat_tu_id: V1, so_luong: 1, don_gia: 500000 }])
    ok('8 thiếu ncc_id → RAISE', /thiếu ncc_id/.test((await as(U.ceo, `select kho.tao_po_tu_canh_bao($1::jsonb) g`, [bad])).e || '')) }

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_141: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, (e.stack || '').split('\n')[1] || ''); F++ }
finally {
  try { await c.query('rollback') } catch (_) {}
  const con = (await q(`select count(*)::int n from kho.vat_tu where ma like 'T141-%'`))[0].n
  const cong = (await q(`select count(*)::int n from kho.don_mua where ghi_chu = 'PO nháp từ cảnh báo đặt hàng (WP-42)'`))[0].n
  console.log(`\n🧹 sau rollback: vat_tu T141-* = ${con} · don_mua PO-nháp = ${cong} (kỳ vọng 0/0)`)
  await c.end(); process.exit(F ? 1 : 0)
}
