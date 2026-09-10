// BƯỚC 4 (L-91c) — chạy ĐÚNG bước BÀN GIAO XƯỞNG (ban_giao_xuong, như demo_phong_hop BƯỚC 4) LIVE-trong-txn,
//   ĐẾM dòng phát sinh trong giao_dich / su_kien_quet quanh lời gọi. demo_phong_hop.py KHÔNG có bộ chạy-1-bước
//   (nó là CẢ VÒNG 10 bước) nên theo lệnh "không chạy cả vòng" ta gọi thẳng RPC bàn giao. Rollback sạch.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const q = async (s,p=[]) => (await c.query(s,p)).rows
const one = async (s,p=[]) => (await q(s,p))[0]
const cnt = async () => ({
  gd: Number((await one(`select count(*) n from kho.giao_dich`)).n),
  sk: Number((await one(`select count(*) n from kho.su_kien_quet`)).n),
})
let app_fail = null, harness_fail = null
try {
  await c.query('begin')
  const ceo = await one(`select id, auth_uid from kho.nguoi_dung where vai_tro='ceo' and dang_hoat_dong limit 1`)
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({sub: ceo.auth_uid, role:'authenticated'})])
  for (const g of ['chan.off_von','chan.off_nguon','chan.off_thuonghieu']) await c.query(`select set_config($1,'1',true)`,[g])
  // kỳ: 2026-07 xác nhận coc=30 (cửa cọc chạy theo gate)
  await q(`update kho.tham_so_tai_chinh set coc_toi_thieu_du_an_pct=30, xac_nhan_luc=now() where ma_ky='2026-07'`)
  // đơn 'le' DEMO (le_mau → bỏ qua khách-duyệt; dong='le' → KHÔNG qua cửa cọc — đây là đường thường của bàn giao)
  await q(`insert into kho.don_hang(ma_don,dong,trang_thai,gia_chot,la_demo) values('ZZDEMO-BG','le','moi_len_don',500000,true)`)
  const mon = await one(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) select id,'Kệ demo','KE-HO-MELAMINE' from kho.don_hang where ma_don='ZZDEMO-BG' returning id`)
  await q(`update kho.don_gia_baseline set mau_so=1 where (mau_so is null or mau_so=0) and hoat_dong in (select hoat_dong from kho.buoc_cua_mon($1) where loai_buoc='nguoi')`,[mon.id])
  await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,nguon,moc) select $1,hoat_dong,1,'go_tay','chuan' from kho.buoc_cua_mon($1) where loai_buoc='nguoi'`,[mon.id])
  const files = JSON.stringify([{loai_file:'dxf',duong_dan:'demo.dxf',ten_goc:'demo.dxf',co_byte:10}])

  const before = await cnt()
  let res
  try {
    res = await one(`select kho.ban_giao_xuong('ZZDEMO-BG',$1::jsonb,'bàn giao demo',null) r`,[files])
  } catch (e) { app_fail = e.message.split('\n')[0] }
  const after = await cnt()
  const tt = (await one(`select trang_thai from kho.don_hang where ma_don='ZZDEMO-BG'`)).trang_thai

  console.log('\n╔══ BƯỚC 4 — bước BÀN GIAO XƯỞNG (ban_giao_xuong) chạy LIVE-trong-txn (rollback) ══╗')
  if (app_fail) console.log(`  ❌ bàn giao FAIL (app): ${app_fail}`)
  else {
    console.log(`  ✅ bàn giao PASS (app): ZZDEMO-BG moi_len_don → ${tt} · so_file=${res.r.so_file} · da_xep=${res.r.da_xep}`)
    console.log(`  giao_dich:    ${before.gd} → ${after.gd}  (Δ ${after.gd-before.gd})`)
    console.log(`  su_kien_quet: ${before.sk} → ${after.sk}  (Δ ${after.sk-before.sk})`)
    console.log(`  ghi chú: ban_giao_xuong KHÔNG ghi giao_dich/su_kien_quet trực tiếp (0 tham chiếu) — 2 bảng này do QUÉT TEM sinh (bước 7-8 của vòng, không chạy ở đây). Δ=0 là ĐÚNG.`)
  }
  console.log('╚══════════════════════════════════════════════════════════════════════╝')
} catch (e) {
  harness_fail = (e.message||String(e)).split('\n')[0]
  console.log(`\n⚠️ LỖI HARNESS (tách khỏi lỗi app): ${harness_fail}`)
} finally {
  await c.query('rollback')
  await c.end()
  process.exit(app_fail || harness_fail ? 1 : 0)
}
