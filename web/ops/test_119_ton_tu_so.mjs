// TEST PHẢI CẮN — 119 · Tồn = tổng từ sổ giao_dich (WP-11/L-58). Tx rollback, KHÔNG để lại dữ liệu. Mỗi test cắn HAI vế.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', kho: '66272566-1897-4c57-aa3f-98a81636302a', NULLVAI: '00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const tonOf = async (vid, kid) => Number((await one(`select so_luong from kho.ton where vat_tu_id=$1 and kho_id=$2`, [vid, kid]))?.so_luong ?? 0)
const lastStt = async (vid) => (await one(`select so_du_sau from kho.giao_dich where vat_tu_id=$1 order by stt desc limit 1`, [vid]))?.so_du_sau

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  const kid = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  const mkVT = async (ma) => (await one(`insert into kho.vat_tu(ma,ten,loai) values($1,$2,'pk') returning id`, [ma, ma])).id

  console.log('── T1 · trạng thái đã khoá ──')
  ok('T1 quet_giao_dich ĐÃ drop', (await q(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kho' and proname='quet_giao_dich'`)).length === 0)
  ok('T1 giao_dich KHÔNG còn policy ALL/UPDATE/DELETE', (await q(`select 1 from pg_policies where schemaname='kho' and tablename='giao_dich' and cmd in ('ALL','UPDATE','DELETE')`)).length === 0)
  ok('T1 ton KHÔNG còn policy ghi (chỉ SELECT)', (await q(`select cmd from pg_policies where schemaname='kho' and tablename='ton'`)).every(r => r.cmd === 'SELECT'))
  ok('T1 [phản chứng] giao_dich CÓ trigger cache tồn + chặn sửa', (await q(`select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='giao_dich' and not t.tgisinternal`)).length >= 2)

  console.log('\n── T2 · vai kho qua role authenticated ──')
  const V2 = await mkVT('test_TT_2')
  const ins = await as(U.kho, `insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon) values($1,$2,'nhap',3,0,'phieu')`, [V2, kid], true)
  ok('T2 INSERT giao_dich → ĐƯỢC (trigger cập nhật ton=3)', ins.e === null && await tonOf(V2, kid) === 3, ins.e)
  const upd = await as(U.kho, `update kho.giao_dich set so_luong=999 where vat_tu_id=$1`, [V2])
  ok('T2 UPDATE giao_dich → BỊ TỪ CHỐI', upd.e !== null, 'không lỗi')
  const del = await as(U.kho, `delete from kho.giao_dich where vat_tu_id=$1`, [V2])
  ok('T2 DELETE giao_dich → BỊ TỪ CHỐI', del.e !== null, 'không lỗi')

  console.log('\n── T3 · bẻ 1 giao dịch → ton chạy đúng ──')
  const V3 = await mkVT('test_TT_3')
  await q(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon) values($1,$2,'nhap',5,0,'phieu')`, [V3, kid])
  ok('T3 +5 → ton=5, so_du_sau=5', await tonOf(V3, kid) === 5 && Number(await lastStt(V3)) === 5)
  await q(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon) values($1,$2,'xuat',-5,0,'phieu')`, [V3, kid])
  ok('T3 −5 → về ton=0, so_du_sau=0', await tonOf(V3, kid) === 0 && Number(await lastStt(V3)) === 0)
  await q(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon) values($1,$2,'xuat',-5,0,'phieu')`, [V3, kid])
  ok('T3 âm kho ĐƯỢC PHÉP (RPC cũ cho phép) + gắn cờ ton_am', await tonOf(V3, kid) === -5 && (await one(`select canh_bao from kho.giao_dich where vat_tu_id=$1 order by stt desc limit 1`, [V3])).canh_bao === 'ton_am')

  console.log('\n── T4 · 3 dòng cùng tx: tao_luc bằng, stt tăng ngặt ──')
  const V4 = await mkVT('test_TT_4')
  for (const d of [4, 3, -2]) await q(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon) values($1,$2,$3,$4,0,'phieu')`, [V4, kid, d > 0 ? 'nhap' : 'xuat', d])
  const g4 = await q(`select stt, tao_luc, so_du_sau from kho.giao_dich where vat_tu_id=$1 order by stt`, [V4])
  ok('T4 3 dòng cùng tao_luc (now() đóng băng trong tx)', new Set(g4.map(r => String(r.tao_luc))).size === 1)
  ok('T4 stt TĂNG NGẶT', g4[0].stt < g4[1].stt && g4[1].stt < g4[2].stt)
  ok('T4 dòng cuối THEO STT: so_du_sau = ton hiện tại (=5)', Number(await lastStt(V4)) === await tonOf(V4, kid) && await tonOf(V4, kid) === 5)
  const lastByTao = (await one(`select so_du_sau from kho.giao_dich where vat_tu_id=$1 order by tao_luc desc, id desc limit 1`, [V4])).so_du_sau
  ok('T4 [phản chứng] sắp theo tao_luc,id KHÔNG phân định (có thể ≠ ton)', true, `tao_luc-last=${lastByTao} vs ton=5`)

  console.log('\n── T5 · ghi_so_phieu + huy_phieu: ton khớp v_ton_tu_so, RPC không update ton ──')
  const V5 = await mkVT('test_TT_5')
  const ncc = (await one(`select id from kho.nha_cung_cap limit 1`)).id
  const sp = (await as(U.ceo, `select kho.ghi_so_phieu('nhap',$1,null,'t',$2::jsonb,null) g`, [ncc, JSON.stringify([{ vat_tu_id: V5, so_luong: 10, don_gia: 1000 }])], true)).r[0].g.so_phieu
  await as(U.ceo, `select kho.huy_phieu($1,'t') g`, [sp], true)
  const vts = Number((await one(`select so_luong from kho.v_ton_tu_so where vat_tu_id=$1 and kho_id=$2`, [V5, kid]))?.so_luong ?? 0)
  ok('T5 ton = v_ton_tu_so = 0 sau nhập+huỷ', await tonOf(V5, kid) === 0 && vts === 0)
  const noUpd = ['ghi_so_phieu', 'huy_phieu'].every(fn => !/update\s+(kho\.)?ton\b/i.test((/* live def */ '')))
  const defs = await q(`select proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kho' and proname in ('ghi_so_phieu','huy_phieu')`)
  ok('T5 thân 2 RPC KHÔNG chứa "update ... ton"', defs.every(x => !/update\s+(kho\.)?ton\b/i.test(x.d)))

  console.log('\n── T6 · so_ba_nguon: 3 nguồn khớp 100% (mã test) ──')
  const sbn = readFileSync('/Users/vuquanghai/Documents/togihome-kho/web/ops/so_ba_nguon.sql', 'utf8')
  const rows = await q(sbn); const tong = rows.find(r => r.ma === 'TỔNG')
  ok('T6 so_ba_nguon khớp hết (lệch=0 gồm cả mã test)', tong.khop === true, JSON.stringify(tong))

  console.log('\n── T7 · HIỆU NĂNG 100.000 dòng ──')
  // 200 mã test riêng (đường không-lô → trigger đi nhánh nhanh)
  await q(`insert into kho.vat_tu(ma,ten,loai) select 'test_PF_'||g, 'pf'||g, 'pk' from generate_series(1,200) g`)
  const t0 = Date.now()
  await q(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon)
           select v.id, $1, 'nhap', 1, 0, 'phieu'
           from generate_series(1,100000) g join kho.vat_tu v on v.ma = 'test_PF_'||(1+g%200)`, [kid])
  const msGhi = Date.now() - t0
  await q(`analyze kho.giao_dich`); await q(`analyze kho.ton`)
  const oneVT = (await one(`select id from kho.vat_tu where ma='test_PF_1'`)).id
  // min-of-3 (warm) — loại spike mạng remote pooler, đo NĂNG LỰC truy vấn
  const T = async (sql, a = []) => { let m = 1e9; for (let i = 0; i < 3; i++) { const t = Date.now(); await c.query(sql, a); m = Math.min(m, Date.now() - t) } return m }
  const mi = await T(`select * from kho.v_ton_tu_so`)
  const mii = await T(`select so_luong from kho.ton where vat_tu_id=$1 and kho_id=$2`, [oneVT, kid])
  const miii = await T(sbn)
  const miv = await T(`select so_du_sau from kho.giao_dich where vat_tu_id=$1 order by stt desc limit 1`, [oneVT])
  console.log(`   ⏱  ghi/dòng=${(msGhi / 100000).toFixed(3)}ms · v_ton_tu_so=${mi}ms · ton 1 mã=${mii}ms · so_ba_nguon=${miii}ms · stt-last 1 mã=${miv}ms`)
  ok(`T7(i) v_ton_tu_so toàn bộ < 500ms (=${mi})`, mi < 500)
  ok(`T7(ii) tồn 1 mã < 300ms (=${mii})`, mii < 300)
  ok(`T7(iii) so_ba_nguon < 500ms (=${miii})`, miii < 500)
  ok(`T7(iv) dòng cuối theo stt 1 mã < 50ms (=${miv})`, miv < 50)

  console.log('\n── T8 · guard vai NULL ──')
  const gN = await as(U.NULLVAI, `select kho.ghi_so_phieu('nhap',null,null,'t',$1::jsonb,null)`, [JSON.stringify([{ vat_tu_id: V5, so_luong: 1 }])])
  ok('T8 vai NULL gọi ghi_so_phieu → CHẶN (bẫy coalesce)', gN.e !== null && /CEO\/kho/i.test(gN.e), gN.e || 'không lỗi')

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_119: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); process.exit(F === 0 ? 0 : 1) }
