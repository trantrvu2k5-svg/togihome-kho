-- 064 — L-06: THAY giờ chuẩn [TẠM] "soạn bừa" bằng số SUY có căn cứ.
--   gio_moi_don_vi = don_gia_baseline.don_gia ÷ chi_phi_mot_gio_cua_to   (CEO: 12 dòng đều CÔNG THUẦN).
--   gio_co_dinh    = ước theo nghề (gá đặt), giữ NHỎ.  Cả hai vẫn la_tam=true (chưa ĐO).
--   THUẦN DB, chỉ UPDATE quy_trinh_buoc. KHÔNG đụng don_gia_baseline, không đụng dữ liệu khác.
--   node ops/run_sql.mjs ../db/064_gio_chuan_suy_tu_don_gia.sql
--
-- ══════════ NGUỒN chi_phi_mot_gio_cua_to ══════════
--   He_thong_luong_xuong.xlsx sheet 'Xếp nhân sự' F3 = Số công chuẩn/tháng = 26.
--   Don_gia_hoat_dong.xlsx sheet 'Tính đơn giá' BẢNG A = Lương tổ (tr/tháng) + Số người:
--     CNC 30tr/5 · Dán cạnh 36tr/5 · Chà lót 65tr/10 · Sơn PU 36tr/4 · Lắp ráp 73tr/8 · Đóng gói 51tr/9 · Giường 33tr/4.
--   Giờ/ngày = 8 (ngày công tiêu chuẩn — KHÔNG có trong file, nêu rõ giả định).
--   chi_phi_mot_gio_cua_to = lương_tổ / (số_người × 26 × 8)  [đ/giờ, LƯƠNG THUẦN; overhead = chi phí kỳ, không nhét/đơn vị].
--
-- ══════════ HOÀN TÁC ══════════ (khôi phục giờ demo cũ 'soạn bừa' — chỉ để rollback kỹ thuật)
--   begin; update kho.quy_trinh_buoc set gio_co_dinh=0.5, la_tam=true,
--     gio_moi_don_vi = case hoat_dong when 'cat' then 0.10 when 'dan' then 0.08 when 'cam' then 0.05
--       when 'thung' then 0.12 when 'cup' then 0.06 when 'ray' then 0.09 when 'canh' then 0.11 when 'goi' then 0.07 else 0.10 end,
--     ghi_chu=null; commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

with cpg(ma_to, chi_phi_gio) as (values
    ('cnc',      30000000.0/(5*26*8)),    -- 28.846 đ/giờ
    ('dan_canh', 36000000.0/(5*26*8)),    -- 34.615
    ('cha_lot',  65000000.0/(10*26*8)),   -- 31.250
    ('son_pu',   36000000.0/(4*26*8)),    -- 43.269
    ('lap_rap',  73000000.0/(8*26*8)),    -- 43.870
    ('dong_goi', 51000000.0/(9*26*8)),    -- 27.244
    ('giuong',   33000000.0/(4*26*8))     -- 39.663
),
gm as (
  select d.hoat_dong,
    round((d.don_gia / c.chi_phi_gio)::numeric, 4) as gio_moi,   -- suy tu don gia
    case d.hoat_dong                                              -- gio_co_dinh: ước theo nghề, giữ nhỏ
      when 'cat'  then 0.10   -- chạy máy CNC: nạp chương trình/nesting, gá đặt đáng kể
      when 'dan'  then 0.03   -- máy dán cạnh: chỉnh khổ, mồi keo
      when 'cam'  then 0.03   -- máy khoan: gá cữ
      when 'lot'  then 0.05   -- pha/đánh giáp, che chắn
      when 'pu'   then 0.05   -- pha màu, che chắn buồng sơn
      when 'son_canh' then 0.05
      when 'thung' then 0.02  -- lắp tay: gá đặt gần 0
      when 'cup'  then 0.02
      when 'ray'  then 0.03
      when 'canh' then 0.02
      when 'goi'  then 0.02
      when 'giuong_lap' then 0.10
      else 0.03 end as gio_cd
  from kho.don_gia_baseline d join cpg c on c.ma_to = d.ma_to
)
update kho.quy_trinh_buoc b set
  gio_moi_don_vi = case when b.loai_buoc = 'tu_chay' then 0 else gm.gio_moi end,
  gio_co_dinh    = gm.gio_cd,
  la_tam         = true,   -- CHƯA ĐO — không ai được gỡ cho tới lô A2 (QD-10)
  ghi_chu        = 'gio_moi_don_vi = suy tu don gia (don_gia/chi_phi_gio_to) · gio_co_dinh = uoc theo nghe · [TẠM] chưa đo'
from gm where gm.hoat_dong = b.hoat_dong;

commit;
