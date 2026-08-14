-- 060 — Biến thể BA TRỤC + cột nhập web + RPC app sản phẩm. BỌC NGOÀI: KHÔNG đụng cột cũ san_pham_mau.
--   CEO chốt: thago.vn đúng (cập nhật domain) · Vufurni = shop 21 "Nội thất Vũ Gia" (ghi ten_tren_web).
--   Nhập từ togihome.vn (đã gồm Vufurni). Mulig chưa có web (nợ lô sau).
--   node ops/run_sql.mjs ../db/060_bien_the_ba_truc_nhap_web.sql   (⚠ CHỜ test + 6 app không vỡ.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.sp_danh_sach(text,text,text); drop function if exists kho.sp_cay(text); drop function if exists kho.sp_loc_options();
--   alter table kho.niem_yet drop column if exists mo_ta_html; alter table kho.niem_yet drop column if exists order_count;
--   alter table kho.niem_yet drop column if exists total_week_sold; alter table kho.niem_yet drop column if exists la_combo;
--   alter table kho.niem_yet drop column if exists anh; alter table kho.niem_yet drop column if exists nguon_host; alter table kho.niem_yet drop column if exists id_web;
--   alter table kho.san_pham_mau drop column if exists dai_mm; alter table kho.san_pham_mau drop column if exists rong_mm; alter table kho.san_pham_mau drop column if exists cao_mm;
--   alter table kho.san_pham_mau drop column if exists ma_mau; alter table kho.san_pham_mau drop column if exists thuoc_tinh_khac;
--   alter table kho.san_pham_mau drop column if exists kt_nguon; alter table kho.san_pham_mau drop column if exists vl_doan; alter table kho.san_pham_mau drop column if exists vl_chua_xac_nhan;
--   alter table kho.thuong_hieu drop column if exists ten_tren_web;
--   delete from storage.buckets where id='san-pham';
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ ① BRAND — cập nhật theo BƯỚC 0 (chỉ THÊM cột) ════════
alter table kho.thuong_hieu add column if not exists ten_tren_web text;   -- tên hiển thị trên gian hàng web
update kho.thuong_hieu set domain = 'thago.vn' where ma = 'thago' and domain is null;
update kho.thuong_hieu set ten_tren_web = 'Nội thất Vũ Gia' where ma = 'vufurni';

-- CEO chốt (kiểm mắt lô này): mỗi GIAN HÀNG họ Togihome trên marketplace = MỘT thương hiệu riêng.
--   ten = ten_tren_web = ĐÚNG tên gian trên web (để import map theo tên/ id gian). 7 gian con trong top-100 bán chạy.
insert into kho.thuong_hieu(ma, ten, ma_3chu, loai, ten_tren_web) values
  ('togihome-vp',     'Togihome-Văn phòng',    'TVP', 'thuong_hieu', 'Togihome-Văn phòng'),
  ('togihome-hd',     'Togihome hiện đại',     'THD', 'thuong_hieu', 'Togihome hiện đại'),
  ('togihome-gaming', 'Togihome Gaming',       'TGG', 'thuong_hieu', 'Togihome Gaming'),
  ('togihome-office', 'Togihome Office',       'TOF', 'thuong_hieu', 'Togihome Office'),
  ('togihome-bcc',    'Togihome bàn cao cấp',  'TBC', 'thuong_hieu', 'Togihome bàn cao cấp'),
  ('togihome-kr',     'Nội Thất Togihome KR',  'TKR', 'thuong_hieu', 'Nội Thất Togihome KR'),
  ('togihome-bh',     'Togihome-Bàn học',      'TBH', 'thuong_hieu', 'Togihome-Bàn học')
on conflict (ma) do update set ten = excluded.ten, ma_3chu = excluded.ma_3chu, ten_tren_web = excluded.ten_tren_web;
-- gian 'Nội thất Vũ Gia' đã có (vufurni). Gian 'Nguyễn Đức Việt' (id 15) → GỘP về togihome (map trong nhap_web.mjs).

-- ════════ BƯỚC 1 · BIẾN THỂ BA TRỤC (san_pham_mau — CHỈ THÊM cột) ════════
alter table kho.san_pham_mau add column if not exists dai_mm numeric;    -- kích thước tách được → số; không tách → NULL + cờ dưới
alter table kho.san_pham_mau add column if not exists rong_mm numeric;
alter table kho.san_pham_mau add column if not exists cao_mm numeric;
alter table kho.san_pham_mau add column if not exists ma_mau text references kho.mau_sac(ma);
alter table kho.san_pham_mau add column if not exists thuoc_tinh_khac jsonb;   -- trục thứ 4 trở đi
alter table kho.san_pham_mau add column if not exists kt_nguon text;          -- chuỗi kích thước gốc từ web ("80x180x55cm")
alter table kho.san_pham_mau add column if not exists vl_doan text;           -- vật liệu ĐOÁN từ tên
alter table kho.san_pham_mau add column if not exists vl_chua_xac_nhan boolean not null default false;
-- CỜ ĐÃ SOÁT TAY (VIỆC 1): người bấm Lưu trong modal → tự set 3 cột này. Import BỎ QUA HOÀN TOÀN dòng đã soát.
alter table kho.san_pham_mau add column if not exists da_soat_tay boolean not null default false;
alter table kho.san_pham_mau add column if not exists soat_boi uuid references kho.nguoi_dung(id);
alter table kho.san_pham_mau add column if not exists soat_luc timestamptz;
-- Một BIẾN THỂ = một tổ hợp (kích thước + vật liệu + màu + TRỤC THỨ 4). NULL tính là khác nhau (import không đụng nhau).
--   ⚠ BỔ SUNG so với BƯỚC 1 gốc: thêm thuoc_tinh_khac vào khoá tổ hợp. Dữ liệu web THẬT có biến thể khác nhau ở
--   "số ghế / cấu hình / màu web" mà CÙNG kích thước+vật liệu (vd bàn ăn Bàn+4 vs Bàn+6, cùng 120×88). Không có trục
--   này, hai biến thể thật đụng khoá → vỡ import. Đây là hoàn thiện đúng cột thuoc_tinh_khac mà BƯỚC 1 đã mở.
drop index if exists kho.san_pham_mau_to_hop_uq;
create unique index if not exists san_pham_mau_to_hop_uq
  on kho.san_pham_mau(ma_loi, dai_mm, rong_mm, cao_mm, ma_vat_tu_chinh, ma_mau, (coalesce(thuoc_tinh_khac::text, '')))
  where ma_loi is not null;

-- ════════ BƯỚC 2 · CỘT NHẬP WEB (niem_yet — chỉ THÊM cột) ════════
alter table kho.niem_yet add column if not exists mo_ta_html text;
alter table kho.niem_yet add column if not exists order_count integer not null default 0;
alter table kho.niem_yet add column if not exists total_week_sold integer not null default 0;
alter table kho.niem_yet add column if not exists la_combo boolean not null default false;
alter table kho.niem_yet add column if not exists anh jsonb not null default '[]'::jsonb;   -- [{nho,to}] trong bucket, KHÔNG hotlink web
alter table kho.niem_yet add column if not exists shop_web_id integer;   -- id GIAN HÀNG gốc trên web (định tuyến/gộp brand theo gian, vd id15→togihome)
alter table kho.niem_yet add column if not exists nguon_host text;                          -- api host nhập về (đa host lô sau)
alter table kho.niem_yet add column if not exists id_web integer;                           -- id sản phẩm gốc trên web

-- bucket ảnh sản phẩm (public đọc — ảnh catalog vốn công khai; ghi chỉ ceo/ke_toan)
insert into storage.buckets (id, name, public) values ('san-pham','san-pham', true) on conflict (id) do nothing;
-- ⚠ TO PUBLIC (không phải authenticated): storage service đánh giá TO theo role phiên DB, không khớp
--   'authenticated' → chèn 403. Mọi bucket khác trong hệ (kho-images/tem-svg/ban-thiet-ke) đều dùng TO PUBLIC
--   rồi để current_vai_tro() gác. Theo đúng khuôn đó.
drop policy if exists sp_obj_ghi on storage.objects;
create policy sp_obj_ghi on storage.objects for insert to public
  with check (bucket_id = 'san-pham' and kho.current_vai_tro() = any (array['ceo','ke_toan']));
drop policy if exists sp_obj_sua on storage.objects;
create policy sp_obj_sua on storage.objects for update to public
  using (bucket_id = 'san-pham' and kho.current_vai_tro() = any (array['ceo','ke_toan']))
  with check (bucket_id = 'san-pham' and kho.current_vai_tro() = any (array['ceo','ke_toan']));

-- ════════ BƯỚC 3 · RPC ĐỌC cho app sản phẩm (ceo/ke_toan — có giá vốn) ════════
-- tuỳ chọn lọc: brand · nhóm hàng · nguồn
create or replace function kho.sp_loc_options()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'sp_loc_options: chỉ ceo/ke_toan'; end if;
  return jsonb_build_object(
    'brand', (select coalesce(jsonb_agg(jsonb_build_object('ma',ma,'ten',coalesce(ten_tren_web,ten)) order by ten), '[]'::jsonb)
              from kho.thuong_hieu where loai='thuong_hieu' and not coalesce(ngung,false)),
    'nhom',  (select coalesce(jsonb_agg(distinct nhom_hang) filter (where nhom_hang is not null), '[]'::jsonb) from kho.san_pham_loi),
    'nguon', jsonb_build_array('xuong','nhap_khau','dropship'));
end $$;
grant execute on function kho.sp_loc_options() to authenticated;

-- DANH SÁCH niêm yết (xếp bán chạy) + cờ vật liệu/kích thước của biến thể
drop function if exists kho.sp_danh_sach(text,text,text);
create or replace function kho.sp_danh_sach(p_brand text, p_nhom text, p_nguon text)
  returns table(ma_ny text, ten text, brand text, brand_ten text, gia numeric, gia_von numeric,
                order_count integer, total_week_sold integer, la_combo boolean,
                ma_loi text, ma_bien_the text, nhom_hang text, nguon text, anh jsonb,
                vl_chua_xac_nhan boolean, kt_thieu boolean, dai_mm numeric, rong_mm numeric, cao_mm numeric,
                kt_nguon text, vat_lieu text, ma_vat_tu_chinh text,
                da_soat_tay boolean, soat_ten text, soat_luc timestamptz)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'sp_danh_sach: chỉ ceo/ke_toan'; end if;
  return query
  select n.ma_ny, n.ten_ban_hang, n.ma_thuong_hieu, coalesce(th.ten_tren_web, th.ten), n.gia_niem_yet, gv.gia_von,
    n.order_count, n.total_week_sold, n.la_combo,
    s.ma_loi, s.ma, l.nhom_hang, l.nguon, n.anh,
    s.vl_chua_xac_nhan, (s.dai_mm is null and s.cao_mm is null), s.dai_mm, s.rong_mm, s.cao_mm, s.kt_nguon, coalesce(s.vl_doan, s.vat_lieu), s.ma_vat_tu_chinh,
    s.da_soat_tay, (select nd.ho_ten from kho.nguoi_dung nd where nd.id = s.soat_boi), s.soat_luc
  from kho.niem_yet n
  join kho.san_pham_mau s on s.ma = n.ma_bien_the
  left join kho.san_pham_loi l on l.ma_loi = s.ma_loi
  left join kho.thuong_hieu th on th.ma = n.ma_thuong_hieu
  left join kho.san_pham_mau_gia_von gv on gv.ma = n.ma_bien_the
  where (p_brand is null or n.ma_thuong_hieu = p_brand)
    and (p_nhom is null or l.nhom_hang = p_nhom)
    and (p_nguon is null or l.nguon = p_nguon)
  order by n.order_count desc, n.total_week_sold desc;
end $$;
grant execute on function kho.sp_danh_sach(text,text,text) to authenticated;

-- CÂY một lõi: lõi → biến thể → niêm yết (có giá vốn)
create or replace function kho.sp_cay(p_ma_loi text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'sp_cay: chỉ ceo/ke_toan'; end if;
  select jsonb_build_object('ma_loi', l.ma_loi, 'ten_ky_thuat', l.ten_ky_thuat, 'nhom_hang', l.nhom_hang, 'nguon', l.nguon,
    'bien_the', (select coalesce(jsonb_agg(jsonb_build_object(
        'ma', s.ma, 'ten', s.ten, 'dai_mm', s.dai_mm, 'rong_mm', s.rong_mm, 'cao_mm', s.cao_mm, 'kt_nguon', s.kt_nguon,
        'vat_lieu', s.vat_lieu, 'vl_doan', s.vl_doan, 'vl_chua_xac_nhan', s.vl_chua_xac_nhan, 'ma_mau', s.ma_mau,
        'gia_von', (select gia_von from kho.san_pham_mau_gia_von g where g.ma = s.ma),
        'niem_yet', (select coalesce(jsonb_agg(jsonb_build_object('ma_ny', n.ma_ny, 'brand', n.ma_thuong_hieu,
                        'ten', n.ten_ban_hang, 'gia', n.gia_niem_yet, 'duong_dan', n.duong_dan, 'la_combo', n.la_combo,
                        'order_count', n.order_count, 'anh', n.anh)), '[]'::jsonb)
                     from kho.niem_yet n where n.ma_bien_the = s.ma))
        order by s.ma), '[]'::jsonb) from kho.san_pham_mau s where s.ma_loi = l.ma_loi))
    into v from kho.san_pham_loi l where l.ma_loi = p_ma_loi;
  if v is null then raise exception 'sp_cay: không có lõi "%"', p_ma_loi; end if;
  return v;
end $$;
grant execute on function kho.sp_cay(text) to authenticated;

-- SỬA/SOÁT biến thể: xác nhận vật liệu (bỏ nhãn đoán) + nhập kích thước tay (không đoán)
create or replace function kho.sp_sua_bien_the(p_ma text, p_dai numeric, p_rong numeric, p_cao numeric,
                                               p_vl text, p_ma_vt text, p_xac_nhan boolean)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'sp_sua_bien_the: chỉ ceo/ke_toan'; end if;
  -- Lưu = ĐÃ SOÁT TAY (ngầm, không nút riêng): ghi người + lúc; import sau đó BỎ QUA dòng này.
  update kho.san_pham_mau set
    dai_mm = p_dai, rong_mm = p_rong, cao_mm = p_cao,
    vl_doan = p_vl, ma_vat_tu_chinh = p_ma_vt,
    vl_chua_xac_nhan = case when p_xac_nhan then false else vl_chua_xac_nhan end,
    da_soat_tay = true,
    soat_boi = (select nd.id from kho.nguoi_dung nd where nd.auth_uid = auth.uid()),
    soat_luc = now()
  where ma = p_ma;
  if not found then raise exception 'sp_sua_bien_the: không có biến thể "%"', p_ma; end if;
  return jsonb_build_object('ok', true, 'ma', p_ma);
end $$;
grant execute on function kho.sp_sua_bien_the(text,numeric,numeric,numeric,text,text,boolean) to authenticated;

commit;
