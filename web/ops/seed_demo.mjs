// SEED DỮ LIỆU DEMO — 12 đơn phủ nhánh + aux (giá vốn/tem/phiếu đếm/lỗi/giờ TK/lương). la_demo=true.
//   Idempotent: chạy lại KHÔNG nhân (xoá sạch demo trước rồi dựng lại). Ky demo = 2099-08 (không đụng ky thật).
//   node ops/seed_demo.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const KY = '2099-08'
// ma_ns_* trỏ nguoi_dung.id (KHÔNG phải auth_uid) — lấy id của ceo
const CEO = (await c.query(`select id from kho.nguoi_dung where vai_tro='ceo' limit 1`)).rows[0].id
try {
  await c.query('begin')
  // bypass cổng (seed dựng thẳng trạng thái) — GUC transaction-local
  for (const g of ['chan.off_von','chan.off_von_chuyen','chan.off_vai','chan.off_mon_gia','chan.off_nhay','chan.off_lui','chan.tu_mon'])
    await c.query(`select set_config($1,'1',true)`, [g])
  // ── XOÁ demo cũ (idempotent) ──
  await c.query(`delete from kho.don_hang where la_demo = true`)                 // cascade món/giá vốn/tem_ban_ve/nhật ký
  await c.query(`delete from kho.phieu_dem_ngay where la_demo = true`)
  await c.query(`delete from kho.lan_in_tem where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.tem_da_in where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.loi_lam_lai where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.gio_thiet_ke_thuc where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.san_luong_don where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.luong_to where ma_ky=$1`, [KY])
  await c.query(`delete from kho.phan_bo_hoat_dong where ma_ky=$1`, [KY])

  const don = async (ma, dong, loai, tt, x = {}) => {
    const cols = ['ma_don','dong','loai','trang_thai','la_demo','ma_ky_ap_dung','ten_khach','sdt_khach','dia_chi_khach','ghi_chu']
    const vals = [ma, dong, loai, tt, true, KY, x.khach || 'Khách demo', '0900000000', 'Địa chỉ demo', x.ghi_chu || null]
    const extra = { ngay_chot:x.chot, ngay_vao_chuyen:x.vc, ngay_xong:x.xong, ngay_giao:x.giao, ngay_du_kien:x.dukien,
      ngay_hen_khach:x.hen, ngay_hen_khach_ban_dau:x.henbd, gia_cong_thuc:x.gct, gia_chot:x.chotgia, gio_thiet_ke:x.gio,
      cap_thiet_ke:x.cap, danh_dau_gap:x.gap, ly_do_gap:x.lygap, ma_ns_danh_dau:x.gap?CEO:null, gap_luc:x.gap?'now()':null,
      ly_do_thua:x.thua, gia_goc:x.goc, chiet_khau:x.goc?0:null, doanh_thu:x.goc }
    for (const [k,v] of Object.entries(extra)) if (v!==undefined && v!==null) { cols.push(k); vals.push(v==='now()'?new Date().toISOString():(typeof v==='string'&&v.startsWith('current_date')?null:v)); if(typeof v==='string'&&v.startsWith('current_date')){ vals[vals.length-1]=undefined; } }
    // build with SQL expressions for current_date-N
    const parts=[], args=[]; let i=1
    const push=(col,val,expr)=>{ parts.push(`${col}=${expr?val:'$'+(i)}`); if(!expr){args.push(val);i++} }
    return { ma }
  }
  // đơn giản hoá: insert từng đơn bằng SQL rõ ràng
  const ins = (sql, a=[]) => c.query(sql, a)
  const mon = (ma, ten, tt, extra='') => ins(
    `insert into kho.don_hang_mon(don_id,ten,vl,kt,ma_mau,so_luong,chi_tiet,trang_thai,gia)
       select id,$2,'MDF17','1000x600x2000','N01',1,$3,$4,5000000 from kho.don_hang where ma_don=$1`, [ma, ten, extra, tt])

  // 1. Lẻ có mẫu sẵn (L1) — đã giao, có ngày thực tế
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,
    ngay_chot,ngay_vao_chuyen,ngay_xong,ngay_giao,ngay_du_kien,ngay_hen_khach,ngay_hen_khach_ban_dau,gio_thiet_ke,cap_thiet_ke,gia_cong_thuc,gia_chot)
    values('DEMO-01','le','le_sang','da_giao',true,$1,'A demo','0900000001','HN',
    current_date-20,current_date-18,current_date-10,current_date-9,current_date-11,current_date-9,current_date-12,2.5,'co_file_san',12000000,12000000)`,[KY])
  await mon('DEMO-01','Tủ bếp trên','xong_sx'); await mon('DEMO-01','Tủ bếp dưới','xong_sx')

  // 2. Lẻ thiết kế riêng (L2/du_an) — đang sản xuất, 3 món khác trạng thái
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ngay_chot,ngay_vao_chuyen,ngay_hen_khach,cap_thiet_ke,gia_cong_thuc,gia_chot)
    values('DEMO-02','du_an','le_rieng','dang_lam',true,$1,'B demo','0900000002','HN',current_date-8,current_date-5,current_date+6,'thiet_ke_rieng',30000000,30000000)`,[KY])
  await mon('DEMO-02','Tủ áo 4 cánh','xong_sx'); await mon('DEMO-02','Kệ tivi','dang_lam'); await mon('DEMO-02','Bàn trà','cho_cat')

  // 3. Combo toàn món sẵn — chờ cắt
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ngay_hen_khach)
    values('DEMO-03','combo','combo','cho_cat',true,$1,'C demo','0900000003','HN',current_date+10)`,[KY])
  await mon('DEMO-03','Combo phòng khách','cho_cat'); await mon('DEMO-03','Combo bếp','cho_cat')

  // 4. Combo có món dựng mới (L1+L2) — đang làm
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,cap_thiet_ke,ngay_hen_khach)
    values('DEMO-04','combo','combo_moi','dang_lam',true,$1,'D demo','0900000004','HN','co_mon_dung_moi',current_date+8)`,[KY])
  await mon('DEMO-04','Món có sẵn','dang_lam'); await mon('DEMO-04','Món dựng mới','da_cat')

  // 5. Full căn dự án — đang báo giá
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,cap_thiet_ke)
    values('DEMO-05','du_an','full_can','bao_gia',true,$1,'E demo','0900000005','HN','co_mon_dung_moi')`,[KY])
  await mon('DEMO-05','Full căn 2PN','cho_cat')

  // 6. Báo giá THUA + lý do
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ly_do_thua)
    values('DEMO-06','le','le_sang','bao_gia_thua',true,$1,'F demo','0900000006','HN','gia_cao')`,[KY])
  await mon('DEMO-06','Tủ giày','cho_cat')

  // 7. Báo giá TREO
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach)
    values('DEMO-07','le','le_sang','bao_gia_treo',true,$1,'G demo','0900000007','HN')`,[KY])
  await mon('DEMO-07','Kệ sách','cho_cat')

  // 8. Mẫu mới
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ngay_hen_khach)
    values('DEMO-08','le','mau_moi','cho_cat',true,$1,'H demo','0900000008','HN',current_date+15)`,[KY])
  await mon('DEMO-08','Mẫu kệ óc chó','cho_cat')

  // 9. Giường gỗ tự nhiên — giá vốn NHẬP TAY, không tem
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ngay_hen_khach)
    values('DEMO-09','le','le_sang','cho_cat',true,$1,'I demo','0900000009','HN',current_date+12)`,[KY])
  await mon('DEMO-09','Giường gỗ sồi 1m8','cho_cat')

  // 10. Hàng mua ngoài — không tem/DXF
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ngay_hen_khach)
    values('DEMO-10','le','le_sang','da_cat',true,$1,'J demo','0900000010','HN',current_date+5)`,[KY])
  await mon('DEMO-10','Nệm + đèn mua ngoài','da_cat')

  // 11. QUÁ HẠN 3 ngày — quản đốc #1
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ngay_hen_khach,ngay_hen_khach_ban_dau)
    values('DEMO-11','le','le_sang','cho_cat',true,$1,'K demo','0900000011','HN',current_date-3,current_date-1)`,[KY])
  await mon('DEMO-11','Tủ quá hạn','cho_cat')

  // 12. GẤP có người duyệt + lý do — quản đốc #2
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ngay_hen_khach,danh_dau_gap,ly_do_gap,ma_ns_danh_dau,gap_luc)
    values('DEMO-12','le','le_sang','da_cat',true,$1,'L demo','0900000012','HN',current_date+12,true,'khách VIP cần gấp',$2,now())`,[KY, CEO])
  await mon('DEMO-12','Bộ phòng khách gấp','da_cat')

  // 13. CHỜ THIẾT KẾ — nhánh PLUGIN KÉO ĐƠN VỀ (don_cho_thiet_ke trả về đơn này). 2 món tự do khác kt/vl/màu.
  await ins(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,la_demo,ma_ky_ap_dung,ten_khach,sdt_khach,dia_chi_khach,ngay_hen_khach,cap_thiet_ke,ghi_chu)
    values('DEMO-13','le','le_rieng','dang_thiet_ke',true,$1,'M demo','0900000013','HN',current_date+14,'thiet_ke_rieng','Đơn để thợ thiết kế KÉO VỀ từ hệ đơn (demo plugin)')`,[KY])
  await ins(`insert into kho.don_hang_mon(don_id,ten,vl,kt,ma_mau,so_luong,chi_tiet,trang_thai,gia)
       select id,'Tủ áo 3 buồng','MDF17','2400x600x2400','N01',1,'Cánh mở phủ bì, 1 buồng kéo','cho_cat',0 from kho.don_hang where ma_don='DEMO-13'`)
  await ins(`insert into kho.don_hang_mon(don_id,ten,vl,kt,ma_mau,so_luong,chi_tiet,trang_thai,gia)
       select id,'Kệ tivi treo','Plywood','1800x400x350','N01',2,'Màu óc chó, bắt tường','cho_cat',0 from kho.don_hang where ma_don='DEMO-13'`)

  // ── giá vốn 3 khối (đơn qua plugin) ──
  for (const ma of ['DEMO-01','DEMO-02','DEMO-03','DEMO-04','DEMO-05','DEMO-08'])
    await ins(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon,nguoi_day) values($1,6000000,1200000,400000,7600000,'plugin',$2) on conflict(ma_don) do nothing`, [ma, CEO])
  // giá vốn NHẬP TAY (giường)
  await ins(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon,ly_do,nguoi_day) values('DEMO-09',5000000,2000000,300000,7300000,'nhap_tay','giường gỗ tự nhiên — plugin không dựng',$1) on conflict(ma_don) do nothing`, [CEO])

  // ── tem cho DEMO-01/03/04; DEMO-01 in 2 lượt (cắt lại) ──
  const temFor = async (ma, nTam) => {
    for (let i=1;i<=nTam;i++) await ins(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,kien,canh_dan,duong_dan_svg)
      values($1,1,$2,$3,700,350,17,1,'[{"vi_tri":"T","dai":700}]',$4) on conflict do nothing`,
      [ma, ma+'|T'+i, ['hong','day','canh_cua','noc'][i%4], ma+'/1/'+ma+'_T'+i+'.svg'])
  }
  await temFor('DEMO-01',6); await temFor('DEMO-03',4); await temFor('DEMO-04',5)
  // lượt in: DEMO-01 lan 1 + lan 2 (cắt lại), DEMO-03 lan 1
  const inLuot = async (ma, lan, ngayOff) => {
    await ins(`insert into kho.lan_in_tem(ma_don,phien_ban,lan_thu,ngay,ma_ns,so_tem) values($1,1,$2,current_date-${ngayOff},$3,4) on conflict do nothing`, [ma, lan, CEO])
    const tams=(await c.query(`select ma_tam from kho.tem_ban_ve where ma_don=$1 and phien_ban=1`,[ma])).rows
    for (const t of tams) await ins(`insert into kho.tem_da_in(ma_don,phien_ban,lan_thu,ma_tam) values($1,1,$2,$3) on conflict do nothing`,[ma,lan,t.ma_tam])
  }
  await inLuot('DEMO-01',1,9); await inLuot('DEMO-01',2,7); await inLuot('DEMO-03',1,5)

  // ── phiếu đếm 20 ngày cho pu/lot/giuong_lap (la_demo) ──
  const to0=(await c.query(`select ma_to from kho.to_san_xuat limit 1`)).rows[0].ma_to
  for (let d=1; d<=20; d++) for (const hd of ['pu','lot','giuong_lap'])
    await ins(`insert into kho.phieu_dem_ngay(ma_to,hoat_dong,ngay,so_luong,ma_ns,la_demo) values($1,$2,current_date-${d},$3,$4,true) on conflict do nothing`, [to0, hd, 5+(d%4), CEO])

  // ── san_luong_don (12 driver) cho vài đơn ──
  for (const ma of ['DEMO-01','DEMO-02','DEMO-04'])
    await ins(`insert into kho.san_luong_don(ma_don,cat,dan,pu,lot,giuong_lap) values($1,20,15,3,4,1) on conflict(ma_don) do nothing`, [ma])

  // ── lỗi làm lại ──
  for (const [ma,lg,sl] of [['DEMO-01','xuoc',2],['DEMO-02','sai_kich_thuoc',1],['DEMO-04','be_canh',1]])
    await ins(`insert into kho.loi_lam_lai(ngay,ma_to,ma_don,loai_loi,so_luong,ma_ns_ghi) values(current_date-${5},$1,$2,$3,$4,$5)`, [to0, ma, lg, sl, CEO])

  // ── giờ thiết kế thực (ban_hang + xuong) ──
  for (const ma of ['DEMO-01','DEMO-02','DEMO-04','DEMO-05'])
    for (const [lg,gio] of [['ban_hang',1.5],['xuong',2.0]])
      await ins(`insert into kho.gio_thiet_ke_thuc(ma_don,ma_ns,loai_gio,gio_thuc,cap) values($1,$2,$3,$4,'L2') on conflict do nothing`, [ma, CEO, lg, gio])

  // ── lương 7 tổ + % thời gian (ky demo 2099-08) ──
  const tos = (await c.query(`select ma_to from kho.to_san_xuat order by ma_to`)).rows.map(r=>r.ma_to)
  for (const t of tos) await ins(`insert into kho.luong_to(ma_ky,ma_to,luong_to,overhead_phan_bo,bao_hiem,so_nguoi) values($1,$2,50000000,10000000,3000000,5) on conflict(ma_ky,ma_to) do nothing`, [KY, t])
  // % thời gian: mỗi tổ 100% cho 1 hoạt động (đơn giản, tổng=100)
  const hdOf = { cha_lot:'lot', cnc:'cat', dan_canh:'dan', dong_goi:'goi', giuong:'giuong_lap', lap_rap:'thung', son_pu:'pu' }
  for (const t of tos) await ins(`insert into kho.phan_bo_hoat_dong(ma_ky,ma_to,hoat_dong,phan_tram_thoi_gian) values($1,$2,$3,100) on conflict do nothing`, [KY, t, hdOf[t]||'cat'])

  await c.query('commit')
  const n=(await c.query(`select count(*)::int n from kho.don_hang where la_demo`)).rows[0].n
  console.log('✅ SEED xong · '+n+' đơn demo (kỳ '+KY+') · giá vốn/tem/phiếu đếm/lỗi/giờ TK/lương đã dựng.')
} catch(e){ await c.query('rollback').catch(()=>{}); console.error('❌ SEED lỗi:', e.message); process.exit(1) }
finally { await c.end() }
