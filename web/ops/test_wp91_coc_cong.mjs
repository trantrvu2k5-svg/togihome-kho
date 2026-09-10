// TEST WP-91 P1 (L-91c) — cửa CỌC chọn kỳ qua kho.ky_gia_hien_hanh(). MỘT transaction, ROLLBACK sạch.
// Ca A: kỳ CŨ (2026-07) xác nhận coc=30 · kỳ MỚI HƠN (2026-09, current month) CHƯA xác nhận coc=50
//        → cửa cọc chạy theo 30 (gate), KHÔNG theo 50. + CHỨNG MINH ĐỎ: bẻ hàm về to_char(current_date) → lật.
// Ca B: không kỳ nào xác nhận → dự phòng kỳ mới nhất (thân ky_gia_hien_hanh), KHÔNG raise.
// Ca C: bảng rỗng → RAISE THIEU_NGUONG_COC, không im lặng.
// Ca D: đơn dự án thiếu cọc → ban_giao_xuong CHẶN (THIEU_COC theo ngưỡng gate 30); CEO có lý do → mở + GHI VẾT.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const q = async (s,p=[]) => (await c.query(s,p)).rows
const one = async (s,p=[]) => (await q(s,p))[0]
const R = []; const ok=(n,d)=>R.push(['✅',n,d]); const bad=(n,d)=>R.push(['❌',n,d])
const catchErr = async fn => { try { await fn(); return null } catch(e){ return e.message } }

try {
  await c.query('begin')
  const ceo = await one(`select id, auth_uid from kho.nguoi_dung where vai_tro='ceo' and dang_hoat_dong limit 1`)
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({sub: ceo.auth_uid, role:'authenticated'})])
  await c.query(`select set_config('chan.off_von','1',true)`)     // bỏ qua cửa GIÁ VỐN du_an (db/048) — trực giao với cửa CỌC
  await c.query(`select set_config('chan.off_nguon','1',true)`)       // bỏ qua cửa NGUỒN KHÁCH (db/111/115) — trực giao
  await c.query(`select set_config('chan.off_thuonghieu','1',true)`)  // bỏ qua cửa THƯƠNG HIỆU (db/115) — trực giao

  // ── SETUP kỳ ──
  await q(`update kho.tham_so_tai_chinh set coc_toi_thieu_du_an_pct=30, xac_nhan_luc=now() where ma_ky='2026-07'`)
  await q(`update kho.tham_so_tai_chinh set coc_toi_thieu_du_an_pct=30, xac_nhan_luc=null where ma_ky='2026-08'`)
  await q(`update kho.tham_so_tai_chinh set coc_toi_thieu_du_an_pct=50, xac_nhan_luc=null where ma_ky='2026-09'`)
  const gate1 = (await one(`select kho.ky_gia_hien_hanh() k`)).k
  const cm = (await one(`select to_char(current_date,'YYYY-MM') k`)).k
  R.push(['ℹ️','gate=confirmed-latest', `ky_gia_hien_hanh()=${gate1} (coc 30) · current-month(bản cũ)=${cm} (coc 50)`])
  if (gate1 !== '2026-07') bad('gate chọn kỳ xác nhận', `mong 2026-07, ra ${gate1}`)
  else ok('gate chọn kỳ 2026-07 (đã xác nhận), BỎ QUA 08/09 mới hơn chưa soát', '')

  // ── đơn dự án ZZTEST-A cho vuot_coc_canh_bao ──
  await q(`insert into kho.don_hang(ma_don,dong,trang_thai,gia_chot,vuot_coc_boi,vuot_coc_luc,la_demo)
           values('ZZTEST-A','du_an','moi_len_don',1000000,$1,now(),true)`,[ceo.id])
  const gia = Number((await one(`select kho.gia_don(gia_chot,doanh_thu,gia_cong_thuc) g from kho.don_hang where ma_don='ZZTEST-A'`)).g)
  const need30 = Math.round(gia*30/100), need50 = Math.round(gia*50/100)
  const coc = Math.round((need30+need50)/2)   // GIỮA 30% và 50% → hai luật cho hai kết quả khác nhau
  await q(`insert into kho.phieu_thu(ma_don,ngay,so_tien,loai) values('ZZTEST-A',current_date,$1,'coc')`,[coc])
  R.push(['ℹ️','ZZTEST-A', `gia=${gia} · cần30%=${need30} · cần50%=${need50} · đã cọc=${coc} (giữa hai mốc)`])

  // ── Ca A (bản MỚI) ── coc gate=30 → cọc ≥ need30 → KHÔNG cảnh báo vượt-cọc = false
  const caA_new = (await one(`select kho.vuot_coc_canh_bao('ZZTEST-A') v`)).v
  if (caA_new === false) ok('Ca A bản MỚI', `vuot_coc_canh_bao=false (đã cọc ${coc} ≥ ngưỡng30 ${need30}) — chạy theo kỳ xác nhận`)
  else bad('Ca A bản MỚI', `mong false, ra ${caA_new}`)

  // ── Ca A CHỨNG MINH ĐỎ ── bẻ hàm về to_char(current_date) → coc=50 → cọc < need50 → true (BẢN CŨ SAI)
  await q('savepoint sp_red')
  await q(`create or replace function kho.vuot_coc_canh_bao(p_ma_don text) returns boolean language sql stable security definer set search_path to 'kho' as $f$
    select d.vuot_coc_boi is not null and coalesce((select sum(so_tien) from kho.phieu_thu where ma_don=p_ma_don and loai='coc'),0)
      < round(kho.gia_don(d.gia_chot,d.doanh_thu,d.gia_cong_thuc) *
          coalesce((select coc_toi_thieu_du_an_pct from kho.tham_so_tai_chinh where ma_ky=to_char(current_date,'YYYY-MM')),
                   (select coc_toi_thieu_du_an_pct from kho.tham_so_tai_chinh order by ngay_ap_dung desc, ma_ky desc limit 1),30)/100.0,0)
    from kho.don_hang d where d.ma_don=p_ma_don $f$`)
  const caA_old = (await one(`select kho.vuot_coc_canh_bao('ZZTEST-A') v`)).v
  if (caA_old === true) ok('Ca A CHỨNG MINH ĐỎ', `bẻ về to_char(current_date=${cm},coc 50) → vuot_coc_canh_bao=true (cọc ${coc} < ngưỡng50 ${need50}) — BẢN CŨ SAI, đúng như dự đoán`)
  else bad('Ca A CHỨNG MINH ĐỎ', `bản cũ đáng lẽ true, ra ${caA_old} — không chứng minh được đỏ`)
  await q('rollback to savepoint sp_red')   // trả lại bản db/252

  // ── Ca B ── không kỳ nào xác nhận → dự phòng kỳ mới nhất (2026-09 coc=50) → cọc < need50 → true, KHÔNG raise
  await q('savepoint sp_b')
  await q(`update kho.tham_so_tai_chinh set xac_nhan_luc=null`)
  const gateB = (await one(`select kho.ky_gia_hien_hanh() k`)).k
  const errB = await catchErr(async()=>{ const v=(await one(`select kho.vuot_coc_canh_bao('ZZTEST-A') v`)).v; R.push(['ℹ️','Ca B trả', `gate=${gateB} → vuot_coc_canh_bao=${v}`]) })
  if (errB === null && gateB==='2026-09') ok('Ca B dự phòng', `không kỳ xác nhận → gate rơi về kỳ MỚI NHẤT ${gateB} (coc 50), KHÔNG raise`)
  else bad('Ca B dự phòng', `gate=${gateB} · err=${errB}`)
  await q('rollback to savepoint sp_b')

  // ── Ca C ── bảng rỗng → RAISE
  await q('savepoint sp_c')
  let modeC = 'xoá bảng'
  let delErr = await catchErr(async()=>{ await q(`delete from kho.tham_so_tai_chinh`) })
  if (delErr) { modeC = 'set coc=NULL (xoá vướng FK: '+delErr.split('\n')[0]+')'; await q(`update kho.tham_so_tai_chinh set coc_toi_thieu_du_an_pct=null`) }
  const errC = await catchErr(async()=>{ await one(`select kho.vuot_coc_canh_bao('ZZTEST-A') v`) })
  if (errC && /THIEU_NGUONG_COC/.test(errC)) ok('Ca C bảng rỗng→RAISE', `[${modeC}] → ${errC.split('\n')[0]} (KHÔNG im lặng dùng 30)`)
  else bad('Ca C bảng rỗng→RAISE', `mong RAISE THIEU_NGUONG_COC, ra: ${errC||'(không raise)'}`)
  await q('rollback to savepoint sp_c')

  // ═══ Ca D — ban_giao_xuong đường nóng ═══
  await q(`insert into kho.don_hang(ma_don,dong,trang_thai,gia_chot,la_demo) values('ZZTEST-D','du_an','moi_len_don',1000000,true)`)
  const don = await one(`select id from kho.don_hang where ma_don='ZZTEST-D'`)
  const mon = await one(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Kệ test','KE-HO-MELAMINE') returning id`,[don.id])
  // đủ số cho từng bước NGƯỜI + đảm bảo mau_so>0
  await q(`update kho.don_gia_baseline set mau_so=1 where (mau_so is null or mau_so=0)
           and hoat_dong in (select hoat_dong from kho.buoc_cua_mon($1) where loai_buoc='nguoi')`,[mon.id])
  await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,nguon,moc)
           select $1,hoat_dong,1,'go_tay','chuan' from kho.buoc_cua_mon($1) where loai_buoc='nguoi'`,[mon.id])
  await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values('ZZTEST-D',1,$1,'khach_duyet')`,[ceo.id])
  const gdk = await one(`select kho.gio_du_kien_cua_mon($1,'chuan') g`,[mon.id])
  R.push(['ℹ️','ZZTEST-D món', `gio_du_kien ok=${gdk.g.ok} · thieu=${JSON.stringify(gdk.g.thieu)}`])
  const files = JSON.stringify([{loai_file:'dxf',duong_dan:'test.dxf',ten_goc:'test.dxf',co_byte:10}])

  // D1: cọc 0, không lý do → THIEU_COC theo ngưỡng gate 30
  await q('savepoint sp_d1')
  const errD1 = await catchErr(async()=>{ await q(`select kho.ban_giao_xuong('ZZTEST-D',$1::jsonb,null,null)`,[files]) })
  const cocD1 = need30
  if (errD1 && /THIEU_COC/.test(errD1) && /ngưỡng 30 phần trăm/.test(errD1))
    ok('Ca D chặn thiếu cọc', `${errD1.split('\n')[0].slice(0,140)} — ngưỡng 30% (gate), KHÔNG 50%`)
  else bad('Ca D chặn thiếu cọc', `mong THIEU_COC ngưỡng 30 phần trăm, ra: ${errD1||'(không chặn!)'}`)
  await q('rollback to savepoint sp_d1')

  // D2: CEO có lý do vượt cọc → mở + GHI VẾT
  await q('savepoint sp_d2')
  const errD2 = await catchErr(async()=>{ await q(`select kho.ban_giao_xuong('ZZTEST-D',$1::jsonb,null,'CEO duyệt vượt cọc — khách cam kết chuyển bù')`,[files]) })
  const d2 = await one(`select trang_thai, vuot_coc_boi, vuot_coc_luc, vuot_coc_ly_do from kho.don_hang where ma_don='ZZTEST-D'`)
  if (!errD2 && d2.trang_thai==='cho_cat' && d2.vuot_coc_boi && d2.vuot_coc_luc && d2.vuot_coc_ly_do)
    ok('Ca D cửa vượt CEO + ghi vết', `trang_thai=${d2.trang_thai} · vuot_coc_boi=${String(d2.vuot_coc_boi).slice(0,8)}… · ly_do="${d2.vuot_coc_ly_do.slice(0,40)}…"`)
  else bad('Ca D cửa vượt CEO + ghi vết', `err=${errD2} · trang_thai=${d2.trang_thai} · boi=${d2.vuot_coc_boi} · luc=${d2.vuot_coc_luc} · ly_do=${d2.vuot_coc_ly_do}`)
  await q('rollback to savepoint sp_d2')

} catch (e) {
  R.push(['❌','LỖI SETUP/CHẠY', (e.message||String(e)).split('\n')[0]])
} finally {
  await c.query('rollback')   // dọn TẤT CẢ — không ghi gì thật
  console.log('\n╔══ TEST WP-91 P1 — cửa cọc qua ky_gia_hien_hanh() (transaction đã ROLLBACK) ══╗')
  for (const [s,n,d] of R) console.log(`  ${s} ${n}${d?'  —  '+d:''}`)
  const fail = R.filter(r=>r[0]==='❌').length, pass = R.filter(r=>r[0]==='✅').length
  console.log(`╚══ ${pass} PASS · ${fail} FAIL ══╝`)
  await c.end(); process.exit(fail?1:0)
}
