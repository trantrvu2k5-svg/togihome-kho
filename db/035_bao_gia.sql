-- 035 — TRẠNG THÁI 'bao_gia' (đơn thiết kế CHƯA có giá): đứng TRƯỚC moi_len_don trong luồng.
--   Đơn ở bao_gia = báo giá/nháp, CHƯA cam kết: bỏ qua mọi cổng chốt giá, không tính doanh thu, không
--   tính he_so_m. Chỉ khi CHUYỂN sang moi_len_don mới bật đủ cổng (món đủ giá + du_an có giá vốn).
--   node ops/run_sql.mjs ../db/035_bao_gia.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop trigger if exists trg_kiem_chuyen_trang_thai on kho.don_hang;
--   drop function if exists kho.kiem_chuyen_trang_thai();
--   drop policy if exists dh_doc_tk_baogia on kho.don_hang;
--   -- CHECK trang_thai: bỏ 'bao_gia' (⚠ chỉ chạy được khi KHÔNG còn đơn nào ở bao_gia)
--   alter table kho.don_hang drop constraint don_hang_trang_thai_check;
--   alter table kho.don_hang add constraint don_hang_trang_thai_check check (trang_thai in
--     ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat','dang_lam',
--      'xong_sx','cho_giao','da_giao','tam_ngung','huy'));
--   -- nhat_ky tu/den: bỏ 'bao_gia' khỏi hai constraint (chỉ khi không còn dòng nhật ký bao_gia).
--   alter table kho.don_hang_nhat_ky drop constraint don_hang_nhat_ky_tu_check;
--   alter table kho.don_hang_nhat_ky add constraint don_hang_nhat_ky_tu_check check (tu is null or tu in
--     ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy'));
--   alter table kho.don_hang_nhat_ky drop constraint don_hang_nhat_ky_den_check;
--   alter table kho.don_hang_nhat_ky add constraint don_hang_nhat_ky_den_check check (den in
--     ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy'));
--   -- kiem_giam_gia: chạy lại bản 034 (bỏ dòng bỏ-qua bao_gia).
--   -- tinh_he_so_m: chạy lại bản 032 (bỏ 'and d.trang_thai <> bao_gia').
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ══════════ 1. CHECK trang_thai — thêm 'bao_gia' đứng ĐẦU luồng ══════════
alter table kho.don_hang drop constraint don_hang_trang_thai_check;
alter table kho.don_hang add constraint don_hang_trang_thai_check
  check (trang_thai in
    ('bao_gia',                                       -- ← MỚI: đơn thiết kế chưa có giá (nháp/báo giá)
     'moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat','dang_lam',
     'xong_sx','cho_giao','da_giao','tam_ngung','huy'));

-- 1b. NHẬT KÝ chuyển trạng thái cũng miền cùng tập trạng thái -> tu/den phải nhận 'bao_gia'
--     (nếu không: app ghi nhật ký den='bao_gia' bị chặn -> banner đỏ, nhật ký thủng).
alter table kho.don_hang_nhat_ky drop constraint don_hang_nhat_ky_tu_check;
alter table kho.don_hang_nhat_ky add constraint don_hang_nhat_ky_tu_check
  check (tu is null or tu in
    ('bao_gia','moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat',
     'dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy'));
alter table kho.don_hang_nhat_ky drop constraint don_hang_nhat_ky_den_check;
alter table kho.don_hang_nhat_ky add constraint don_hang_nhat_ky_den_check
  check (den in
    ('bao_gia','moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat',
     'dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy'));

-- ══════════ 2. LUẬT CHUYỂN TRẠNG THÁI — chỉ áp khi RỜI bao_gia ══════════
--   • bao_gia → moi_len_don: MỌI món phải có giá > 0 (thiếu -> RAISE nói rõ món nào).
--   • bao_gia (du_an) → moi_len_don: phải CÓ giá vốn (đẩy từ plugin) mới lên đơn được.
--   • bao_gia KHÔNG nhảy thẳng vào dây sản xuất (nhan_thiet_ke..da_giao) — phải qua moi_len_don.
--   • huy / tam_ngung: cho phép (huỷ/ngưng một báo giá).
--   3 cổng có GUC tắt riêng (chan.off_mon_gia · chan.off_von_chuyen · chan.off_nhay) để test đối chứng.
create or replace function kho.kiem_chuyen_trang_thai() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare
  v_thieu text;
  v_day   text[] := array['nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat',
                          'dang_lam','xong_sx','cho_giao','da_giao'];   -- dây sản xuất (sau moi_len_don)
begin
  if tg_op = 'UPDATE' and old.trang_thai = 'bao_gia' and new.trang_thai <> 'bao_gia' then

    -- CHỐT nhảy: không cho bao_gia vọt thẳng vào dây sản xuất
    if current_setting('chan.off_nhay', true) is distinct from '1'
       and new.trang_thai = any (v_day) then
      raise exception 'Đơn báo giá "%" phải LÊN ĐƠN (moi_len_don) trước — không nhảy thẳng sang %',
        new.ma_don, new.trang_thai;
    end if;

    if new.trang_thai = 'moi_len_don' then
      -- CHỐT món giá: mọi món phải có giá > 0
      if current_setting('chan.off_mon_gia', true) is distinct from '1' then
        select string_agg(coalesce(nullif(btrim(m.ten),''), m.sp_id, '(món chưa tên)'), ', ')
          into v_thieu
          from kho.don_hang_mon m
          where m.don_id = new.id and coalesce(m.gia,0) <= 0;
        if v_thieu is not null then
          raise exception 'Chưa lên đơn được — món thiếu giá: %', v_thieu;
        end if;
      end if;

      -- CHỐT giá vốn: đơn thiết kế (du_an) phải đẩy giá vốn trước khi lên đơn
      if current_setting('chan.off_von_chuyen', true) is distinct from '1'
         and new.dong = 'du_an'
         and not exists (select 1 from kho.don_hang_gia_von g
                         where g.ma_don = new.ma_don and g.gia_chuyen_giao is not null) then
        raise exception 'Đơn thiết kế "%" chưa có giá vốn — chưa lên đơn được. Đẩy giá vốn từ plugin lên trước.',
          new.ma_don;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_kiem_chuyen_trang_thai on kho.don_hang;
create trigger trg_kiem_chuyen_trang_thai before update on kho.don_hang
  for each row execute function kho.kiem_chuyen_trang_thai();

-- ══════════ 3. kiem_giam_gia — đơn bao_gia BỎ QUA mọi cổng chốt giá ══════════
--   Bản 034 + 1 dòng đầu: bao_gia -> return ngay (chưa chốt thì không xét trần/sàn/lý do/giá vốn).
--   Cổng chốt chỉ bật từ moi_len_don trở đi (khi trang_thai đã rời bao_gia).
create or replace function kho.kiem_giam_gia(d kho.don_hang)
  returns void language plpgsql security definer set search_path = kho as $$
declare
  v_pct numeric; v_tran numeric; v_tran_tn numeric; v_san numeric; v_vt text; v_mon jsonb; v_hesom numeric;
begin
  -- BÁO GIÁ: đơn chưa chốt -> bỏ qua toàn bộ cổng chốt giá (kể cả CHỐT 0 giá vốn).
  if d.trang_thai = 'bao_gia' then return; end if;

  -- CHỐT 0: đơn thiết kế chốt mà chưa có giá vốn -> chặn (đẩy giá vốn từ plugin trước)
  if current_setting('chan.off_von', true) is distinct from '1'
     and d.gia_chot is not null and d.dong = 'du_an'
     and not exists (select 1 from kho.don_hang_gia_von g where g.ma_don = d.ma_don and g.gia_chuyen_giao is not null) then
    raise exception 'Đơn thiết kế "%" chưa có giá vốn — chưa chốt được. Đẩy giá vốn từ plugin lên trước.', d.ma_don;
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

-- ══════════ 4. tinh_he_so_m — LOẠI đơn bao_gia khỏi TB đơn (bản 032 + lọc bao_gia) ══════════
--   Đơn báo giá không có giá vốn/ship thật -> không được kéo vào trung bình đơn kỳ.
create or replace function kho.tinh_he_so_m(p_ma_ky text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare
  t record; v_hh numeric; v_gcg_tb numeric; v_ship_tb numeric;
  v_sum_gcg numeric; v_sum_ship numeric; v_sum_phi numeric; v_thieu text := '';
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then   -- NULL luôn CHẶN
    raise exception 'tinh_he_so_m: chỉ ceo/ke_toan';
  end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ma_ky;
  if not found then raise notice 'tinh_he_so_m(%): chưa có dòng tham số cho kỳ', p_ma_ky; return null; end if;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  select avg(g.gia_chuyen_giao) into v_gcg_tb
    from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky and d.trang_thai <> 'bao_gia';   -- LOẠI báo giá
  select avg(d.ship_thuc_tra) into v_ship_tb
    from kho.don_hang d where d.ma_ky_ap_dung = p_ma_ky and d.trang_thai <> 'bao_gia';   -- LOẠI báo giá
  if t.dt_muc_tieu     is null then v_thieu := v_thieu || 'dt_muc_tieu, '; end if;
  if t.so_don_ke_hoach is null or t.so_don_ke_hoach = 0 then v_thieu := v_thieu || 'so_don_ke_hoach, '; end if;
  if t.phi_don_le      is null then v_thieu := v_thieu || 'phi_don_le, '; end if;
  if v_gcg_tb is null then v_thieu := v_thieu || 'đơn có gia_chuyen_giao đóng dấu kỳ (gcg_TB rỗng), '; end if;
  if v_thieu <> '' then
    raise notice 'tinh_he_so_m(%): THIẾU %', p_ma_ky, rtrim(v_thieu, ', ');
    return null;
  end if;
  v_sum_gcg  := v_gcg_tb              * t.so_don_ke_hoach;
  v_sum_ship := coalesce(v_ship_tb,0) * t.so_don_ke_hoach;
  v_sum_phi  := t.phi_don_le          * t.so_don_ke_hoach;
  return (t.dt_muc_tieu * (1 - v_hh) - v_sum_ship - v_sum_phi) / v_sum_gcg;
end $$;
grant execute on function kho.tinh_he_so_m(text) to authenticated;

-- ══════════ 5. RLS — thiet_ke ĐỌC đơn bao_gia (để biết việc), KHÔNG chuyển trạng thái ══════════
--   sale đã có dh_them/dh_sua (021) -> tạo bao_gia + chuyển sang moi_len_don OK.
--   thiet_ke KHÔNG nằm trong dh_sua -> không update/chuyển. Thêm 1 policy SELECT chỉ hàng bao_gia.
drop policy if exists dh_doc_tk_baogia on kho.don_hang;
create policy dh_doc_tk_baogia on kho.don_hang for select
  using (kho.current_vai_tro() = 'thiet_ke' and trang_thai = 'bao_gia');

commit;
