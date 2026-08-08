// nap_quy_doi.mjs — NẠP dữ liệu đề xuất vào kho.quy_doi (bảng độc lập).
//   Nguồn: (a) 6 mã đã có ma_kho trong luat_cau_tao.json -> DA_DUYET/CHAC/mặc định.
//          (b) 30 mã chưa cầu: MỌI ứng viên đã đề xuất -> CHUA_DUYET, tin cậy theo báo cáo.
//          (c) mã không ứng viên -> 1 dòng ma_kho NULL, CHUA_DUYET, ghi_chu lý do.
//          (d) ván: mỗi tổ hợp loại+dày = 1 mô tả, mọi mã kho cùng loại+dày, tồn cao nhất = mặc định.
//   Idempotent: on conflict (mo_ta_thiet_ke, ma_kho) do nothing — chạy lại KHÔNG nhân dòng.
//   CẤM đặt DA_DUYET cho bất kỳ dòng nào ngoài 6 mã ở (a).
//   Chạy: cd web && DB_HOST=... DB_USER=... DB_PASS=... node ops/nap_quy_doi.mjs
import pg from 'pg'
import { docConfig } from './conn.mjs'

// [mo_ta, ten_mo_ta, ma_plugin, dvt_plugin, gia_plugin, nhom, ma_kho, he_so, tin_cay, mac_dinh, trang_thai, ghi_chu]
const D = 'DA_DUYET', C = 'CHUA_DUYET'
const ROWS = []
const R = (...a) => ROWS.push(a)

// ── (a) 6 CẦU đã xác nhận (DA_DUYET · CHAC · mặc định) ──
R('ban_le_phu_nua','Bản lề cốc giảm chấn — phủ nửa (2 cánh chung vách → tay cong nửa)','BL-CH','cái',9000,'A','BL-01',1,'CHAC',true,D,'Đã có ma_kho sẵn trong luat_cau_tao.json (khớp giá 100%).')
R('ban_le_phu_toan','Bản lề cốc giảm chấn — phủ toàn phần (tay thẳng)','BL-CN','cái',9000,'A','BL-03',1,'CHAC',true,D,'Đã có ma_kho sẵn trong luat_cau_tao.json.')
R('ban_le_lot_long','Bản lề cốc giảm chấn — inset/lọt lòng (tay cong sâu)','BL-T','cái',9000,'A','BL-02',1,'CHAC',true,D,'Đã có ma_kho sẵn trong luat_cau_tao.json.')
R('chot_go_d8','Chốt gỗ ø8×30 (liên kết carcass)','PK-DOWEL','cái',59,'A','OV-12',1780,'CHAC',true,D,'Đã có ma_kho. Đơn vị kho = TÚI 1780 chốt → he_so 1780; quy về cái ≈ 59đ, khớp plugin.')
R('tai_treo_sao','Tai treo sào (đế đỡ 2 đầu)','TTQA','cái',2200,'A','PK-11',1,'CHAC',true,D,'Đã có ma_kho sẵn trong luat_cau_tao.json.')
R('thanh_chong_cong_uv','Thanh chống cong U/V nhôm sau lưng cánh (2/cánh)','UV-CHONG-CONG','thanh',60000,'A','PK-01',1,'CHAC',true,D,'Đã có ma_kho sẵn trong luat_cau_tao.json.')

// ── (b) 30 mã chưa cầu — MỌI ứng viên (CHUA_DUYET) ──
R('ray_giam_chan_3tang','Ray bi giảm chấn 3 tầng (dòng cũ)','PK-RAY01','bộ',45000,'A','RT-04',1,'NGO',true,C,'Tên "giảm chấn" trùng RT-04/05; ⚠ giá plugin 45k << kho 130k.')
R('ray_giam_chan_3tang',null,'PK-RAY01','bộ',45000,'A','RT-05',1,'NGO',false,C,null)
R('ray_giam_chan_3tang',null,'PK-RAY01','bộ',45000,'A','RT-03',1,'NGO',false,C,'Ray bi thường (không giảm chấn) — khớp giá hơn nhưng khác chức năng.')

R('ban_le_gc_110','Bản lề giảm chấn 110° cup ø35 (dòng cũ, chưa phân độ cong)','PK-BL01','cái',12000,'A','BL-01',1,'NGO',true,C,'Cùng họ bản lề GC cửa gỗ; ⚠ giá plugin 12k vs kho 9k (+33%).')
R('ban_le_gc_110',null,'PK-BL01','cái',12000,'A','BL-02',1,'NGO',false,C,null)

R('ray_cua_lua','Ray cửa lùa (trên+dưới)','PK-RL01','bộ',55000,'A','PK-09',1,'NGO',true,C,'PK-09 ray nhôm lùa; ⚠ 55k vs 28k (+96%). Hệ lùa = ray + bánh xe.')
R('ray_cua_lua',null,'PK-RL01','bộ',55000,'A','BX-04',1,'NGO',false,C,null)

R('minifix_cam_cu','Minifix cam ø15 + chốt (dòng cũ)','PK-CAM01','bộ',3000,'A','OV-11',1000,'NGO',true,C,'Ốc cam (túi 1000 → he_so 1000). ⚠ minifix gồm cả chốt (OV-10); giá cần soi lại.')
R('minifix_cam_cu',null,'PK-CAM01','bộ',3000,'A','OV-10',1000,'NGO',false,C,'Chốt cam — thành phần thứ 2 của minifix.')

R('chot_do_dot_d5','Chốt đỡ đợt ø5 (4 chốt / đợt di động)','PK-PIN01','cái',800,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho chưa nhập chốt đỡ đợt ø5.')

R('oc_cay_m8','Ốc cấy M8 + bù-lông (tháo lắp module)','PK-NUT01','bộ',4000,'A','OV-13',1,'NGO',true,C,'Ốc cấy (giá vốn kho NULL — chưa so được).')
R('oc_cay_m8',null,'PK-NUT01','bộ',4000,'A','OV-31',1,'CHUA_RO',false,C,'Ốc cấy mặt bàn — khác công dụng.')
R('oc_cay_m8',null,'PK-NUT01','bộ',4000,'A','OV-15',1,'CHUA_RO',false,C,'Long đen M8 — thành phần đi kèm.')

R('pat_l_chong_lat','Pát L chống lật + vít nở (an toàn, theo cao/rộng tổng thể)','PK-LBR01','bộ',8000,'A','KG-01',1,'NGO',true,C,'Ke góc 2 lỗ; chưa chắc = pát CHỐNG LẬT chuyên dụng.')
R('pat_l_chong_lat',null,'PK-LBR01','bộ',8000,'A','KG-02',1,'NGO',false,C,null)
R('pat_l_chong_lat',null,'PK-LBR01','bộ',8000,'A','OV-08',1,'CHUA_RO',false,C,'Vít nở — thành phần đi kèm pát.')

R('tay_nam_am','Tay nắm / âm (khách chọn màu/kiểu)','PK-HDL01','cái',25000,'C','TN-17',1,'CHUA_RO',false,C,'KHÁCH CHỌN — máy không đặt mặc định, CEO quyết theo đơn.')
R('tay_nam_am',null,'PK-HDL01','cái',25000,'C','TN-11',1,'CHUA_RO',false,C,null)
R('tay_nam_am',null,'PK-HDL01','cái',25000,'C','TN-09',1,'CHUA_RO',false,C,null)
R('tay_nam_am',null,'PK-HDL01','cái',25000,'C','TN-06',1,'CHUA_RO',false,C,null)

R('den_led_thanh','Đèn LED thanh chiếu sáng (khai so_den) [GĐ giá]','den_led_thanh','thanh',85000,'C','DI-07',1,'NGO',true,C,'LED trắng cuộn; đơn vị thanh↔cuộn khác, giá vốn NULL.')
R('den_led_thanh',null,'den_led_thanh','thanh',85000,'C','DI-02',1,'CHUA_RO',false,C,null)

R('chan_go_tron','Chân gỗ tròn đế nâng [GĐ giá]','chan_go_tron','cái',18000,'C','CK-01',1,'CHUA_RO',false,C,'CK-01 chỉ là MẶT BÍCH bắt chân gỗ; kho chưa có chân gỗ tròn nguyên.')

R('nap_luon_day','Nắp luồn dây tròn ø60 [GĐ giá]','nap_luon_day','cái',12000,'C','PK-06',1,'NGO',true,C,'Nắp đi dây điện; ⚠ 12k vs 2k (+500%), chưa rõ ø60.')

R('ban_le_bat_nhan_mo','Bản lề bật nhấn-mở (không tay nắm) [GĐ giá]','PK-BL02','cái',28000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho chưa nhập bản lề bật nhấn-mở.')

R('tip_on_ngan_keo','Thiết bị nhấn-mở ngăn kéo (tip-on)','PK-TIP01','bộ',20000,'A','PKT-02',1,'NGO',true,C,'"Hít Đẩy" = nhấn-mở; giá vốn NULL, đơn vị khác.')
R('tip_on_ngan_keo',null,'PK-TIP01','bộ',20000,'A','TM-01',1,'CHUA_RO',false,C,'PK nâng hạ ấn đẩy — khác tầm giá.')

R('banh_xe_khoa','Bánh xe có khoá [GĐ giá]','banh_xe','bộ',140000,'C','BX-01',1,'NGO',true,C,'⚠ đơn vị BỘ (plugin) ↔ CÁI (kho) — CEO nhập he_so 1 bộ = mấy cái trước khi chốt.')
R('banh_xe_khoa',null,'banh_xe','bộ',140000,'C','BX-04',1,'CHUA_RO',false,C,'Bánh xe cửa lùa — khác công dụng.')

R('minifix_oc_cam','Minifix ốc cam — liên kết tháo lắp (chuẩn mới)','OC-MINI','bộ',3500,'A','OV-11',1000,'NGO',true,C,'Ốc cam (túi 1000 → he_so 1000). Gồm cả chốt OV-10.')
R('minifix_oc_cam',null,'OC-MINI','bộ',3500,'A','OV-10',1000,'NGO',false,C,'Chốt cam — thành phần thứ 2.')

R('sao_treo_inox_met','Sào treo inox ø25 — tính theo MÉT','TSUOT','m',20500,'B','PK-12',1,'NGO',true,C,'⚠ đơn vị THANH (kho) ↔ MÉT (plugin) — nhập 1 thanh = mấy mét.')

R('ray_lua_grob','Hệ ray lùa GRÖB R01 (con lăn đỡ dưới + dẫn hướng trên)','GROB-R01','bộ',300000,'A','PK-09',1,'CHUA_RO',false,C,'Hệ GRÖB thương hiệu ~300k — kho chưa có tương đương; PK-09+BX-04 lệch quá xa.')
R('ray_lua_grob',null,'GROB-R01','bộ',300000,'A','BX-04',1,'CHUA_RO',false,C,null)

R('nep_nhom_bien','Nẹp nhôm ốp mép đứng biên tủ (2/tủ)','NEP-NHOM','thanh',40000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho chưa có nẹp nhôm ốp biên.')

R('ray_bi_hop_keo','Ray bi hộp kéo — chọn theo SÂU hộp (giá tra bảng)','RAY-KEO-BI','bộ',null,'A','RT-03',1,'CHAC',true,C,'Ray bi theo sâu; mặc định RT-03 (40cm, tồn cao). Ghép RÕ, chờ CEO duyệt.')
R('ray_bi_hop_keo',null,'RAY-KEO-BI','bộ',null,'A','RT-02',1,'CHAC',false,C,'Sâu 30cm.')
R('ray_bi_hop_keo',null,'RAY-KEO-BI','bộ',null,'A','RT-01',1,'CHAC',false,C,'Sâu 25cm.')

R('ray_lua_caocap_gd','[GĐ] Ray lùa cao cấp giảm ồn — test override','GROB-R02','bộ',0,'A',null,1,'CHUA_RO',false,C,'Mã fixture [GĐ] trong luật, KHÔNG phải hàng bán.')
R('ray_keo_gc_gd','[GĐ] Ray kéo giảm chấn giá cố định — test override','RAY-KEO-GC','bộ',0,'A',null,1,'CHUA_RO',false,C,'Mã fixture [GĐ], không phải hàng bán (nếu thật → RT-04/05).')
R('ban_le_gc_gd','[GĐ] Bản lề giảm chấn cao cấp — test override','BL-GC','cái',0,'A',null,1,'CHUA_RO',false,C,'Mã fixture [GĐ], không phải hàng bán.')
R('tay_nam_mau2_gd','[GĐ] Tay nắm mẫu 2 (thanh dài) — test override','PK-HDL02','cái',0,'C',null,1,'CHUA_RO',false,C,'Mã fixture [GĐ], khách chọn.')

R('ro_luoi_500','Rổ lưới kéo KOMPLEMENT — lớp 500','RO-500','cái',650000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — hàng IKEA KOMPLEMENT, kho chưa nhập.')
R('ro_luoi_750','Rổ lưới kéo KOMPLEMENT — lớp 750','RO-750','cái',650000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho chưa nhập.')
R('ro_luoi_1000','Rổ lưới kéo KOMPLEMENT — lớp 1000','RO-1000','cái',780000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho chưa nhập.')
R('sao_rut_500','Sào rút treo quần KOMPLEMENT — lớp 500','SAOQ-500','cái',250000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho chỉ có PK-12 sào CỐ ĐỊNH (khác).')
R('sao_rut_750','Sào rút treo quần KOMPLEMENT — lớp 750','SAOQ-750','cái',300000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho chưa nhập.')
R('sao_rut_1000','Sào rút treo quần KOMPLEMENT — lớp 1000','SAOQ-1000','cái',350000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho chưa nhập.')

R('bat_do_sao','Bát đỡ sào treo (2 vít/bát)','BAT-SAO01','cái',6000,'A','PK-11',1,'NGO',true,C,'Trùng chức năng đỡ sào với TTQA→PK-11; ⚠ 6k vs 2.2k (+173%).')

// ── (d) VÁN — mỗi tổ hợp loại+dày = 1 mô tả; mọi mã cùng loại+dày; tồn cao nhất = mặc định ──
// ma xếp theo TỒN giảm dần (mã đầu = mặc định). Số liệu đo từ kho (tĩnh).
const VAN = [
  ['van_mdf_6','Ván MDF melamine dày 6 ly (hậu/lưng tủ). Nhóm kho vừa sửa tên 5LY→6LY.','mdf@6',175000,
    ['MDF-OCH-5','MDF-VAG-5','MDF-DEN-5','MDF-TRG-5','MDF-XAM-5','MDF-XLC-5','MDF-DO-5','MDF-HOG-5','MDF-XAN-5']],
  ['van_mdf_15','Ván MDF melamine dày 15 ly','mdf@15',500000,
    ['MDF-OCH-15','MDF-XLC-15','MDF-DO-15','MDF-XAM-15','MDF-VAG-15','MDF-TRG-15','MDF-HOG-15','MDF-XAN-15','MDF-DEN-15']],
  ['van_mdf_17_5','Ván MDF melamine dày 17.5 ly (thân/cửa tủ)','mdf@17.5',550000,
    ['MDF-XAM-17','MDF-VDT-17','MDF-VDD-17','MDF-TRG-17','MDF-VAG-17','MDF-DEN-17','MDF-OCH-17']],
  ['van_plywood_17_5','Ván plywood dày 17.5 ly (kho 18mm)','plywood@17.5',850000,
    ['PLY-DEN-18','PLY-NAU-18','PLY-VAG-18','PLY-TRG-18']],
  ['van_cao_su_18','Ván gỗ cao su dày 18 ly (cả cao su MIN và PU)','cao_su@18',1050000,
    ['CSM-OCHO-18','AA-VAGDAM-18','CSM-DEN-18','CSM-ND-18','AA-NAU-18','AA-NAUDAM-18','AA-VAG-18','CSM-TRG-18','CSM-VAG-4012']],
]
for (const [mo_ta, ten, mp, gia, mas] of VAN)
  mas.forEach((m, i) => R(mo_ta, i===0?ten:null, mp, 'tấm', gia, 'A', m, 1, 'CHAC', i===0, C, i===0?'Ván đúng loại+dày; mặc định = mã tồn cao nhất (màu bán chạy).':null))

// ván không khớp / chưa rõ
R('van_plywood_15','Ván plywood dày 15 ly','plywood@15','tấm',750000,'A','GDA-15',1,'CHUA_RO',false,C,'GDA-15 "gỗ dán 15mm" — chưa có giá vốn, chưa chắc đúng loại. Chờ xác nhận.')
R('van_mdf_9','Ván MDF dày 9 ly','mdf@9','tấm',280000,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho không có MDF 9 ly (GDA-9 là gỗ dán, khác loại).')
R('van_kinh_4','Kính tấm dày 4 ly','kinh@4','tấm',null,'A',null,1,'CHUA_RO',false,C,'KHÔNG CÓ ỨNG VIÊN — kho không có kính tấm 4 ly.')

// ten_mo_ta chỉ khai ở dòng ĐẦU mỗi mô tả -> lấp sẵn cho các dòng cùng mô tả (cột NOT NULL)
const TEN = {}
for (const r of ROWS) if (r[1] && !TEN[r[0]]) TEN[r[0]] = r[1]

// ── NẠP ──
const c = new pg.Client(await docConfig()); await c.connect()
let them = 0
try {
  for (const [mo_ta, ten, mp, dvt, gia, nhom, ma_kho, heso, tc, md, tt, ghi] of ROWS) {
    const r = await c.query(
      `insert into kho.quy_doi
         (mo_ta_thiet_ke, ten_mo_ta, ma_plugin, dvt_plugin, gia_plugin, nhom_dinh_muc,
          ma_kho, he_so_quy_doi, muc_tin_cay, la_mac_dinh, trang_thai, ghi_chu)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (mo_ta_thiet_ke, ma_kho) do nothing`,
      [mo_ta, ten || TEN[mo_ta], mp, dvt, gia, nhom, ma_kho, heso, tc, md, tt, ghi])
    them += r.rowCount
  }

  const s = (await c.query(`select
    (select count(distinct mo_ta_thiet_ke)::int from kho.quy_doi) mo_ta,
    (select count(*)::int from kho.quy_doi) dong,
    (select count(*)::int from kho.quy_doi where trang_thai='DA_DUYET') da_duyet,
    (select count(*)::int from kho.quy_doi where trang_thai='CHUA_DUYET') chua_duyet,
    (select count(*)::int from kho.quy_doi where ma_kho is null) makho_null`)).rows[0]
  console.log(`Nạp xong. Thêm mới lần này: ${them} dòng.`)
  console.log(`Thống kê: ${s.mo_ta} mô tả · ${s.dong} dòng · DA_DUYET ${s.da_duyet} · CHUA_DUYET ${s.chua_duyet} · ma_kho NULL ${s.makho_null}`)
} finally { await c.end() }
process.exit(0)
