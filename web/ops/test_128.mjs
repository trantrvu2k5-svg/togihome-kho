// TEST PHẢI CẮN — 128 · BOM thuộc món (WP-30). Tx rollback. Dữ liệu test tự tạo; CẤM đụng số thật.
//   as(uid,...) JWT sub=auth_uid. U.kho/ceo (được ghi BOM), U.tho (không thuộc nhóm BOM → từ chối).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', kho: '66272566-1897-4c57-aa3f-98a81636302a',
            tho: 'fce494fe-e197-40ed-b212-9344cb0d3805' }
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
const g = (r) => r?.r?.[0]?.ghi_bom_mon
// chạy SQL thô có thể RAISE (trigger) mà KHÔNG abort tx ngoài — bọc savepoint
async function tryRaw(sql, args = []) { await c.query('savepoint r'); try { await c.query(sql, args); await c.query('release savepoint r'); return null } catch (e) { await c.query('rollback to savepoint r'); return e.message } }
let DON, V0, V1, V2, HD
const mkMon = async () => (await one(`insert into kho.don_hang_mon(don_id, so_luong, ten) values($1,1,'món test') returning id`, [DON])).id
const bom = (dong) => dong.map(x => ({ so_luong: 1, ...x }))

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  DON = (await one(`insert into kho.don_hang(ma_don) values('TEST-BOM-128') returning id`)).id
  const vts = await q(`select id from kho.vat_tu where ngung_dung=false order by ma limit 3`); [V0, V1, V2] = vts.map(r => r.id)
  HD = (await one(`select hoat_dong from kho.don_gia_baseline limit 1`)).hoat_dong

  console.log('── a · món go_tay 3 dòng → bom_don_ds 3 dòng, co_bom=true ──')
  { const mon = await mkMon()
    const r = await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify(bom([{ vat_tu_id: V0, so_luong: 2 }, { vat_tu_id: V1, so_luong: 3 }, { vat_tu_id: V2, so_luong: 4 }]))], true)
    ok('#a ghi_bom_mon trả 3', g(r) === 3, JSON.stringify(r.e || g(r)))
    const ds = (await as(U.kho, `select * from kho.bom_don_ds($1,'du_kien')`, [DON], true)).r.filter(x => x.mon_id === mon)
    ok('#a bom_don_ds 3 dòng, co_bom=true, don_vi tự điền', ds.length === 3 && ds.every(x => x.co_bom && x.don_vi), JSON.stringify(ds.map(x => x.don_vi)))
    ok('#a nguon_bom = go_tay', ds.every(x => x.nguon_bom === 'go_tay')) }

  console.log('\n── b · cutlist đẩy 2 lần khác dòng → chỉ còn bộ lần 2 ──')
  { const mon = await mkMon()
    await as(U.kho, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify(bom([{ vat_tu_id: V0 }, { vat_tu_id: V1 }]))], true)
    await as(U.kho, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify(bom([{ vat_tu_id: V1, so_luong: 5 }, { vat_tu_id: V2, so_luong: 6 }]))], true)
    const rows = await q(`select vat_tu_id, so_luong from kho.don_hang_mon_bom where mon_id=$1 and nguon='cutlist' order by so_luong`, [mon])
    ok('#b chỉ còn 2 dòng của lần đẩy 2 (V1=5,V2=6)', rows.length === 2 && Number(rows[0].so_luong) === 5 && Number(rows[1].so_luong) === 6, JSON.stringify(rows)) }

  console.log('\n── c · cùng món go_tay + uoc → 2 bộ song song (QD-15) ──')
  { const mon = await mkMon()
    await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify(bom([{ vat_tu_id: V0 }, { vat_tu_id: V1 }]))], true)
    await as(U.kho, `select kho.ghi_bom_mon($1,'uoc',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify(bom([{ vat_tu_id: V2 }]))], true)
    const ds = (await as(U.kho, `select * from kho.bom_don_ds($1,'du_kien')`, [DON], true)).r.filter(x => x.mon_id === mon)
    const ng = new Set(ds.map(x => x.nguon))
    ok('#c 3 dòng, cả go_tay lẫn uoc song song', ds.length === 3 && ng.has('go_tay') && ng.has('uoc'), JSON.stringify([...ng]))
    ok('#c nguon_bom ưu tiên go_tay (> uoc)', ds.every(x => x.nguon_bom === 'go_tay')) }

  console.log('\n── d · UPDATE/DELETE trực tiếp vai kho → chặn (RLS/revoke) ──')
  { const mon = await mkMon()
    await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify(bom([{ vat_tu_id: V0 }]))], true)
    const up = await as(U.kho, `update kho.don_hang_mon_bom set so_luong=9 where mon_id=$1`, [mon])
    ok('#d UPDATE thẳng → CHẶN', up.e !== null && /denied|permission/i.test(up.e), up.e)
    const del = await as(U.kho, `delete from kho.don_hang_mon_bom where mon_id=$1`, [mon])
    ok('#d DELETE thẳng → CHẶN', del.e !== null && /denied|permission/i.test(del.e), del.e) }

  console.log('\n── e · dòng chuẩn ĐÃ CHỐT → trigger chặn sửa/xoá; ghi_bom_mon trả "đã chốt" ──')
  { const mon = await mkMon()
    await q(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc,chot_luc) values($1,$2,1,'c','cutlist','chuan',now())`, [mon, V0])
    const rg = await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify(bom([{ vat_tu_id: V1 }]))])
    ok('#e ghi_bom_mon khi đã có chuẩn → BOM_DA_CHOT', rg.e !== null && /BOM_DA_CHOT|đã chốt/i.test(rg.e), rg.e)
    const up = await tryRaw(`update kho.don_hang_mon_bom set so_luong=2 where mon_id=$1 and moc='chuan'`, [mon])
    ok('#e UPDATE dòng chốt (trigger) → chặn', up && /BOM_DA_CHOT/.test(up), up)
    const del = await tryRaw(`delete from kho.don_hang_mon_bom where mon_id=$1 and moc='chuan'`, [mon])
    ok('#e DELETE dòng chốt (trigger) → chặn', del && /BOM_DA_CHOT/.test(del), del) }

  console.log('\n── f · vật tư lạ / SL 0 / hoạt động lạ → lỗi rõ ──')
  { const mon = await mkMon()
    const e1 = (await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify([{ vat_tu_id: '00000000-0000-0000-0000-000000000000', so_luong: 1 }])])).e
    ok('#f vật tư lạ → lỗi', /không tồn tại/i.test(e1 || ''), e1)
    const e2 = (await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify([{ vat_tu_id: V0, so_luong: 0 }])])).e
    ok('#f số lượng 0 → lỗi', /> 0/.test(e2 || ''), e2)
    const e3 = (await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify([{ vat_tu_id: V0, so_luong: 1, hoat_dong: 'KHONG_CO' }])])).e
    ok('#f hoạt động lạ → lỗi', /don_gia_baseline/.test(e3 || ''), e3) }

  console.log('\n── g · vai không thuộc nhóm BOM (tho — thay cho sale) → từ chối ──')
  { const mon = await mkMon()
    const r = await as(U.tho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) ghi_bom_mon`, [mon, JSON.stringify(bom([{ vat_tu_id: V0 }]))])
    ok('#g vai tho → từ chối', r.e !== null && /thiet_ke\/tk_ban_hang/i.test(r.e), r.e) }

  console.log('\n── h · xoa_demo() xoá sạch BOM đơn demo (kể cả dòng đã chốt) ──')
  { const dDemo = (await one(`insert into kho.don_hang(ma_don, la_demo) values('TEST-BOM-DEMO-128', true) returning id`)).id
    const monD = (await one(`insert into kho.don_hang_mon(don_id, so_luong, ten) values($1,1,'demo') returning id`, [dDemo])).id
    await q(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc) values($1,$2,1,'c','go_tay','du_kien')`, [monD, V0])
    await q(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc,chot_luc) values($1,$2,1,'c','cutlist','chuan',now())`, [monD, V1])
    const truoc = Number((await one(`select count(*) c from kho.don_hang_mon_bom where mon_id=$1`, [monD])).c)
    const rx = await as(U.ceo, `select kho.xoa_demo('TEST-BOM-DEMO-128', null) x`, [], true)
    const sau = Number((await one(`select count(*) c from kho.don_hang_mon_bom where mon_id=$1`, [monD])).c)
    ok('#h xoa_demo xoá sạch BOM demo (2→0), kể cả dòng chốt', truoc === 2 && sau === 0 && rx.e === null, `truoc=${truoc} sau=${sau} e=${rx.e}`) }

  console.log('\n── i · TỐC ĐỘ @100.000 dòng BOM ──')
  { const dPerf = (await one(`insert into kho.don_hang(ma_don) values('TEST-BOM-PERF-128') returning id`)).id
    await q(`insert into kho.don_hang_mon(id, don_id, so_luong, ten)
      select gen_random_uuid(), $1, 1, 'm'||g from generate_series(1,1000) g`, [dPerf])
    const vt100 = (await q(`select id from kho.vat_tu order by ma limit 100`)).map(r => r.id)
    // 1000 món × 100 vật tư = 100k dòng du_kien (unique theo mon+vt)
    await q(`insert into kho.don_hang_mon_bom(mon_id, vat_tu_id, so_luong, don_vi, nguon, moc)
      select m.id, v.id, 1, 'c', 'go_tay', 'du_kien'
      from kho.don_hang_mon m cross join unnest($2::uuid[]) v(id) where m.don_id=$1`, [dPerf, vt100])
    await q(`analyze kho.don_hang_mon_bom`)
    const tong = Number((await one(`select count(*) c from kho.don_hang_mon_bom`)).c)
    // đơn NHỎ (test a-c) giữa 100k → bom_don_ds nhanh nhờ index mon_id
    const exMs = async (sql, a = []) => Number((await as(U.kho, `explain (analyze, format json) ${sql}`, a)).r[0]['QUERY PLAN'][0]['Execution Time'])
    const ms1 = await exMs(`select * from kho.bom_don_ds($1,'du_kien')`, [DON])
    const ms2 = await exMs(`select * from kho.don_hang_mon_bom where vat_tu_id=$1 and moc='du_kien'`, [V0])
    ok(`#i (${tong} dòng) bom_don_ds 1 đơn nhỏ = ${ms1.toFixed(0)}ms < 500`, ms1 < 500, ms1 + 'ms')
    ok(`#i query vat_tu_id+moc = ${ms2.toFixed(0)}ms < 500`, ms2 < 500, ms2 + 'ms') }

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_128: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); console.log('xác nhận: tx ROLLBACK — không để lại đơn/món/BOM test.'); process.exit(F === 0 ? 0 : 1) }
