// TEST CẮN — 082 · tien_do_tem (bảng suy ra) khớp sổ + dựng lại + chặn không đụng. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const NS = ['600286f2-2482-4dff-b0a4-a3183740be56', 'fc206d9e-5051-4e9a-a84b-0729f86ef70c', '5006d61d-8237-4ad7-9df6-32df821bb21b']
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null, rc = 0
  try { const x = await c.query(s, a); r = x.rows; rc = x.rowCount; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e, rc }
}
const quet = (tram, tem) => asK(CEO, `select kho.quet_tem($1,$2) g`, [tem, tram]).then(x => x.r ? x.r[0].g : { ok: null, e: x.e })
const TR = { cat: 'TRAM-CAT-01', dan: 'TRAM-DAN-01', thung: 'TRAM-THUNG-01' }

try {
  await c.query('begin')
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QT2','3 bước')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_moi_don_vi) values
    ('QT2',100,'{}','chung','cat','nguoi',0.1),('QT2',200,'{100}','chung','dan','nguoi',0.1),('QT2',300,'{200}','chung','thung','nguoi',0.1)`)
  const don = (await q(`insert into kho.don_hang(ma_don,trang_thai) values('T82','dang_lam') returning id`))[0].id
  const mon = (await q(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'m','QT2') returning id`, [don]))[0].id
  for (let i = 0; i < 20; i++) await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T82',1,$1,'hong',$2)`, ['T82-' + i, mon])
  let i = 0; for (const t of [TR.cat, TR.dan, TR.thung]) await c.query(`insert into kho.ca_lam(nguoi_id,ma_tram) values($1,$2)`, [NS[i++], t])

  // ═══ 4 · tien_do_tem KHỚP với suy trực tiếp từ sổ ═══
  console.log('\n── 4 · quét 20 tem qua vài bước → tien_do_tem khớp suy-từ-sổ ──')
  for (let k = 0; k < 20; k++) {
    const t = 'T82-' + k
    await quet(TR.cat, t); await quet(TR.cat, t)                 // cat vào+ra
    if (k >= 7) { await quet(TR.dan, t) }                        // 7..19: dan vào
    if (k >= 14) { await quet(TR.dan, t); await quet(TR.thung, t); await quet(TR.thung, t) }  // 14..19: dan ra + thung vào+ra → xong hết
  }
  // so_buoc_xong + trang_thai suy trực tiếp (đếm distinct bước có 'ra'; mở vào = dang_lam; hết bước = xong_het)
  const lech = await q(`
    with derive as (
      select tv.ma_tam,
        (select count(distinct b.thu_tu) from kho.quy_trinh_buoc b join kho.tram tr on tr.hoat_dong=b.hoat_dong
           join kho.su_kien_quet sq on sq.ma_tram=tr.ma_tram and sq.tem_ma=tv.ma_tam and sq.loai='ra' and sq.ket_qua='nhan'
           where b.ma_quy_trinh='QT2') as xong,
        exists(select 1 from kho.su_kien_quet sq where sq.tem_ma=tv.ma_tam and sq.ket_qua='nhan'
               group by sq.ma_tram having count(*) filter(where sq.loai='vao')>count(*) filter(where sq.loai='ra')) as dang
      from kho.tem_ban_ve tv where tv.ma_don='T82')
    select d.ma_tam, d.xong exp_xong, td.so_buoc_xong got_xong,
      case when d.xong>=3 then 'xong_het' when d.dang then 'dang_lam' else 'cho_vao' end exp_tt, td.trang_thai got_tt
    from derive d join kho.tien_do_tem td on td.tem_ma=d.ma_tam
    where d.xong <> td.so_buoc_xong or (case when d.xong>=3 then 'xong_het' when d.dang then 'dang_lam' else 'cho_vao' end) <> td.trang_thai`)
  const nTD = (await q(`select count(*) n from kho.tien_do_tem where ma_don='T82'`))[0].n
  console.log(`   tien_do_tem: ${nTD} dòng · lệch: ${lech.length} tem`)
  ok('#4 tien_do_tem khớp suy-từ-sổ mọi tem (🟥 lệch 1 tem = ĐỎ)', Number(nTD) === 20 && lech.length === 0)

  // ═══ 5 · DỰNG LẠI từ sổ = y hệt (bảng suy ra, không phải nguồn thứ hai) ═══
  console.log('\n── 5 · xoá sạch tien_do_tem → dung_lai_tien_do() → y hệt trước khi xoá ──')
  const truoc = await q(`select tem_ma,trang_thai,so_buoc_xong,buoc_hien_tai,to_hien_tai from kho.tien_do_tem where ma_don='T82' order by tem_ma`)
  const rb = await asK(CEO, `select kho.dung_lai_tien_do() g`)
  const sau = await q(`select tem_ma,trang_thai,so_buoc_xong,buoc_hien_tai,to_hien_tai from kho.tien_do_tem where ma_don='T82' order by tem_ma`)
  const giong = JSON.stringify(truoc) === JSON.stringify(sau)
  console.log(`   dung_lai ghi ${rb.r[0].g} dòng · T82: trước ${truoc.length} / sau ${sau.length} · GIỐNG HỆT: ${giong}`)
  console.log('   mẫu (3 tem): ' + sau.slice(0, 3).map(r => r.tem_ma + '=' + r.trang_thai + '/' + r.so_buoc_xong + 'b→' + (r.to_hien_tai || '·')).join(' · '))
  ok('#5 dựng lại từ sổ = y hệt (🟥 lệch = bảng thành nguồn thứ hai = ĐỎ)', giong && truoc.length === 20)

  // ═══ 6 · QUÉT BỊ CHẶN KHÔNG ĐỤNG tien_do_tem ═══
  console.log('\n── 6 · quét nhảy bước (chặn) → sổ có dòng chặn, tien_do_tem KHÔNG đổi ──')
  const tdTruoc = await q(`select * from kho.tien_do_tem where tem_ma='T82-0'`)
  const rC = await quet(TR.thung, 'T82-0')   // T82-0 mới xong cat → nhảy tới thung (chưa qua dan) → NHAY_BUOC
  const chan = Number((await q(`select count(*) n from kho.su_kien_quet where tem_ma='T82-0' and ket_qua='chan'`))[0].n)
  const tdSau = await q(`select * from kho.tien_do_tem where tem_ma='T82-0'`)
  console.log(`   quét thung → ok=${rC.ok} loi=${rC.loi} · sổ chặn=${chan} · tien_do_tem đổi: ${JSON.stringify(tdTruoc) !== JSON.stringify(tdSau)}`)
  ok('#6 chặn → sổ ghi chặn nhưng tien_do_tem NGUYÊN (🟥 đổi = ĐỎ)',
    rC.ok === false && chan === 1 && JSON.stringify(tdTruoc) === JSON.stringify(tdSau))

  // ═══ 7 · SỔ VẪN BẤT BIẾN ═══
  console.log('\n── 7 · ceo UPDATE/DELETE su_kien_quet → 0 dòng ──')
  const rid = (await q(`select id from kho.su_kien_quet where tem_ma='T82-0' limit 1`))[0].id
  const up = await asK(CEO, `update kho.su_kien_quet set so_hong=9 where id=$1`, [rid])
  const del = await asK(CEO, `delete from kho.su_kien_quet where id=$1`, [rid])
  console.log(`   UPDATE ${up.rc} · DELETE ${del.rc} dòng`)
  ok('#7 sổ bất biến: ceo UPDATE 0 + DELETE 0 (🟥 sửa được = ĐỎ)', up.rc === 0 && del.rc === 0)

  console.log(`\n══ KẾT QUẢ 082: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
