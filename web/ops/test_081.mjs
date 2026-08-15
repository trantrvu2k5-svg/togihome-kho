// TEST CẮN — 081 · PARTITION su_kien_quet + RLS bất biến. Tx rollback. cd web && node ops/test_081.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6', NS = 'fc206d9e-5051-4e9a-a84b-0729f86ef70c'
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

try {
  await c.query('begin')

  // ═══ 1 · PHÂN MẢNH ĐÚNG THÁNG ═══
  console.log('\n── 1 · chèn 3 dòng luc 3 tháng → vào đúng phân mảnh tháng đó ──')
  const rows1 = await q(`insert into kho.su_kien_quet(tem_ma,ma_tram,loai,ket_qua,luc)
    values ('P1','TRAM-CAT-01','vao','nhan','2026-08-15'),('P2','TRAM-CAT-01','vao','nhan','2026-10-20'),('P3','TRAM-CAT-01','vao','nhan','2027-03-05')
    returning tem_ma, (tableoid::regclass)::text pm`)
  console.log('   ' + rows1.map(r => r.tem_ma + '→' + r.pm).join(' · '))
  const pm = Object.fromEntries(rows1.map(r => [r.tem_ma, r.pm]))
  ok('#1 mỗi dòng vào đúng phân mảnh tháng (🟥 sai phân mảnh = ĐỎ)',
    /2026_08$/.test(pm.P1) && /2026_10$/.test(pm.P2) && /2027_03$/.test(pm.P3))

  // ═══ 2 · DÒNG NGOÀI KHOẢNG → DEFAULT, KHÔNG TỪ CHỐI ═══
  console.log('\n── 2 · luc 2028-05 (ngoài 17 tháng) → phân mảnh DEFAULT, không bị từ chối ──')
  let d2err = null, d2pm = null
  try { d2pm = (await q(`insert into kho.su_kien_quet(tem_ma,ma_tram,loai,ket_qua,luc) values('PD','TRAM-CAT-01','vao','nhan','2028-05-15') returning (tableoid::regclass)::text pm`))[0].pm }
  catch (e) { d2err = e.message }
  console.log('   → ' + (d2err ? 'BỊ TỪ CHỐI ❌ ' + d2err : 'vào ' + d2pm))
  ok('#2 dòng ngoài khoảng → DEFAULT, KHÔNG từ chối (🟥 không có DEFAULT → từ chối = ĐỎ)', !d2err && /_default$/.test(d2pm))

  // ═══ 3 · SỔ VẪN KHÔNG SỬA ĐƯỢC (test quan trọng nhất — partition dễ rớt RLS) ═══
  console.log('\n── 3 · vai ceo UPDATE/DELETE → PHẢI BỊ TỪ CHỐI (RLS còn sau partition) ──')
  // ceo chèn 1 dòng (RLS insert cho phép vai != null)
  const ins = await asK(CEO, `insert into kho.su_kien_quet(tem_ma,ma_tram,loai,ket_qua,so_hong) values('RLS-1','TRAM-CAT-01','vao','nhan',0) returning id`)
  const rid = ins.r[0].id
  const up = await asK(CEO, `update kho.su_kien_quet set so_hong=99 where id=$1`, [rid])
  const del = await asK(CEO, `delete from kho.su_kien_quet where id=$1`, [rid])
  const conLai = await q(`select so_hong from kho.su_kien_quet where id=$1`, [rid])
  console.log(`   ceo UPDATE ảnh hưởng ${up.rc} dòng · DELETE ${del.rc} dòng · dòng còn: ${conLai.length ? 'CÒN (so_hong=' + conLai[0].so_hong + ')' : 'MẤT'}`)
  ok('#3 ceo UPDATE 0 dòng + DELETE 0 dòng + dòng NGUYÊN (🟥 sửa/xoá được = RLS RỚT = ĐỎ)',
    up.rc === 0 && del.rc === 0 && conLai.length === 1 && Number(conLai[0].so_hong) === 0)

  // ═══ 4 · QUÉT VẪN CHẠY (ghi + đọc lại qua bảng phân mảnh) ═══
  console.log('\n── 4 · quet_tem ghi được + đọc lại được qua bảng cha phân mảnh ──')
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QP','p')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_moi_don_vi) values('QP',100,'{}','chung','cat','nguoi',0.1)`)
  const don = (await q(`insert into kho.don_hang(ma_don,trang_thai) values('P81','dang_thiet_ke') returning id`))[0].id
  const mon = (await q(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'m','QP') returning id`, [don]))[0].id
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('P81',1,'P81-T','hong',$1)`, [mon])
  await c.query(`insert into kho.ca_lam(nguoi_id,ma_tram) values($1,'TRAM-CAT-01')`, [NS])
  const g = await asK(CEO, `select kho.quet_tem('P81-T','TRAM-CAT-01') g`)
  const doc = await q(`select count(*) n from kho.su_kien_quet where tem_ma='P81-T' and ket_qua='nhan'`)
  console.log(`   quet_tem → ok=${g.r?.[0].g.ok} · đọc lại su_kien_quet: ${doc[0].n} dòng`)
  ok('#4 quét ghi được + đọc lại được (🟥 partition làm hỏng quét = ĐỎ)', g.r?.[0].g.ok === true && Number(doc[0].n) === 1)

  console.log(`\n══ KẾT QUẢ 081: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
