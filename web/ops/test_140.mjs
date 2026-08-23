// TEST PHẢI CẮN — 140 · WP-42 canh_bao_dat_hang + ban_giao_xuong.bom_cho_he_so. Tx rollback, 0 dấu vết.
// Dựng fixture qua session_replication_role='replica' (bỏ trigger/FK), gọi RPC vai test_*.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
const near = (a, b, eps = 0.001) => Math.abs(Number(a) - Number(b)) <= eps
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
let U = {}, NHOM, LOAI, NCC, KHO, DON_DEMO, TODAY, STT = 0
async function as(uid, sql, args = []) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows } catch (x) { e = x.message }
  try { await c.query('rollback to savepoint s') } catch (_) {}
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
// tạo vật tư tồn-tối-thiểu + fixtures. opts: {min,max,ton,giu,lead,m2,minNull}
async function mkVT(ma, opts = {}) {
  const base = 'tam'
  const id = (await one(`insert into kho.vat_tu(ma,ten,loai,don_vi_co_so,dvt,ngung_dung,nhom_id,hao_hut_pct,pp_ke_hoach,ton_toi_thieu,muc_dat_len_toi)
     values($1,$1,$2,$3,'tấm',false,$4,0,'ton_toi_thieu',$5,$6) returning id`,
    [ma, LOAI, base, NHOM, opts.minNull ? null : (opts.min ?? null), opts.max ?? null])).id
  if (opts.m2) await c.query(`insert into kho.vat_tu_don_vi(vat_tu_id,don_vi,he_so) values($1,'m2',$2)`, [id, opts.m2])
  if (opts.ton) await c.query(`insert into kho.ton(vat_tu_id,kho_id,so_luong,gia_von_bq) values($1,$2,$3,0)`, [id, KHO, opts.ton])
  if (opts.giu) await c.query(`insert into kho.giu_cho(don_hang_id,vat_tu_id,kho_id,so_luong_giu,so_luong_da_xuat,trang_thai) values($1,$2,$3,$4,0,'mo')`, [DON_DEMO, id, KHO, opts.giu])
  if (opts.lead != null) await c.query(`insert into kho.gia_ncc(ncc_id,vat_tu_id,don_vi,don_gia,lead_time_ngay,ap_dung_tu) values($1,$2,$3,$4,$5,current_date)`, [NCC, id, base, 100000, opts.lead])
  return id
}
async function addPO(vat_tu_id, dvt, so_luong, da_nhan, trang_thai = 'xac_nhan') {
  const dm = (await one(`insert into kho.don_mua(so_don,ncc_id,kho_id,ngay_can,trang_thai) values($1,$2,$3,current_date,$4) returning id`,
    ['T140-PO-' + Math.floor(so_luong * 1000 + da_nhan), NCC, KHO, trang_thai])).id
  await c.query(`insert into kho.don_mua_dong(don_mua_id,stt,vat_tu_id,so_luong,dvt,don_gia,so_luong_da_nhan) values($1,1,$2,$3,$4,0,$5)`, [dm, vat_tu_id, so_luong, dvt, da_nhan])
  return dm
}
const CB = `select ma, kha_dung, ton, giu_cho, po_dang_ve, ton_toi_thieu, muc_dat_len_toi, so_dat, ngay_het::text ngay_het, ngay_dat::text ngay_dat, lead_time, nhom, thieu_muc_max from kho.canh_bao_dat_hang() where ma like 'T140-%'`
const callCB = async (uid = U.ceo) => { const { r, e } = await as(uid, CB); if (e) throw new Error(e); return Object.fromEntries(r.map(x => [x.ma, x])) }

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  await c.query(`set local session_replication_role='replica'`)   // fixtures bỏ trigger/FK; RPC read-only vẫn chạy
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.tho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_tho'`)).a
  NHOM = (await one(`select id from kho.nhom limit 1`)).id
  LOAI = (await one(`select loai from kho.vat_tu where loai is not null limit 1`)).loai
  NCC = (await one(`select id from kho.nha_cung_cap order by ten limit 1`)).id
  KHO = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  TODAY = (await one(`select current_date::text d`)).d
  STT = Number((await one(`select coalesce(max(stt),0)::bigint m from kho.giao_dich`)).m) + 1000
  DON_DEMO = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values('T140-DEMO','DEMO 140',true,'le','moi_len_don','khac') returning id`)).id

  // ── 1 · min10 max30 ton12 giữ5 → kha_dung7 → canh_bao, so_dat23 ──
  const X = await mkVT('T140-X', { min: 10, max: 30, ton: 12, giu: 5, lead: 4 })
  { const r = (await callCB())['T140-X']
    ok('1 kha_dung = 7 (12−5)', r && near(r.kha_dung, 7), r && r.kha_dung)
    ok('1 nhom = canh_bao', r && r.nhom === 'canh_bao', r && r.nhom)
    ok('1 so_dat = 23 (30−7)', r && near(r.so_dat, 23), r && r.so_dat) }

  // ── 2 · thêm PO xac_nhan 5 chưa nhận → kha_dung 12 → biến khỏi cảnh báo ──
  await addPO(X, 'tam', 5, 0)
  { const r = (await callCB())['T140-X']
    ok('2 X biến khỏi kết quả (kha_dung 12 ≥ min 10)', r === undefined, JSON.stringify(r)) }

  // ── 3 · PO đơn vị khác cơ sở (m2, he_so 0.336) → po_dang_ve quy hệ số đúng ──
  const Y = await mkVT('T140-Y', { min: 100, ton: 0, lead: 4, m2: 0.336 })
  await addPO(Y, 'm2', 10, 0)   // 10 m2 × 0.336 = 3.36 tấm
  { const r = (await callCB())['T140-Y']
    ok('3 po_dang_ve = 3.36 (10 m² × 0.336)', r && near(r.po_dang_ve, 3.36), r && r.po_dang_ve)
    ok('3 kha_dung = 3.36', r && near(r.kha_dung, 3.36), r && r.kha_dung) }

  // ── 4 · lead 4, xuất đều 30/30ngày → toc=1 → ngay_dat = ngay_het − 4 ; toc=0 → ngay_dat = hôm nay ──
  const Z = await mkVT('T140-Z', { min: 100, ton: 50, lead: 4 })   // kha_dung 50
  for (let i = 0; i < 30; i++)
    await c.query(`insert into kho.giao_dich(id,vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon,canh_bao,tao_luc,stt)
      values(gen_random_uuid(),$1,$2,'xuat',-1,0,'phieu','test140',now()-($3||' days')::interval,$4)`, [Z, KHO, i, STT++])
  const W = await mkVT('T140-W', { min: 100, ton: 50, lead: 4 })   // không xuất → toc=0
  { const m = await callCB()
    const z = m['T140-Z'], w = m['T140-W']
    ok('4a toc>0: ngay_het = hôm nay + 50 (kd50 / toc1)', z && z.ngay_het === addDays(TODAY, 50), z && z.ngay_het)
    ok('4a toc>0: ngay_dat = ngay_het − lead 4', z && z.ngay_dat === addDays(TODAY, 46), z && z.ngay_dat)
    ok('4b toc=0: ngay_dat = hôm nay', w && w.ngay_dat === TODAY, w && w.ngay_dat) }

  // ── 5 · min NULL → chua_co_muc ; dưới mức không lead → thieu_lead ; max NULL → thieu_muc_max ──
  const N = await mkVT('T140-N', { minNull: true, ton: 0 })
  const L = await mkVT('T140-L', { min: 20, ton: 0 })              // KHÔNG lead
  const M = await mkVT('T140-M', { min: 15, ton: 0, lead: 4 })      // max NULL
  { const m = await callCB()
    ok('5 min NULL → chua_co_muc', m['T140-N'] && m['T140-N'].nhom === 'chua_co_muc' && m['T140-N'].so_dat === null, JSON.stringify(m['T140-N']))
    ok('5 dưới mức, không lead → thieu_lead', m['T140-L'] && m['T140-L'].nhom === 'thieu_lead' && m['T140-L'].lead_time === null, JSON.stringify(m['T140-L']))
    ok('5 max NULL → thieu_muc_max=true, so_dat từ min (15)', m['T140-M'] && m['T140-M'].thieu_muc_max === true && near(m['T140-M'].so_dat, 15) && m['T140-M'].nhom === 'canh_bao', JSON.stringify(m['T140-M'])) }

  // ── 6 · vai không phải kho/ceo → chặn ──
  { const r = await as(U.tho, `select * from kho.canh_bao_dat_hang()`)
    ok('6 vai tho → RAISE (chỉ kho/ceo)', /chỉ kho\/ceo|canh_bao_dat_hang/.test(r.e || ''), r.e) }

  // ── 7 · ban_giao_xuong: đơn có dòng BOM chờ hệ số → bom_cho_he_so có dòng, vat_tu_thieu giữ hành vi ──
  { const cot = await q(`select vat_tu_id from kho.ton where kho_id=$1 and so_luong>50 limit 2`, [KHO])
    const A = cot[0].vat_tu_id, B = cot[1].vat_tu_id   // A: dòng thường (giữ chỗ) · B: dòng CHỜ hệ số
    const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values('T140-BG','DEMO 140',true,'le','moi_len_don','khac') returning id`)).id
    const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,'kệ 140','KE-HO-MELAMINE',false) returning id`, [don])).id
    for (const hd of ['cat', 'dan', 'cam', 'thung', 'goi'])
      await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,moc) values($1,$2,10,'10','go_tay','chuan')`, [mon, hd])
    // dòng BOM bình thường (có so_luong_co_so) + dòng CHỜ hệ số (so_luong_co_so NULL), vật tư KHÁC (dhmb_uq)
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,so_luong_co_so,don_vi,nguon,moc) values($1,$2,4,4,'c','cutlist','du_kien')`, [mon, A])
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,so_luong_co_so,don_vi,nguon,moc) values($1,$2,2,NULL,'m2','cutlist','du_kien')`, [mon, B])
    const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: '/x.dxf', ten_goc: 'x.dxf', co_byte: 1 }])
    const r = await as(U.ceo, `select kho.ban_giao_xuong('T140-BG',$1::jsonb,null) x`, [FILE])
    const x = r.r?.[0]?.x
    ok('7 ban_giao_xuong OK', r.e === null && x && x.ok === true, r.e || JSON.stringify(x))
    ok('7 bom_cho_he_so có 1 dòng (so_luong_co_so NULL)', x && Array.isArray(x.bom_cho_he_so) && x.bom_cho_he_so.length === 1 && x.bom_cho_he_so[0].don_vi === 'm2', JSON.stringify(x?.bom_cho_he_so))
    ok('7 vat_tu_thieu vẫn là mảng (hành vi cũ giữ nguyên)', x && Array.isArray(x.vat_tu_thieu), JSON.stringify(x?.vat_tu_thieu)) }

  // ── ĐO 100k giao_dich (RPC mới đọc SỔ) < 500ms ──
  await c.query(`insert into kho.giao_dich(id,vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon,canh_bao,tao_luc,stt)
    select gen_random_uuid(), $1, $2, 'xuat', -1, 0, 'phieu', 'test140', now() - ((g % 30)||' days')::interval, $3 + g
    from generate_series(1,100000) g`, [Z, KHO, STT]); STT += 100001
  const t0 = Date.now(); await as(U.ceo, `select count(*) n from kho.canh_bao_dat_hang()`); const ms = Date.now() - t0
  ok(`đo 100k: canh_bao_dat_hang ${ms}ms < 500ms`, ms < 500, ms + 'ms')

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_140: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, (e.stack || '').split('\n')[1] || ''); F++ }
finally {
  try { await c.query('rollback') } catch (_) {}
  // xác nhận 0 dấu vết
  const con = (await q(`select count(*)::int n from kho.vat_tu where ma like 'T140-%'`))[0].n
  const cong = (await q(`select count(*)::int n from kho.giao_dich where canh_bao = 'test140'`))[0].n
  console.log(`\n🧹 sau rollback: vat_tu T140-* = ${con} · giao_dich test140* = ${cong} (kỳ vọng 0/0)`)
  await c.end(); process.exit(F ? 1 : 0)
}
