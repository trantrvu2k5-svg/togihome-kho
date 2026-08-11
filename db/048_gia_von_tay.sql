-- 048 — ĐƯỜNG VÒNG khi plugin không dùng được: nhập giá vốn TAY (giường gỗ/mua ngoài/tự do) +
--   ty_le_truy_duoc tách nhóm KHÔNG ĐO ĐƯỢC (không gộp im lặng) + sửa thông báo du_an kẹt chốt (3 cách gỡ).
--   Xem ~/Downloads/DO_phu_thuoc_plugin.md.  node ops/run_sql.mjs ../db/048_gia_von_tay.sql  (⚠ CHỜ TEST XANH)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.ghi_gia_von_tay(text,numeric,numeric,numeric,text), kho.gia_von_don_ds();
--   drop function if exists kho.ty_le_truy_duoc(text,text);   -- chạy lại bản db/038 (3 cột)
--   -- kiem_chuyen_trang_thai / kiem_giam_gia: chạy lại bản db/035 + db/036 (thông điệp cũ 1 dòng).
--   alter table kho.don_hang_gia_von drop column if exists nguon, drop column if exists ly_do;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 1. Cột nguồn + lý do (dòng cũ = 'plugin') ═══════════════
alter table kho.don_hang_gia_von add column if not exists nguon text not null default 'plugin'
  check (nguon in ('plugin','nhap_tay'));
alter table kho.don_hang_gia_von add column if not exists ly_do text;

-- ═══════════════ 2. ghi_gia_von_tay — ceo/kho nhập tay, ly_do BẮT BUỘC, nguon='nhap_tay' ═══════════════
create or replace function kho.ghi_gia_von_tay(ma_don text, khoi_1 numeric, khoi_2 numeric, khoi_3 numeric, ly_do text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
#variable_conflict use_column
declare v_uid uuid; v_tong numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho') then          -- fail-đóng: chỉ ceo/kho
    raise exception 'ghi_gia_von_tay: chỉ ceo/kho được nhập giá vốn tay'; end if;
  if nullif(btrim(coalesce(ghi_gia_von_tay.ly_do,'')),'') is null then     -- lý do BẮT BUỘC
    raise exception 'ghi_gia_von_tay: phải có lý do (vì sao nhập tay, vd: giường gỗ tự nhiên / hàng mua ngoài)'; end if;
  if not exists (select 1 from kho.don_hang d where d.ma_don = ghi_gia_von_tay.ma_don) then
    raise exception 'ghi_gia_von_tay: không có đơn "%"', ghi_gia_von_tay.ma_don; end if;
  v_tong := coalesce(khoi_1,0) + coalesce(khoi_2,0) + coalesce(khoi_3,0);
  select nd.id into v_uid from kho.nguoi_dung nd where nd.auth_uid = auth.uid();
  insert into kho.don_hang_gia_von (ma_don, khoi_1, khoi_2, khoi_3, gia_chuyen_giao, nguoi_day, nguon, ly_do, cap_nhat_luc)
    values (ghi_gia_von_tay.ma_don, khoi_1, khoi_2, khoi_3, v_tong, v_uid, 'nhap_tay', ghi_gia_von_tay.ly_do, now())
  on conflict (ma_don) do update set khoi_1=excluded.khoi_1, khoi_2=excluded.khoi_2, khoi_3=excluded.khoi_3,
    gia_chuyen_giao=excluded.gia_chuyen_giao, nguoi_day=excluded.nguoi_day, nguon='nhap_tay',
    ly_do=excluded.ly_do, cap_nhat_luc=now();
  return jsonb_build_object('ok', true, 'ma_don', ghi_gia_von_tay.ma_don, 'gia_chuyen_giao', v_tong, 'nguon', 'nhap_tay');
end $$;
grant execute on function kho.ghi_gia_von_tay(text, numeric, numeric, numeric, text) to authenticated;

-- ═══════════════ 3. gia_von_don_ds — MÀN "Giá vốn theo đơn" (ceo/kho): mọi đơn + trạng thái giá vốn ═══════════════
create or replace function kho.gia_von_don_ds()
  returns table(ma_don text, trang_thai text, dong text, co_gia_von boolean, nguon text,
                khoi_1 numeric, khoi_2 numeric, khoi_3 numeric, gia_chuyen_giao numeric,
                nguoi_ten text, ly_do text, cap_nhat_luc timestamptz)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho') then
    raise exception 'gia_von_don_ds: chỉ ceo/kho'; end if;
  return query
    select d.ma_don, d.trang_thai, d.dong, (g.ma_don is not null), g.nguon,
           g.khoi_1, g.khoi_2, g.khoi_3, g.gia_chuyen_giao, n.ho_ten, g.ly_do, g.cap_nhat_luc
    from kho.don_hang d
    left join kho.don_hang_gia_von g on g.ma_don = d.ma_don
    left join kho.nguoi_dung n on n.id = g.nguoi_day
    where d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy')
    order by (g.ma_don is not null), d.ma_don;   -- đơn CHƯA có giá vốn lên đầu
end $$;
grant execute on function kho.gia_von_don_ds() to authenticated;

-- ═══════════════ 4. ty_le_truy_duoc — TÁCH nhóm KHÔNG ĐO ĐƯỢC (đơn nhập tay, không driver) ═══════════════
--   Mẫu số tem-based đã loại đơn nhập tay (không tem). MỚI: đếm đơn nhập tay + CẢNH BÁO nếu > 20% (không
--   gộp im lặng). Đổi kiểu trả -> DROP+CREATE.
drop function if exists kho.ty_le_truy_duoc(text, text);
create or replace function kho.ty_le_truy_duoc(p_ma_ky text, p_hoat_dong text)
  returns table(ty_le numeric, luong_truy numeric, luong_khong_truy numeric, so_don_khong_do int, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_truy numeric; v_tong numeric; v_luong numeric; v_r numeric; v_kd int; v_tongdon int; v_pct numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'ty_le_truy_duoc: chỉ ceo/ke_toan'; end if;
  execute format('select coalesce(sum(s.%I),0) from kho.san_luong_don s join kho.don_hang d on d.ma_don=s.ma_don where d.ma_ky_ap_dung=$1', p_hoat_dong)
    into v_truy using p_ma_ky;
  begin v_tong := kho.driver_tu_tem(p_ma_ky,p_hoat_dong); exception when others then v_tong := null; end;
  if v_tong is null or v_tong=0 then begin v_tong := kho.driver_tu_kho(p_ma_ky,p_hoat_dong); exception when others then v_tong := null; end; end if;
  if v_tong is null or v_tong=0 then select sum(so_luong) into v_tong from kho.phieu_dem_ngay where hoat_dong=p_hoat_dong and to_char(ngay,'YYYY-MM')=p_ma_ky; end if;
  -- ĐẾM đơn KHÔNG ĐO ĐƯỢC (nhập tay -> không có 12 driver) trong kỳ + tổng đơn kỳ
  select count(*) into v_kd from kho.don_hang d join kho.don_hang_gia_von g on g.ma_don=d.ma_don
    where d.ma_ky_ap_dung=p_ma_ky and g.nguon='nhap_tay';
  select count(*) into v_tongdon from kho.don_hang d where d.ma_ky_ap_dung=p_ma_ky;
  so_don_khong_do := coalesce(v_kd,0);
  v_pct := case when coalesce(v_tongdon,0) > 0 then round(v_kd::numeric / v_tongdon * 100, 1) else 0 end;
  canh_bao := case when v_pct > 20 then '⚠ tỷ lệ chưa đáng tin: ' || v_pct || '% đơn nhập tay (không đo được driver)' else null end;
  if v_tong is null or v_tong=0 then ty_le := null; luong_truy := null; luong_khong_truy := null; return next; return; end if;
  v_r := round(least(v_truy/v_tong,1.0),4);
  select coalesce(sum((coalesce(lt.luong_to,0)+coalesce(lt.overhead_phan_bo,0)+coalesce(lt.bao_hiem,0))*pb.phan_tram_thoi_gian/100.0),0)
    into v_luong from kho.phan_bo_hoat_dong pb join kho.luong_to lt on lt.ma_ky=pb.ma_ky and lt.ma_to=pb.ma_to
    where pb.ma_ky=p_ma_ky and pb.hoat_dong=p_hoat_dong;
  ty_le := v_r; luong_truy := round(v_luong*v_r); luong_khong_truy := round(v_luong*(1-v_r));
  return next;
end $$;
grant execute on function kho.ty_le_truy_duoc(text, text) to authenticated;

-- ═══════════════ 5. Sửa THÔNG BÁO du_an kẹt chốt — nói rõ BA CÁCH GỠ (logic GIỮ NGUYÊN) ═══════════════
-- 5a. kiem_chuyen_trang_thai (lên đơn) — nguyên bản db/035, chỉ đổi thông điệp.
create or replace function kho.kiem_chuyen_trang_thai() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare
  v_thieu text;
  v_day   text[] := array['nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat',
                          'dang_lam','xong_sx','cho_giao','da_giao'];
begin
  if tg_op = 'UPDATE' and old.trang_thai = 'bao_gia' and new.trang_thai <> 'bao_gia' then
    if current_setting('chan.off_nhay', true) is distinct from '1'
       and new.trang_thai = any (v_day) then
      raise exception 'Đơn báo giá "%" phải LÊN ĐƠN (moi_len_don) trước — không nhảy thẳng sang %',
        new.ma_don, new.trang_thai;
    end if;
    if new.trang_thai = 'moi_len_don' then
      if current_setting('chan.off_mon_gia', true) is distinct from '1' then
        select string_agg(coalesce(nullif(btrim(m.ten),''), m.sp_id, '(món chưa tên)'), ', ')
          into v_thieu from kho.don_hang_mon m where m.don_id = new.id and coalesce(m.gia,0) <= 0;
        if v_thieu is not null then raise exception 'Chưa lên đơn được — món thiếu giá: %', v_thieu; end if;
      end if;
      if current_setting('chan.off_von_chuyen', true) is distinct from '1'
         and new.dong = 'du_an'
         and not exists (select 1 from kho.don_hang_gia_von g
                         where g.ma_don = new.ma_don and g.gia_chuyen_giao is not null) then
        raise exception E'Đơn thiết kế "%" cần GIÁ VỐN mới lên đơn được. Ba cách gỡ:\n  1) Thiết kế dựng hình rồi ĐẨY GIÁ VỐN từ plugin.\n  2) ceo/kho NHẬP GIÁ VỐN TAY ở app tài chính (tab Giá vốn theo đơn).\n  3) Nếu đơn KHÔNG cần dựng hình (mua ngoài/giường gỗ), ĐỔI LOẠI ĐƠN sang Lẻ.',
          new.ma_don;
      end if;
    end if;
  end if;
  return new;
end $$;

-- 5b. kiem_giam_gia (chốt giá) — nguyên bản db/036, chỉ đổi thông điệp du_an.
create or replace function kho.kiem_giam_gia(d kho.don_hang)
  returns void language plpgsql security definer set search_path = kho as $$
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
      select he_so_m into v_hesom from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
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
      select tran_truong_nhom into v_tran_tn from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
      if v_vt = 'ceo' then null;
      elsif v_vt = 'truong_nhom' then
        if v_pct > coalesce(v_tran_tn,8) + 1e-9 then
          raise exception 'Giảm % vượt quyền trưởng nhóm (%) — cần CEO', round(v_pct,2)||'%', round(v_tran_tn,2)||'%';
        end if;
      else raise exception 'Người duyệt "%" không đủ thẩm quyền giảm giá', coalesce(v_vt,'(không rõ)'); end if;
    end if;
  end if;
end $$;

commit;
