-- WP-13b L-6 · db/223 · ky_gia_hien_hanh() = kỳ ĐÃ XÁC NHẬN mới nhất (chưa có → kỳ mới nhất, không mất giá).
-- + 10 hàm giá THÔI inline "order by ngay_ap_dung desc limit 1", GỌI kho.ky_gia_hien_hanh() (một nguồn sự thật).
-- GIỮ NGUYÊN (ngoài họ giá): ban_giao_xuong · vuot_coc_canh_bao (chọn cọc% theo THÁNG) · mo_ky_moi (quản lý kỳ, cần kỳ-mới-nhất-thật).
-- Hôm nay 3 kỳ đều CHƯA xác nhận → nhánh dự phòng = kỳ mới nhất 2026-09 = KHÔNG đổi giá.

create or replace function kho.ky_gia_hien_hanh() returns text
language sql stable security definer set search_path = kho, pg_temp as $KGHH$
  select coalesce(
    (select ma_ky from kho.tham_so_tai_chinh where xac_nhan_luc is not null
       order by ngay_ap_dung desc nulls last, ma_ky desc limit 1),
    (select ma_ky from kho.tham_so_tai_chinh
       order by ngay_ap_dung desc nulls last, ma_ky desc limit 1)
  );
$KGHH$;
alter function kho.ky_gia_hien_hanh() owner to postgres;

-- gia_san_don: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.gia_san_don(p_mon jsonb, p_dong text DEFAULT 'le'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare
  v_m numeric; v_hh numeric; v_nhom_default numeric; v_phi numeric;
  t record;
  v_sum numeric := 0; it jsonb; v_gv numeric; v_nhom numeric; v_ship numeric;
begin
  if auth.uid() is null then raise exception 'gia_san_don: cần đăng nhập'; end if;
  select * into t from kho.tham_so_tai_chinh
    where ma_ky = kho.ky_gia_hien_hanh();
  if t.he_so_m is null then raise exception 'gia_san_don: he_so_m chưa tính — chạy kho.tinh_he_so_m() trước'; end if;
  v_m := t.he_so_m; v_nhom_default := t.he_so_nhom;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  v_phi := case p_dong
             when 'combo'   then t.phi_don_combo
             when 'du_an'   then t.phi_don_thiet_ke
             when 'thiet_ke' then t.phi_don_thiet_ke
             else t.phi_don_le
           end;
  for it in select value from jsonb_array_elements(p_mon) loop
    select gia_von into v_gv from kho.san_pham_mau_gia_von where ma = (it->>'sku');
    if v_gv is null then raise exception 'gia_san_don: chưa có giá vốn cho "%"', it->>'sku'; end if;
    v_ship := coalesce((it->>'ship')::numeric, 0);
    v_nhom := coalesce((it->>'he_so_nhom')::numeric, v_nhom_default, 1);
    v_sum := v_sum + v_gv * (1 + (v_m - 1) * v_nhom) + v_ship;   -- Σ TẦNG 1
  end loop;
  return round((v_sum + v_phi) / (1 - v_hh));                    -- + phi_don_<dòng> MỘT lần ; ÷ (1 − Σhh)
end $function$
;

-- gio_thiet_ke: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.gio_thiet_ke()
 RETURNS TABLE(gio_l1 numeric, gio_l2 numeric, gio_l3 numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
  select t.gio_l1, t.gio_l2, t.gio_l3
  from kho.tham_so_tai_chinh t
  where t.ma_ky = kho.ky_gia_hien_hanh();
$function$
;

-- tang_1_mon: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.tang_1_mon(p_sku text, p_ship numeric DEFAULT 0, p_he_so_nhom numeric DEFAULT NULL::numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_gv numeric; v_m numeric; v_nhom numeric;
begin
  if auth.uid() is null then raise exception 'tang_1_mon: cần đăng nhập'; end if;
  select gia_von into v_gv from kho.san_pham_mau_gia_von where ma = p_sku;
  if v_gv is null then raise exception 'tang_1_mon: chưa có giá vốn cho món "%"', p_sku; end if;
  select t.he_so_m, t.he_so_nhom into v_m, v_nhom
    from kho.tham_so_tai_chinh t where t.ma_ky = kho.ky_gia_hien_hanh();
  if v_m is null then raise exception 'tang_1_mon: he_so_m chưa tính — chạy kho.tinh_he_so_m() trước'; end if;
  v_nhom := coalesce(p_he_so_nhom, v_nhom, 1);
  return round(v_gv * (1 + (v_m - 1) * v_nhom) + coalesce(p_ship, 0));
end $function$
;

-- cau_hinh_sale: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.cau_hinh_sale()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
  select jsonb_build_object(
    'vat', t.vat, 'gio_mo_cua', t.gio_mo_cua, 'ghi_de', t.ghi_de,
    'n_ads', t.n_ads, 'n_cac', t.n_cac, 'n_kg', t.n_kg, 'n_no', t.n_no, 'n_giam', t.n_giam,
    'tran_sale', t.tran_sale, 'tran_truong_nhom', t.tran_truong_nhom)
  from kho.tham_so_tai_chinh t where t.ma_ky = kho.ky_gia_hien_hanh();
$function$
;

-- gia_bao_khach: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.gia_bao_khach(p_mon jsonb, p_dong text DEFAULT 'le'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vat numeric; v_san numeric;
begin
  select vat into v_vat from kho.tham_so_tai_chinh where ma_ky = kho.ky_gia_hien_hanh();
  if v_vat is null then raise exception 'gia_bao_khach: chưa nhập vat'; end if;
  v_san := kho.gia_san_don(p_mon, p_dong);        -- giá sàn CHƯA VAT
  return round(v_san * (1 + v_vat/100.0));         -- CÓ VAT — tầng ngoài cùng
end $function$
;

-- tran_giam_gia: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.tran_giam_gia(p_sku text, p_dong text, p_ngay date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
  select greatest(
    coalesce((select tran_sale from kho.tham_so_tai_chinh where ma_ky = kho.ky_gia_hien_hanh()), 0),
    coalesce((select max(tran_moi) from kho.noi_tran_sp
       where (sku = p_sku or (nhom is not null and nhom = p_dong)) and p_ngay between hieu_luc_tu and hieu_luc_den), 0),
    coalesce((select max(tran_moi) from kho.noi_tran_ky
       where dong = p_dong and p_ngay between hieu_luc_tu and hieu_luc_den), 0)
  );
$function$
;

-- gia_san_don_i: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.gia_san_don_i(p_mon jsonb, p_dong text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare
  v_m numeric; v_hh numeric; v_nhom_default numeric; v_phi numeric; t record;
  v_sum numeric := 0; it jsonb; v_gv numeric; v_nhom numeric; v_ship numeric;
begin
  select * into t from kho.tham_so_tai_chinh where ma_ky = kho.ky_gia_hien_hanh();
  if t.he_so_m is null then return null; end if;   -- chưa có he_so_m -> không tính được sàn
  v_m := t.he_so_m; v_nhom_default := t.he_so_nhom;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  v_phi := case p_dong when 'combo' then t.phi_don_combo when 'du_an' then t.phi_don_thiet_ke
             when 'thiet_ke' then t.phi_don_thiet_ke else t.phi_don_le end;
  for it in select value from jsonb_array_elements(p_mon) loop
    select gia_von into v_gv from kho.san_pham_mau_gia_von where ma = (it->>'sku');
    if v_gv is null then continue; end if;
    v_ship := coalesce((it->>'ship')::numeric, 0);
    v_nhom := coalesce((it->>'he_so_nhom')::numeric, v_nhom_default, 1);
    v_sum := v_sum + v_gv * (1 + (v_m - 1) * v_nhom) + v_ship;
  end loop;
  return round((v_sum + v_phi) / (1 - v_hh));
end $function$
;

-- kiem_giam_gia: gọi ky_gia_hien_hanh() (thay 2 chỗ)
CREATE OR REPLACE FUNCTION kho.kiem_giam_gia(d kho.don_hang)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare
  v_pct numeric; v_tran numeric; v_tran_tn numeric; v_san numeric; v_vt text; v_mon jsonb; v_hesom numeric;
begin
  if d.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then return; end if;
  if current_setting('chan.off_von', true) is distinct from '1'
     and d.gia_chot is not null and d.dong = 'du_an'
     and not exists (select 1 from kho.don_hang_gia_von g where g.ma_don = d.ma_don and g.gia_chuyen_giao is not null) then
    raise exception E'Đơn thiết kế "%" cần GIÁ VỐN mới chốt được. Ba cách gỡ:\n  1) Thiết kế dựng hình rồi ĐẨY GIÁ VỐN từ plugin.\n  2) ceo/kho NHẬP GIÁ VỐN TAY ở app tài chính (tab Giá vốn theo đơn).\n  3) Nếu đơn KHÔNG cần dựng hình (mua ngoài/giường gỗ), ĐỔI LOẠI ĐƠN sang Lẻ.', d.ma_don;
  end if;
  if d.gia_cong_thuc is null or d.gia_cong_thuc <= 0 then return; end if;
  v_pct := (coalesce(d.chiet_khau,0) / d.gia_cong_thuc) * 100;
  if current_setting('chan.off_lydo', true) is distinct from '1'
     and v_pct > 0 and coalesce(btrim(d.ly_do_giam),'') = '' then
    raise exception 'Giảm giá phải có lý do (ly_do_giam)';
  end if;
  if current_setting('chan.off_san', true) is distinct from '1' and d.gia_chot is not null then
    select jsonb_agg(jsonb_build_object('sku', m.sp_id)) into v_mon
      from kho.don_hang_mon m where m.don_id = d.id and m.sp_id in (select ma from kho.san_pham_mau_gia_von);
    if v_mon is not null then
      select he_so_m into v_hesom from kho.tham_so_tai_chinh where ma_ky = kho.ky_gia_hien_hanh();
      if v_hesom is null then
        if current_setting('chan.hesom_old', true) = '1' then null;
        else raise exception 'Chưa có he_so_m cho kỳ này — không chốt được đơn (chạy tinh_he_so_m)'; end if;
      else
        v_san := kho.gia_san_don_i(v_mon, coalesce(d.dong,'le'));
        if v_san is not null and d.gia_chot < v_san then
          raise exception 'Giá chốt % dưới giá sàn — không thể chốt (kể cả CEO duyệt)', d.gia_chot;
        end if;
      end if;
    end if;
  end if;
  if current_setting('chan.off_tran', true) is distinct from '1' and v_pct > 0 then
    select coalesce(max(kho.tran_giam_gia(m.sp_id, d.dong, coalesce(d.ngay_chot, current_date))),
                    kho.tran_giam_gia(null, d.dong, coalesce(d.ngay_chot, current_date)))
      into v_tran from kho.don_hang_mon m where m.don_id = d.id and m.sp_id is not null;
    v_tran := coalesce(v_tran, kho.tran_giam_gia(null, d.dong, coalesce(d.ngay_chot, current_date)));
    if v_pct > v_tran + 1e-9 then
      if d.ma_ns_duyet_giam is null then
        raise exception 'Giảm % vượt trần % — cần người duyệt', round(v_pct,2)||'%', round(v_tran,2)||'%';
      end if;
      select cap into v_vt from kho.quyen_duyet_giam where ns_id = d.ma_ns_duyet_giam::uuid;
      select tran_truong_nhom into v_tran_tn from kho.tham_so_tai_chinh where ma_ky = kho.ky_gia_hien_hanh();
      if v_vt = 'ceo' then null;
      elsif v_vt = 'truong_nhom' then
        if v_pct > coalesce(v_tran_tn,8) + 1e-9 then
          raise exception 'Giảm % vượt quyền trưởng nhóm (%) — cần CEO', round(v_pct,2)||'%', round(v_tran_tn,2)||'%';
        end if;
      else raise exception 'Người duyệt "%" không đủ thẩm quyền giảm giá', coalesce(v_vt,'(không rõ)'); end if;
    end if;
  end if;
end $function$
;

-- gia_bac_tu_gv: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.gia_bac_tu_gv(p_gv numeric, p_dong text DEFAULT 'le'::text, p_nhom numeric DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare t record; v_m numeric; v_hh numeric; v_phi numeric; v_vat numeric; v_t1 numeric; v_san numeric; v_mult numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'gia_bac_tu_gv: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = kho.ky_gia_hien_hanh();
  if t.he_so_m is null then return jsonb_build_object('he_so_m', null); end if;
  v_m := t.he_so_m;
  v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_phi := case p_dong when 'combo' then t.phi_don_combo when 'du_an' then t.phi_don_thiet_ke else t.phi_don_le end;
  v_vat := coalesce(t.vat,0)/100;
  v_mult := 1 + (v_m - 1) * coalesce(p_nhom,1);
  v_t1 := round(p_gv * v_mult);
  v_san := round((v_t1 + v_phi) / (1 - v_hh));
  return jsonb_build_object('he_so_m', v_m, 'mult', v_mult, 'tang_1', v_t1, 'phi', v_phi, 'hh', v_hh,
    'gia_san', v_san, 'bao_khach', round(v_san * (1 + v_vat)), 'vat', t.vat, 'tran_sale', t.tran_sale);
end $function$
;

-- bang_gia: gọi ky_gia_hien_hanh() (thay 1 chỗ)
CREATE OR REPLACE FUNCTION kho.bang_gia(p_dong text DEFAULT 'le'::text, p_ngay date DEFAULT CURRENT_DATE)
 RETURNS TABLE(sku text, ten text, gia_von numeric, tang_1 numeric, gia_san numeric, bao_khach numeric, tran numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare t record; v_m numeric; v_hh numeric; v_phi numeric; v_vat numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'bang_gia: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = kho.ky_gia_hien_hanh();
  v_m := t.he_so_m;
  v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_phi := case p_dong when 'combo' then t.phi_don_combo when 'du_an' then t.phi_don_thiet_ke else t.phi_don_le end;
  v_vat := coalesce(t.vat,0)/100;
  return query
    select s.ma, s.ten, g.gia_von,
      case when v_m is null then null else round(g.gia_von * v_m) end,
      case when v_m is null then null else round((g.gia_von*v_m + v_phi)/(1-v_hh)) end,
      case when v_m is null then null else round((g.gia_von*v_m + v_phi)/(1-v_hh)*(1+v_vat)) end,
      kho.tran_giam_gia(s.ma, p_dong, p_ngay)
    from kho.san_pham_mau s join kho.san_pham_mau_gia_von g on g.ma = s.ma
    where not s.ngung order by g.gia_von;
end $function$
;

