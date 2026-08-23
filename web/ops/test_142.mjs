// TEST PHẢI CẮN — 142 · WP-42 vá gap: canh_bao_dat_hang lộ vat_tu_id + toc_do. Tx rollback, 0 dấu vết.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0, STT = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 140) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps
let U = {}, NHOM, LOAI, KHO
async function as(uid, sql, args = []) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows } catch (x) { e = x.message }
  try { await c.query('rollback to savepoint s') } catch (_) {}
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  await c.query(`set local session_replication_role='replica'`)
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  NHOM = (await one(`select id from kho.nhom limit 1`)).id
  LOAI = (await one(`select loai from kho.vat_tu where loai is not null limit 1`)).loai
  KHO = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  STT = Number((await one(`select coalesce(max(stt),0)::bigint m from kho.giao_dich`)).m) + 1000

  // mã có min + xuất đều 30/30 ngày → toc_do = 1
  const V = (await one(`insert into kho.vat_tu(ma,ten,loai,don_vi_co_so,dvt,ngung_dung,nhom_id,hao_hut_pct,pp_ke_hoach,ton_toi_thieu)
     values('T142-V','T142-V',$1,'tam','tấm',false,$2,0,'ton_toi_thieu',100) returning id`, [LOAI, NHOM])).id
  await c.query(`insert into kho.ton(vat_tu_id,kho_id,so_luong,gia_von_bq) values($1,$2,50,0)`, [V, KHO])
  for (let i = 0; i < 30; i++)
    await c.query(`insert into kho.giao_dich(id,vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon,canh_bao,tao_luc,stt)
      values(gen_random_uuid(),$1,$2,'xuat',-1,0,'phieu','test142',now()-($3||' days')::interval,$4)`, [V, KHO, i, STT++])

  const { r, e } = await as(U.ceo, `select vat_tu_id, ma, toc_do, kha_dung, nhom from kho.canh_bao_dat_hang() where ma='T142-V'`)
  ok('gọi hàm OK', !e, e)
  const row = r?.[0]
  ok('vat_tu_id khớp bảng vat_tu (= id đã tạo)', row && row.vat_tu_id === V, JSON.stringify(row?.vat_tu_id))
  ok('toc_do = 1 (xuất 30/30 ngày)', row && near(row.toc_do, 1), row && row.toc_do)

  // mã KHÔNG xuất → toc_do = 0
  const W = (await one(`insert into kho.vat_tu(ma,ten,loai,don_vi_co_so,dvt,ngung_dung,nhom_id,hao_hut_pct,pp_ke_hoach,ton_toi_thieu)
     values('T142-W','T142-W',$1,'tam','tấm',false,$2,0,'ton_toi_thieu',10) returning id`, [LOAI, NHOM])).id
  { const { r: r2 } = await as(U.ceo, `select toc_do from kho.canh_bao_dat_hang() where ma='T142-W'`)
    ok('mã không xuất → toc_do = 0', r2?.[0] && Number(r2[0].toc_do) === 0, JSON.stringify(r2?.[0])) }

  // vat_tu_id của MỌI dòng đều tra ngược được về vat_tu (không null/lạ)
  { const { r: r3 } = await as(U.ceo, `select count(*)::int tong, count(*) filter (where exists(select 1 from kho.vat_tu v where v.id=x.vat_tu_id))::int khop from kho.canh_bao_dat_hang() x`)
    ok('mọi vat_tu_id khớp bảng vat_tu', r3?.[0] && r3[0].tong === r3[0].khop && r3[0].tong > 0, JSON.stringify(r3?.[0])) }

  // ── ĐO 100k (hàm đọc sổ vừa sửa) < 500ms — đo RPC TRỰC TIẾP (bỏ ~6 round-trip của as()) ──
  await c.query(`insert into kho.giao_dich(id,vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon,canh_bao,tao_luc,stt)
    select gen_random_uuid(), $1, $2, 'xuat', -1, 0, 'phieu', 'test142', now() - ((g % 30)||' days')::interval, $3 + g
    from generate_series(1,100000) g`, [V, KHO, STT]); STT += 100001
  await c.query('savepoint p'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ceo, role: 'authenticated' })])
  let ms = 1e9
  for (let i = 0; i < 3; i++) { const t = Date.now(); await c.query(`select count(*) from kho.canh_bao_dat_hang()`); ms = Math.min(ms, Date.now() - t) }
  await c.query('rollback to savepoint p'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  ok(`đo 100k: canh_bao_dat_hang ${ms}ms < 500ms (best/3, RPC trực tiếp)`, ms < 500, ms + 'ms')

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_142: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, (e.stack || '').split('\n')[1] || ''); F++ }
finally {
  try { await c.query('rollback') } catch (_) {}
  const con = (await q(`select count(*)::int n from kho.vat_tu where ma like 'T142-%'`))[0].n
  const cong = (await q(`select count(*)::int n from kho.giao_dich where canh_bao='test142'`))[0].n
  console.log(`\n🧹 sau rollback: vat_tu T142-* = ${con} · giao_dich test142 = ${cong} (kỳ vọng 0/0)`)
  await c.end(); process.exit(F ? 1 : 0)
}
