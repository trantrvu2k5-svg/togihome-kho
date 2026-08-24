// TEST PHẢI CẮN — WP-31 tầng ① (db/143): hao theo dòng · ván giữ chỗ ngay · sổ chờ ghép. Tx rollback, 0 dấu vết.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
const near = (a, b, e = 1e-6) => Math.abs(Number(a) - Number(b)) <= e
let U = {}, NV, NPK, KHO
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const replica = async fn => { await c.query("set session_replication_role='replica'"); try { return await fn() } finally { await c.query("set session_replication_role='origin'") } }
async function mkVT(ma, nhom, dvcs, hao) {
  return (await one(`insert into kho.vat_tu(ma,ten,loai,don_vi_co_so,dvt,ngung_dung,nhom_id,hao_hut_pct) values($1,$1,$2,$3,$3,false,$4,$5) returning id`,
    [ma, 'van', dvcs, nhom, hao])).id
}
async function mkMon(sfx, quy = false) {
  const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values($1,'T143',true,'le','moi_len_don','khac') returning id`, ['T143-' + sfx])).id
  const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,$2,'KE-HO-MELAMINE',false) returning id`, [don, 'món ' + sfx])).id
  if (quy) for (const hd of ['cat', 'dan', 'cam', 'thung', 'goi'])
    await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,moc) values($1,$2,10,'10','go_tay','chuan')`, [mon, hd])
  return { don, mon, ma_don: 'T143-' + sfx }
}
const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: '/x.dxf', ten_goc: 'x.dxf', co_byte: 1 }])
const bomRows = mon => q(`select v.ma, b.so_luong, b.don_vi, b.so_luong_co_so, b.he_so_ap_dung, b.hao_hut_pct, b.moc from kho.don_hang_mon_bom b join kho.vat_tu v on v.id=b.vat_tu_id where b.mon_id=$1 order by v.ma`, [mon])

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.tk = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_thiet_ke'`)).a
  NV = (await one(`select id from kho.nhom where kho.la_nhom_van(id) limit 1`)).id
  NPK = (await one(`select id from kho.nhom where not kho.la_nhom_van(id) limit 1`)).id
  KHO = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id

  let VAN, VAN2, OC, m1, m3, m4, m5, m6, m7, m8, m9
  await replica(async () => {
    VAN = await mkVT('T143-VAN', NV, 'tam', 10); VAN2 = await mkVT('T143-VAN2', NV, 'tam', 10); OC = await mkVT('T143-OC', NPK, 'tui', 0)
    // ── ca 1/2: BOM chuan trực tiếp (moc=chuan) ──
    m1 = (await mkMon('bf', false)).mon
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,so_luong_co_so,he_so_ap_dung,nguon,moc,hao_hut_pct) values($1,$2,5,'tam',5,1,'cutlist','chuan',0)`, [m1, VAN])
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,so_luong_co_so,he_so_ap_dung,nguon,moc,hao_hut_pct) values($1,$2,5,'tam',5,1,'cutlist','chuan',null)`, [m1, VAN2])
    m3 = (await mkMon('c3')).mon; m5 = (await mkMon('c5')).mon; m6 = (await mkMon('c6')).mon
    m7 = (await mkMon('c7')).mon; m8 = (await mkMon('c8')).mon
    m9 = (await mkMon('c9', false)).mon
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,so_luong_co_so,he_so_ap_dung,nguon,moc,hao_hut_pct) values($1,$2,3,'tam',3,1,'cutlist','chuan',0)`, [m9, VAN])
  })

  // ── 1 · hao=0 → xuất đúng số tấm (không ×1,1) ──
  const bf = (await one(`select kho._bf_tinh($1,'van') j`, [m1])).j
  const dVan = bf.dong.find(x => x.ma === 'T143-VAN'), dVan2 = bf.dong.find(x => x.ma === 'T143-VAN2')
  ok('1 ván hao=0 → xuất = 5 (không ×1,1)', dVan && near(dVan.so_luong, 5), JSON.stringify(dVan))
  ok('2 ván hao=NULL → ×1,1 rồi CEIL = 6', dVan2 && near(dVan2.so_luong, 6), JSON.stringify(dVan2))

  // ── 3 · ghi_bom_mon ván don_vi='tam'=cơ sở → so_luong_co_so=so_luong, he_so=1 ──
  { const r = await as(U.ceo, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m3, JSON.stringify([{ vat_tu_id: VAN, so_luong: 4, don_vi: 'tam', hao_hut_pct: 0 }])], true)
    ok('3 ghi_bom_mon OK', !r.e, r.e)
    const b = (await bomRows(m3))[0]
    ok('3 so_luong_co_so=4 · he_so=1 · hao=0', b && near(b.so_luong_co_so, 4) && near(b.he_so_ap_dung, 1) && near(b.hao_hut_pct, 0), JSON.stringify(b)) }

  // ── 4 · ban_giao_xuong → giữ chỗ ván > 0 ──
  { const d = await mkMon('c4', true)
    const r0 = await as(U.ceo, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [d.mon, JSON.stringify([{ vat_tu_id: VAN, so_luong: 4, don_vi: 'tam', hao_hut_pct: 0 }])], true)
    ok('4 ghi BOM du_kien OK', !r0.e, r0.e)
    const rb = await as(U.ceo, `select kho.ban_giao_xuong($1,$2::jsonb,null) x`, [d.ma_don, FILE], true)
    ok('4 ban_giao_xuong OK', !rb.e && rb.r?.[0]?.x?.ok, rb.e || JSON.stringify(rb.r?.[0]?.x))
    const gc = await one(`select so_luong_giu from kho.giu_cho where don_hang_id=$1 and vat_tu_id=$2 and trang_thai='mo'`, [d.don, VAN])
    ok('4 giữ chỗ ván > 0 (không còn 0)', gc && Number(gc.so_luong_giu) > 0, JSON.stringify(gc)) }

  // ── 5 · phụ kiện cai vs tui không hệ số → dòng chờ hệ số, KHÔNG raise, dòng khác vẫn ghi ──
  { const r = await as(U.ceo, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m5,
      JSON.stringify([{ vat_tu_id: VAN, so_luong: 4, don_vi: 'tam' }, { vat_tu_id: OC, so_luong: 16, don_vi: 'cai' }])], true)
    ok('5 KHÔNG raise (2 dòng)', !r.e, r.e)
    const bs = await bomRows(m5)
    const oc = bs.find(x => x.ma === 'T143-OC'), van = bs.find(x => x.ma === 'T143-VAN')
    ok('5 ốc cam so_luong_co_so=NULL (chờ hệ số)', oc && oc.so_luong_co_so === null, JSON.stringify(oc))
    ok('5 dòng ván vẫn ghi (so_luong_co_so=4)', van && near(van.so_luong_co_so, 4), JSON.stringify(van)) }

  // ── 6 · vat_tu_id NULL + ma_plugin → bom_cho_ghep, BOM không có dòng đó ──
  { const r = await as(U.ceo, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m6,
      JSON.stringify([{ vat_tu_id: VAN, so_luong: 4, don_vi: 'tam' }, { ma_plugin: 'PK-XYZ', so_luong: 2, don_vi: 'bo', ghi_chu: 'bản lề lạ' }])], true)
    ok('6 KHÔNG raise', !r.e, r.e)
    const cg = await q(`select ma_plugin, so_luong, trang_thai from kho.bom_cho_ghep where mon_id=$1`, [m6])
    ok('6 bom_cho_ghep có PK-XYZ (cho)', cg.length === 1 && cg[0].ma_plugin === 'PK-XYZ' && cg[0].trang_thai === 'cho', JSON.stringify(cg))
    ok('6 BOM không có dòng PK-XYZ (chỉ ván)', (await bomRows(m6)).length === 1) }

  // ── 7 · đẩy lại lần 2 → ghi đè, không cộng dồn, không dòng ma ──
  { const payload = JSON.stringify([{ vat_tu_id: VAN, so_luong: 4, don_vi: 'tam' }, { ma_plugin: 'PK-XYZ', so_luong: 2, don_vi: 'bo' }])
    await as(U.ceo, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m7, payload], true)
    await as(U.ceo, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m7, payload], true)
    const nb = (await bomRows(m7)).length, ng = Number((await one(`select count(*) n from kho.bom_cho_ghep where mon_id=$1`, [m7])).n)
    ok('7 đẩy 2 lần → BOM 1 dòng, chờ ghép 1 dòng (không cộng dồn)', nb === 1 && ng === 1, `bom=${nb} cho=${ng}`) }

  // ── 8 · ghep_dong_cho → dòng vào BOM, da_ghep, số khớp ──
  { await as(U.ceo, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m8,
      JSON.stringify([{ ma_plugin: 'PK-XYZ', so_luong: 2, don_vi: 'bo' }])], true)
    const cid = (await one(`select id from kho.bom_cho_ghep where mon_id=$1 and trang_thai='cho'`, [m8])).id
    const r = await as(U.ceo, `select kho.ghep_dong_cho($1,$2) g`, [cid, OC], true)
    ok('8 ghep_dong_cho OK', !r.e, r.e)
    const b = (await bomRows(m8)).find(x => x.ma === 'T143-OC')
    ok('8 dòng vào BOM (OC, sl=2)', b && near(b.so_luong, 2), JSON.stringify(b))
    ok('8 sổ chờ → da_ghep', (await one(`select trang_thai from kho.bom_cho_ghep where id=$1`, [cid])).trang_thai === 'da_ghep') }

  // ── 9 · món moc=chuan → ghi_bom_mon + ghep_dong_cho đều BOM_DA_CHOT ──
  { const rg = await as(U.ceo, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m9, JSON.stringify([{ vat_tu_id: VAN, so_luong: 1, don_vi: 'tam' }])])
    ok('9 ghi_bom_mon món chuẩn → BOM_DA_CHOT', /BOM_DA_CHOT/.test(rg.e || ''), rg.e)
    // dựng 1 dòng chờ cho m9 để thử ghép (chèn thẳng replica vì ghi_bom_mon đã bị chặn)
    let cid; await replica(async () => { cid = (await one(`insert into kho.bom_cho_ghep(mon_id,ma_plugin,so_luong,nguon) values($1,'PK-Q',1,'cutlist') returning id`, [m9])).id })
    const re = await as(U.ceo, `select kho.ghep_dong_cho($1,$2) g`, [cid, OC])
    ok('9 ghep_dong_cho món chuẩn → BOM_DA_CHOT', /BOM_DA_CHOT/.test(re.e || ''), re.e) }

  // ── 10 · vai thiet_ke ghi được · vai NULL bị chặn ──
  { const rtk = await as(U.tk, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m5, JSON.stringify([{ vat_tu_id: VAN, so_luong: 4, don_vi: 'tam' }])])
    ok('10 vai thiet_ke gọi được', !rtk.e, rtk.e)
    const rnull = await as('00000000-0000-0000-0000-000000000000', `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [m5, JSON.stringify([{ vat_tu_id: VAN, so_luong: 1, don_vi: 'tam' }])])
    ok('10 vai NULL (chưa đăng nhập) bị chặn', /chỉ thiet_ke|chưa đăng nhập/.test(rnull.e || ''), rnull.e) }

  // ══════════ db/144 · quy_doi_export mở rộng (gỡ blocker map WP-31) ══════════
  // ── 11 · quy_doi_export trả đủ 11 cột · vat_tu_id không NULL với mọi dòng có ma_kho ──
  { const r = await as(U.ceo, `select kho.quy_doi_export() j`)
    ok('11 quy_doi_export gọi được', !r.e, r.e)
    const doc = r.r?.[0]?.j, arr = doc?.quy_doi || []
    const keys11 = ['mo_ta_thiet_ke', 'ma_plugin', 'ma_kho', 'he_so_quy_doi', 'gia_von_kho', 'vat_tu_id', 'ten', 'don_vi_co_so', 'la_mac_dinh', 'muc_tin_cay', 'dvt_plugin']
    ok('11 mỗi dòng đủ 11 cột', arr.length > 0 && keys11.every(k => k in arr[0]), JSON.stringify(arr[0] && Object.keys(arr[0])))
    ok('11 vat_tu_id không NULL với dòng có ma_kho', arr.filter(x => x.ma_kho).every(x => x.vat_tu_id), JSON.stringify(arr.filter(x => x.ma_kho && !x.vat_tu_id).slice(0, 2))) }

  // ── 12 · mỗi ma_plugin lọc la_mac_dinh → đúng 1 dòng (không nhóm ≥2) ──
  { const bad = await q(`select ma_plugin, count(*) n from kho.plugin_ma_map where la_mac_dinh group by ma_plugin having count(*) > 1`)
    ok('12 không ma_plugin nào có ≥2 mặc định', bad.length === 0, JSON.stringify(bad)) }

  // ── 13 · INSERT dòng mặc định thứ 2 cho cùng ma_plugin → bị chặn (unique index) ──
  { const ex = await one(`select ma_plugin from kho.plugin_ma_map where la_mac_dinh limit 1`)
    await c.query('savepoint s13')
    let e13 = null
    // copy dòng mặc định có sẵn (đủ mọi cột NOT NULL), chỉ đổi ma_kho + giữ la_mac_dinh=true → phải đụng unique index
    try { await c.query(`insert into kho.plugin_ma_map select gen_random_uuid(), mo_ta_thiet_ke, ten_mo_ta, ma_plugin, dvt_plugin, gia_plugin, nhom_dinh_muc, 'ZZZ-DUP', he_so_quy_doi, muc_tin_cay, true, 'CHUA_DUYET', ghi_chu, nguoi_duyet, duyet_luc, now(), null from kho.plugin_ma_map where ma_plugin=$1 and la_mac_dinh limit 1`, [ex.ma_plugin]) } catch (x) { e13 = x.message }
    await c.query('rollback to savepoint s13')
    ok('13 mặc định thứ 2 cùng ma_plugin → chặn (unique)', /duplicate key|plugin_ma_map_1default|unique/i.test(e13 || ''), e13) }

  // ── 14 · vai NULL (đăng nhập nhưng không vai) → không đọc được giá vốn ──
  { const rnull = await as('00000000-0000-0000-0000-000000000000', `select kho.quy_doi_export() j`)
    ok('14 vai NULL → chặn đọc giá vốn', /không được đọc giá vốn|không vai trò/.test(rnull.e || ''), rnull.e) }

  // ══════════ db/145 · tách pricing (default) ⟂ picker (mọi màu) ══════════
  // ── 15 · quy_doi_export ĐÚNG 1 dòng/ma_plugin (không mã nào 2 dòng) ──
  { const r = await as(U.ceo, `select kho.quy_doi_export() j`)
    const arr = r.r?.[0]?.j?.quy_doi || []
    const dup = Object.entries(arr.reduce((a, x) => { a[x.ma_plugin] = (a[x.ma_plugin] || 0) + 1; return a }, {})).filter(([, n]) => n > 1)
    ok('15 export đúng 1 dòng/ma_plugin (defaults-only)', arr.length > 0 && dup.length === 0, JSON.stringify(dup)) }

  // ── 16 · bom_ma_kho_ds: mdf@17.5 ≥7 màu, dòng đầu là mặc định ──
  { const r = await as(U.ceo, `select ma, ten, la_mac_dinh from kho.bom_ma_kho_ds() where ma_plugin='mdf@17.5'`)
    ok('16 bom_ma_kho_ds mdf@17.5 ≥7 màu', !r.e && (r.r?.length || 0) >= 7, r.e || ('n=' + (r.r?.length)))
    ok('16 dòng đầu là mặc định (la_mac_dinh=true)', r.r?.[0]?.la_mac_dinh === true, JSON.stringify(r.r?.[0])) }

  // ── 17 · vai NULL gọi bom_ma_kho_ds → chặn ──
  { const rnull = await as('00000000-0000-0000-0000-000000000000', `select * from kho.bom_ma_kho_ds()`)
    ok('17 vai NULL → bom_ma_kho_ds chặn', /chỉ thiet_ke|chưa đăng nhập/.test(rnull.e || ''), rnull.e) }

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_bom_plugin: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, (e.stack || '').split('\n')[1] || ''); F++ }
finally {
  try { await c.query('rollback') } catch (_) {}
  const v = (await q(`select count(*)::int n from kho.vat_tu where ma like 'T143-%'`))[0].n
  const g = (await q(`select count(*)::int n from kho.bom_cho_ghep g join kho.don_hang_mon m on m.id=g.mon_id join kho.don_hang d on d.id=m.don_id where d.ma_don like 'T143-%'`))[0].n
  console.log(`\n🧹 sau rollback: vat_tu T143-* = ${v} · bom_cho_ghep T143 = ${g} (kỳ vọng 0/0)`)
  await c.end(); process.exit(F ? 1 : 0)
}
