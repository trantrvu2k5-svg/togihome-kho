// TEST WP-91 N-06 (L-91d) — đơn HẾT ĐƯỜNG SẢN XUẤT rời xep_lich. MỘT transaction, ROLLBACK sạch.
// DB rỗng → tự dựng đơn + xep_lich (test trigger GỠ + readers, KHÔNG test scheduler; chèn xep_lich trực tiếp là hợp lệ cho fixture).
// Mỗi ca 1 TUẦN riêng + tổ 'cnc' để đo v_tai (=sum gio, đúng cái vung_cua_tuan dùng) tách bạch. gio=300 > 90%×246 → 'day'.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const q = async (s,p=[]) => (await c.query(s,p)).rows
const one = async (s,p=[]) => (await q(s,p))[0]
const R = []; const ok=(n,d)=>R.push(['✅',n,d]); const bad=(n,d)=>R.push(['❌',n,d]); const info=(n,d)=>R.push(['ℹ️',n,d])
const catchErr = async fn => { try { await fn(); return null } catch(e){ return e.message.split('\n')[0] } }
const GIO = 300

// dựng 1 đơn + 1 dòng xep_lich ở tuần (offset ngày) trên tổ cnc
async function dungDon(ma, tt, offDays, ceo) {
  await q(`insert into kho.don_hang(ma_don,dong,trang_thai,gia_chot,la_demo) values($1,'le',$2,500000,true)`,[ma,tt])
  await q(`insert into kho.xep_lich(ma_don,buoc_thu_tu,hoat_dong,loai_buoc,tuan_bat_dau,ma_to,gio,kieu_xep,xep_boi)
           values($1,1,'cnc','nguoi', kho.tuan_cua(current_date)+($2::int), 'cnc', $3, 'xuoi', $4)`,[ma,offDays,GIO,ceo.id])
  return (await one(`select (kho.tuan_cua(current_date)+($1::int))::text w`,[offDays])).w
}
const vtai   = async w => Number((await one(`select coalesce(sum(gio),0) g from kho.xep_lich where ma_to='cnc' and tuan_bat_dau=$1`,[w])).g)
const nrows  = async ma => Number((await one(`select count(*) n from kho.xep_lich where ma_don=$1`,[ma])).n)
const zone   = async w => (await one(`select kho.vung_cua_tuan($1) z`,[w])).z
const inScan = async ma => Number((await one(`select count(*) n from (select distinct ma_don from kho.xep_lich) s where ma_don=$1`,[ma])).n) // tập nut_that_ghi quét

try {
  await c.query('begin')
  const ceo = await one(`select id, auth_uid from kho.nguoi_dung where vai_tro='ceo' and dang_hoat_dong limit 1`)
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({sub: ceo.auth_uid, role:'authenticated'})])
  for (const g of ['chan.off_von','chan.off_nguon','chan.off_thuonghieu','chan.off_lui','chan.off_nhay']) await c.query(`select set_config($1,'1',true)`,[g])

  // ══ Ca A — HUỶ (đã bàn giao + đã xếp) ══
  const wA = await dungDon('ZZGL-A','cho_cat',35,ceo)
  const A0={r:await nrows('ZZGL-A'), t:await vtai(wA), z:await zone(wA), s:await inScan('ZZGL-A')}
  await q(`update kho.don_hang set trang_thai='huy', ly_do_huy='khách rút' where ma_don='ZZGL-A'`)
  const A1={r:await nrows('ZZGL-A'), t:await vtai(wA), z:await zone(wA), s:await inScan('ZZGL-A')}
  info('Ca A HUỶ số', `xep_lich ${A0.r}→${A1.r} · tải(cnc,tuần) ${A0.t}→${A1.t} phút · vùng ${A0.z}→${A1.z} · trong-tập-nút-thắt ${A0.s}→${A1.s}`)
  if (A1.r===0 && A1.t===A0.t-GIO && A0.z==='day' && A1.z==='mo' && A1.s===0)
    ok('Ca A HUỶ', `rời xep_lich sạch, tải giảm đúng ${GIO} phút, vùng day→mo, rời tập nút thắt`)
  else bad('Ca A HUỶ', `mong 0 dòng / tải −${GIO} / day→mo / rời-nút-thắt`)

  // ══ Ca B — THUA BÁO GIÁ ══
  const wB = await dungDon('ZZGL-B','bao_gia',42,ceo)
  const B0={r:await nrows('ZZGL-B'), t:await vtai(wB)}
  const errB = await catchErr(async()=>{ await q(`update kho.don_hang set trang_thai='bao_gia_thua', ly_do_thua='gia_cao' where ma_don='ZZGL-B'`) })
  const B1={r:await nrows('ZZGL-B'), t:await vtai(wB)}
  info('Ca B THUA số', `xep_lich ${B0.r}→${B1.r} · tải ${B0.t}→${B1.t}${errB?' · LỖI:'+errB:''}`)
  if (!errB && B1.r===0 && B1.t===B0.t-GIO) ok('Ca B THUA', `bao_gia_thua → rời xep_lich sạch, tải giảm ${GIO}`)
  else bad('Ca B THUA', `err=${errB} · dòng ${B1.r} · tải ${B1.t}`)

  // ══ Ca C — TẠM NGƯNG (đối chứng: GIỮ NGUYÊN) ══
  const wC = await dungDon('ZZGL-C','cho_cat',49,ceo)
  const C0={r:await nrows('ZZGL-C'), t:await vtai(wC), z:await zone(wC)}
  await q(`update kho.don_hang set trang_thai='tam_ngung', ly_do_huy='chờ khách chốt mẫu' where ma_don='ZZGL-C'`)
  const C1={r:await nrows('ZZGL-C'), t:await vtai(wC), z:await zone(wC)}
  info('Ca C TẠM NGƯNG số', `xep_lich ${C0.r}→${C1.r} · tải ${C0.t}→${C1.t} · vùng ${C0.z}→${C1.z}`)
  if (C1.r===C0.r && C1.t===C0.t && C1.z===C0.z) ok('Ca C TẠM NGƯNG (đối chứng)', `GIỮ NGUYÊN lịch + tải (QD-52)`)
  else bad('Ca C TẠM NGƯNG', `bị gỡ nhầm: dòng ${C0.r}→${C1.r}, tải ${C0.t}→${C1.t}`)

  // ══ Ca D — đơn bình thường đang chạy (không gỡ nhầm) ══
  const wD = await dungDon('ZZGL-D','cho_cat',56,ceo)
  const D0=await nrows('ZZGL-D')
  await q(`update kho.don_hang set trang_thai='dang_lam' where ma_don='ZZGL-D'`)
  const D1=await nrows('ZZGL-D')
  if (D1===D0 && D1>0) ok('Ca D đang chạy', `cho_cat→dang_lam GIỮ lịch (${D1} dòng) — không gỡ nhầm`)
  else bad('Ca D đang chạy', `dòng ${D0}→${D1}`)

  // ══ Ca E — gọi lại lần hai trên đơn đã gỡ (idempotent) ══
  const errE = await catchErr(async()=>{ await q(`update kho.don_hang set trang_thai='huy', ly_do_huy='khách rút' where ma_don='ZZGL-A'`) })
  const E1={r:await nrows('ZZGL-A'), t:await vtai(wA)}
  if (!errE && E1.r===0 && E1.t===A1.t) ok('Ca E idempotent', `re-update huy: không lỗi, 0 dòng, tải không đổi`)
  else bad('Ca E idempotent', `err=${errE} · dòng ${E1.r} · tải ${E1.t}`)

  // ══ CHỨNG MINH ĐỎ — bẻ trigger thành no-op → Ca A phải ĐỎ ══
  await q('savepoint sp_red')
  await q(`create or replace function kho.go_lich_don_chet() returns trigger language plpgsql security definer set search_path to 'kho' as $f$ begin return new; end $f$`)
  const wR = await dungDon('ZZGL-R','cho_cat',63,ceo)
  const R0=await vtai(wR)
  await q(`update kho.don_hang set trang_thai='huy', ly_do_huy='khách rút' where ma_don='ZZGL-R'`)
  const RR={r:await nrows('ZZGL-R'), t:await vtai(wR), z:await zone(wR)}
  if (RR.r>0 && RR.t===R0 && RR.z==='day')
    ok('CHỨNG MINH ĐỎ', `bẻ gỡ ra → đơn ĐÃ HUỶ mà tải CÒN ${RR.t} phút (${RR.r} dòng, vùng vẫn '${RR.z}') — đúng câu "tải còn X phút của đơn đã huỷ"`)
  else bad('CHỨNG MINH ĐỎ', `bẻ ra mà vẫn sạch (dòng ${RR.r}, tải ${RR.t}) — test vô dụng`)
  await q('rollback to savepoint sp_red')   // trả lại trigger db/253

} catch (e) {
  R.push(['❌','LỖI SETUP/CHẠY', (e.message||String(e)).split('\n')[0]])
} finally {
  await c.query('rollback')
  console.log('\n╔══ TEST WP-91 N-06 — gỡ xep_lich khi đơn chết (transaction ROLLBACK) ══╗')
  for (const [s,n,d] of R) console.log(`  ${s} ${n}${d?'  —  '+d:''}`)
  const fail=R.filter(r=>r[0]==='❌').length, pass=R.filter(r=>r[0]==='✅').length
  console.log(`╚══ ${pass} PASS · ${fail} FAIL ══╝`)
  await c.end(); process.exit(fail?1:0)
}
