// TEST PHẢI CẮN — 127 · Nhận hàng đơn mua (WP-21). Tx rollback. Dữ liệu test tự tạo tự xoá; CẤM đụng số thật (DM-2026-0003…).
//   Dùng U.ceo/U.kho/U.tho/U.ke_toan có sẵn (LUẬT CẤM tạo tài khoản). Mọi ghi trong tx → rollback ở finally.
import pg from 'pg'; import { docConfig } from './conn.mjs'; import { execFileSync } from 'node:child_process'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', kho: '66272566-1897-4c57-aa3f-98a81636302a',
            tho: 'fce494fe-e197-40ed-b212-9344cb0d3805', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 120) : '')); v ? P++ : F++ }
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
const g = (r) => r?.r?.[0]?.g
let ncc, khoId, V0, V1
// tạo đơn ở xac_nhan (persist trong tx) → trả {id, dd:[{id,stt,vat_tu_id}]}
async function mkXN(dong) {
  const r = await as(U.kho, `select kho.dm_tao($1,$2,current_date+7,'t',$3::jsonb,false) g`, [ncc, khoId, JSON.stringify(dong)], true)
  const id = g(r).id
  await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'da_gui') g`, [id], true)
  await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'xac_nhan') g`, [id], true)
  const dd = await q(`select id, stt, vat_tu_id from kho.don_mua_dong where don_mua_id=$1 order by stt`, [id])
  return { id, dd }
}
const nhan = (uid, id, dong, keep = false) => as(uid, `select kho.dm_nhan_hang($1,$2::jsonb,current_date) g`, [id, JSON.stringify(dong)], keep)

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  ncc = (await one(`select id from kho.nha_cung_cap limit 1`)).id
  khoId = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  const vv = await q(`select id from kho.vat_tu where ngung_dung=false order by ma limit 2`); V0 = vv[0].id; V1 = vv[1].id

  console.log('── 1 · nhận MỘT PHẦN → giữ xac_nhan, sổ đúng ──')
  { const po = await mkXN([{ vat_tu_id: V0, so_luong: 10, don_gia: 1000 }, { vat_tu_id: V1, so_luong: 5, don_gia: 2000 }])
    const tonTruoc = Number((await one(`select coalesce(so_luong,0) s from kho.ton where vat_tu_id=$1 and kho_id=$2`, [V0, khoId]))?.s || 0)
    const r = await nhan(U.kho, po.id, [{ dong_id: po.dd[0].id, so_luong: 4 }], true)
    ok('#1 nhận 4/10 → không lỗi', r.e === null, r.e)
    const res = g(r)
    ok('#1 trạng thái đơn vẫn xac_nhan', res?.trang_thai_don === 'xac_nhan', res?.trang_thai_don)
    ok('#1 dong_du=0 / dong_tong=2', res?.dong_du === 0 && res?.dong_tong === 2, JSON.stringify([res?.dong_du, res?.dong_tong]))
    const dn = Number((await one(`select so_luong_da_nhan s from kho.don_mua_dong where id=$1`, [po.dd[0].id])).s)
    ok('#1 so_luong_da_nhan = 4', dn === 4, dn)
    const ph = await one(`select id,loai,don_mua_id,ncc_id,kho_id from kho.phieu where don_mua_id=$1`, [po.id])
    ok('#1 phiếu nhập gắn don_mua_id + đúng kho/ncc của đơn', ph && ph.loai === 'nhap' && ph.kho_id === khoId && ph.ncc_id === ncc, JSON.stringify(ph))
    const lo = await one(`select so_luong_nhap, gia_von_lo from kho.lo_nhap where phieu_id=$1 and vat_tu_id=$2`, [ph.id, V0])
    ok('#1 lô nhập 4 · gia_von_lo = đơn giá dòng (1000)', Number(lo.so_luong_nhap) === 4 && Number(lo.gia_von_lo) === 1000, JSON.stringify(lo))
    const gd = await one(`select so_luong, nguon from kho.giao_dich where phieu_id=$1 and vat_tu_id=$2 and loai='nhap'`, [ph.id, V0])
    ok('#1 giao_dich nhập +4 nguồn phieu', Number(gd.so_luong) === 4 && gd.nguon === 'phieu', JSON.stringify(gd))
    const tonCache = Number((await one(`select so_luong s from kho.ton where vat_tu_id=$1 and kho_id=$2`, [V0, khoId])).s)
    const tonSo = Number((await one(`select so_luong s from kho.v_ton_tu_so where vat_tu_id=$1 and kho_id=$2`, [V0, khoId])).s)
    ok('#1 ton cache khớp v_ton_tu_so', tonCache === tonSo, `${tonCache} vs ${tonSo}`)
    ok('#1 ton tăng đúng 4 so với trước', tonCache === tonTruoc + 4, `${tonTruoc}→${tonCache}`)
    ok('#1 ton_truoc_sau trả về đúng', res.ton_truoc_sau.some(x => x.vat_tu_id === V0 && Number(x.sau) === Number(x.truoc) + 4), JSON.stringify(res.ton_truoc_sau))
  }

  console.log('\n── 2 · nhận NỐT → da_nhan + lịch sử ──')
  { const po = await mkXN([{ vat_tu_id: V0, so_luong: 10, don_gia: 1000 }])
    await nhan(U.kho, po.id, [{ dong_id: po.dd[0].id, so_luong: 6 }], true)
    const r2 = await nhan(U.kho, po.id, [{ dong_id: po.dd[0].id, so_luong: 4 }], true)
    ok('#2 nhận nốt 4 → không lỗi', r2.e === null, r2.e)
    ok('#2 trạng thái đơn = da_nhan', g(r2)?.trang_thai_don === 'da_nhan', g(r2)?.trang_thai_don)
    const dn = Number((await one(`select so_luong_da_nhan s from kho.don_mua_dong where id=$1`, [po.dd[0].id])).s)
    ok('#2 so_luong_da_nhan = 10', dn === 10, dn)
    const nNhan = Number((await one(`select count(*) c from kho.don_mua_lich_su where don_mua_id=$1 and noi_dung ? 'nhan_hang'`, [po.id])).c)
    const nDaNhan = Number((await one(`select count(*) c from kho.don_mua_lich_su where don_mua_id=$1 and toi_trang_thai='da_nhan'`, [po.id])).c)
    ok('#2 lịch sử: 2 nhan_hang + 1 chuyển da_nhan (hệ thống)', nNhan === 2 && nDaNhan === 1, `nhan=${nNhan} daNhan=${nDaNhan}`)
  }

  console.log('\n── 3 · VƯỢT số đặt → chặn, không ghi gì ──')
  { const po = await mkXN([{ vat_tu_id: V0, so_luong: 5, don_gia: 1000 }])
    const cnt = async () => JSON.stringify([
      Number((await one(`select count(*) c from kho.phieu where don_mua_id=$1`, [po.id])).c),
      Number((await one(`select count(*) c from kho.giao_dich where phieu_id in (select id from kho.phieu where don_mua_id=$1)`, [po.id])).c),
      Number((await one(`select count(*) c from kho.lo_nhap where phieu_id in (select id from kho.phieu where don_mua_id=$1)`, [po.id])).c)])
    const truoc = await cnt()
    const r = await nhan(U.kho, po.id, [{ dong_id: po.dd[0].id, so_luong: 9 }])
    ok('#3 nhận 9/5 → DM_VUOT_SO_DAT', r.e !== null && /DM_VUOT_SO_DAT/.test(r.e), r.e)
    ok('#3 phiếu/giao_dịch/lô trước = sau (không ghi nửa vời)', (await cnt()) === truoc, `${truoc} → ${await cnt()}`)
    const dn = Number((await one(`select so_luong_da_nhan s from kho.don_mua_dong where id=$1`, [po.dd[0].id])).s)
    ok('#3 so_luong_da_nhan vẫn 0', dn === 0, dn)
  }

  console.log('\n── 4 · sai trạng thái đơn → DM_SAI_TRANG_THAI ──')
  { const moi = g(await as(U.kho, `select kho.dm_tao($1,$2,current_date+7,'t',$3::jsonb,false) g`, [ncc, khoId, JSON.stringify([{ vat_tu_id: V0, so_luong: 3 }])], true)).id
    const r1 = await nhan(U.kho, moi, [{ dong_id: (await one(`select id from kho.don_mua_dong where don_mua_id=$1`, [moi])).id, so_luong: 1 }])
    ok('#4 đơn moi → DM_SAI_TRANG_THAI', /DM_SAI_TRANG_THAI/.test(r1.e || ''), r1.e)
    await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'da_gui') g`, [moi], true)
    const r2 = await nhan(U.kho, moi, [{ dong_id: (await one(`select id from kho.don_mua_dong where don_mua_id=$1`, [moi])).id, so_luong: 1 }])
    ok('#4 đơn da_gui → DM_SAI_TRANG_THAI', /DM_SAI_TRANG_THAI/.test(r2.e || ''), r2.e)
    const hu = g(await as(U.kho, `select kho.dm_tao($1,$2,current_date+7,'t',$3::jsonb,false) g`, [ncc, khoId, JSON.stringify([{ vat_tu_id: V0, so_luong: 3 }])], true)).id
    await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'huy',null,'x') g`, [hu], true)
    const r3 = await nhan(U.kho, hu, [{ dong_id: (await one(`select id from kho.don_mua_dong where don_mua_id=$1`, [hu])).id, so_luong: 1 }])
    ok('#4 đơn huy → DM_SAI_TRANG_THAI', /DM_SAI_TRANG_THAI/.test(r3.e || ''), r3.e)
  }

  console.log('\n── 5 · vai tho/ke_toan → từ chối ──')
  { const po = await mkXN([{ vat_tu_id: V0, so_luong: 5, don_gia: 1000 }])
    const rt = await nhan(U.tho, po.id, [{ dong_id: po.dd[0].id, so_luong: 1 }])
    ok('#5 vai tho → từ chối', rt.e !== null && /chỉ kho\/ceo/i.test(rt.e), rt.e)
    const rk = await nhan(U.ke_toan, po.id, [{ dong_id: po.dd[0].id, so_luong: 1 }])
    ok('#5 vai ke_toan → từ chối', rk.e !== null && /chỉ kho\/ceo/i.test(rk.e), rk.e)
  }

  console.log('\n── 6 · huy_phieu khi đơn xac_nhan → sổ đảo + trừ lại da_nhan ──')
  { const po = await mkXN([{ vat_tu_id: V0, so_luong: 10, don_gia: 1000 }])
    const tonTruoc = Number((await one(`select coalesce(so_luong,0) s from kho.ton where vat_tu_id=$1 and kho_id=$2`, [V0, khoId]))?.s || 0)
    const r = await nhan(U.kho, po.id, [{ dong_id: po.dd[0].id, so_luong: 6 }], true)
    const sp = g(r).so_phieu
    const tonSauNhan = Number((await one(`select so_luong s from kho.ton where vat_tu_id=$1 and kho_id=$2`, [V0, khoId])).s)
    const hr = await as(U.kho, `select kho.huy_phieu($1,'trả sai') g`, [sp], true)
    ok('#6 huy_phieu → không lỗi (sinh phiếu đảo)', hr.e === null && !!g(hr), hr.e)
    const tonSauHuy = Number((await one(`select so_luong s from kho.ton where vat_tu_id=$1 and kho_id=$2`, [V0, khoId])).s)
    ok('#6 ton: +6 rồi về cũ sau huỷ', tonSauNhan === tonTruoc + 6 && tonSauHuy === tonTruoc, `${tonTruoc}→${tonSauNhan}→${tonSauHuy}`)
    const dn = Number((await one(`select so_luong_da_nhan s from kho.don_mua_dong where id=$1`, [po.dd[0].id])).s)
    ok('#6 so_luong_da_nhan trừ lại về 0', dn === 0, dn)
    ok('#6 đơn vẫn xac_nhan', (await one(`select trang_thai t from kho.don_mua where id=$1`, [po.id])).t === 'xac_nhan')
    ok('#6 lịch sử có huy_nhan', Number((await one(`select count(*) c from kho.don_mua_lich_su where don_mua_id=$1 and noi_dung ? 'huy_nhan'`, [po.id])).c) === 1)
  }

  console.log('\n── 7 · huy_phieu khi đơn da_nhan → DM_DA_NHAN_KHONG_HUY ──')
  { const po = await mkXN([{ vat_tu_id: V0, so_luong: 10, don_gia: 1000 }])
    const r = await nhan(U.kho, po.id, [{ dong_id: po.dd[0].id, so_luong: 10 }], true)
    const sp = g(r).so_phieu
    ok('#7 nhận đủ → đơn da_nhan', g(r).trang_thai_don === 'da_nhan')
    const hr = await as(U.kho, `select kho.huy_phieu($1,'thử') g`, [sp])
    ok('#7 huy_phieu → DM_DA_NHAN_KHONG_HUY', hr.e !== null && /DM_DA_NHAN_KHONG_HUY/.test(hr.e), hr.e)
  }

  console.log('\n── 9 · TỐC ĐỘ @100k đơn / 300k dòng: dm_nhan_hang 1 đơn 20 dòng ──')
  { await q(`insert into kho.don_mua(so_don,ncc_id,kho_id,ngay_can,trang_thai)
      select 'DM-P7-'||gs, $1, $2, current_date+(gs%30), (array['moi','da_gui','xac_nhan','da_nhan'])[1+gs%4]
      from generate_series(1,100000) gs`, [ncc, khoId])
    await q(`insert into kho.don_mua_dong(don_mua_id,stt,vat_tu_id,so_luong,dvt,don_gia)
      select d.id, s, $1, 100, 'c', 1000 from kho.don_mua d, generate_series(1,3) s where d.so_don like 'DM-P7-%'`, [V0])
    await q(`analyze kho.don_mua`); await q(`analyze kho.don_mua_dong`); await q(`analyze kho.phieu`); await q(`analyze kho.giao_dich`)
    // đơn 20 dòng ở xac_nhan giữa bộ 100k
    const big = await mkXN(Array.from({ length: 20 }, () => ({ vat_tu_id: V0, so_luong: 100, don_gia: 1000 })))
    const dongNhan = big.dd.map(x => ({ dong_id: x.id, so_luong: 50 }))
    const exMs = async (uid, sql, a = []) => Number((await as(uid, `explain (analyze, format json) ${sql}`, a)).r[0]['QUERY PLAN'][0]['Execution Time'])
    const ms = await exMs(U.kho, `select kho.dm_nhan_hang($1,$2::jsonb,current_date) g`, [big.id, JSON.stringify(dongNhan)])
    ok(`#9 dm_nhan_hang 20 dòng @100k = ${ms.toFixed(0)}ms server-side ≤ 500`, ms <= 500, ms + 'ms')
  }

  await c.query('rollback')   // ĐÓNG tx test TRƯỚC khi gọi các test khác (chúng mở tx riêng)
  console.log('\n── 8 · các cổng CŨ không vỡ (tiến trình riêng) ──')
  // test_037 (cũ) đọc DATABASE_URL thay vì conn.mjs → dựng URL từ docConfig cho nó; test khác bỏ qua env này.
  const cfg = await (await import('./conn.mjs')).docConfig()
  const dbUrl = cfg.connectionString || `postgresql://${cfg.user}:${encodeURIComponent(cfg.password)}@${cfg.host}:${cfg.port}/${cfg.database}`
  const subEnv = { ...process.env, DATABASE_URL: dbUrl }
  const runNode = (f) => { try { execFileSync('node', [f], { cwd: process.cwd(), stdio: 'pipe', env: subEnv }); return true } catch (e) { console.log('   ↳', f, '\n', (e.stdout || e.stderr || '').toString().split('\n').slice(-8).join('\n')); return false } }
  const runSql = (f) => { try { const o = execFileSync('node', ['ops/run_sql.mjs', f], { cwd: process.cwd(), stdio: 'pipe' }).toString(); return /199\/199|✅|OK/.test(o) } catch (e) { console.log('   ↳ so_ba_nguon:', (e.stdout || e.stderr || '').toString().slice(-300)); return false } }
  ok('#8 so_ba_nguon.sql 199/199', runSql('ops/so_ba_nguon.sql'))
  ok('#8 test_119_ton_tu_so không vỡ', runNode('ops/test_119_ton_tu_so.mjs'))
  ok('#8 test_huy_phieu không vỡ', runNode('ops/test_huy_phieu.mjs'))
  ok('#8 test_126 (đơn mua) không vỡ', runNode('ops/test_126.mjs'))
  ok('#8 test_037 (kho→SX) không vỡ', runNode('ops/test_037.mjs'))

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_127: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); console.log('xác nhận: tx ROLLBACK — không để lại đơn/dòng/phiếu test.'); process.exit(F === 0 ? 0 : 1) }
