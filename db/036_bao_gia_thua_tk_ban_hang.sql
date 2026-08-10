-- 036 — VÒNG ĐỜI BÁO GIÁ (thua/treo + lý do + mốc ngày + giờ thực) · VAI tk_ban_hang (thiết kế bán hàng).
--   node ops/run_sql.mjs ../db/036_bao_gia_thua_tk_ban_hang.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   -- C: vòng đời báo giá
--   drop function if exists kho.gio_theo_ket_qua(text);
--   drop trigger if exists trg_moc_bao_gia on kho.don_hang;
--   drop function if exists kho.moc_bao_gia();
--   drop table if exists kho.gio_thiet_ke_thuc;
--   alter table kho.don_hang drop column if exists ly_do_thua, drop column if exists ghi_chu_thua,
--     drop column if exists ngay_tao_bao_gia, drop column if exists ngay_ket_thuc_bao_gia;
--   -- CHECK trang_thai + nhat_ky: bỏ bao_gia_thua/treo (chỉ khi không còn dòng nào dùng)
--   alter table kho.don_hang drop constraint don_hang_trang_thai_check;
--   alter table kho.don_hang add constraint don_hang_trang_thai_check check (trang_thai in
--     ('bao_gia','moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy'));
--   -- kiem_giam_gia + tinh_he_so_m: chạy lại bản 035. ghi_gia_von_don: chạy lại bản 034.
--   -- B: vai tk_ban_hang — ALTER POLICY bỏ 'tk_ban_hang' khỏi 14 policy; CHECK vai_tro bỏ tk_ban_hang.
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ PHẦN B — VAI tk_ban_hang (quyền GIỐNG sale; KHÔNG thấy giá vốn) ═══════════════
-- B1. Mở giá trị vai_tro.
alter table kho.nguoi_dung drop constraint nguoi_dung_vai_tro_check;
alter table kho.nguoi_dung add constraint nguoi_dung_vai_tro_check
  check (vai_tro = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','truong_nhom_sale','tk_ban_hang']));

-- B1. Thêm tk_ban_hang vào ĐÚNG 14 policy đang có 'sale' (ALTER POLICY — giữ nguyên cmd/role, chỉ nới biểu thức).
--   don_hang
alter policy dh_them on kho.don_hang with check (kho.current_vai_tro() = any(array['ceo','kho','sale','tk_ban_hang']));
alter policy dh_doc  on kho.don_hang using      (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
alter policy dh_sua  on kho.don_hang using      (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']))
                              with check (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
--   don_hang_mon
alter policy dhm_ghi on kho.don_hang_mon using      (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','tk_ban_hang']))
                                 with check (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','tk_ban_hang']));
alter policy dhm_doc on kho.don_hang_mon using      (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
--   don_hang_nhat_ky
alter policy dhnk_them on kho.don_hang_nhat_ky with check (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
alter policy dhnk_doc  on kho.don_hang_nhat_ky using      (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
--   khach
alter policy khach_ghi on kho.khach using      (kho.current_vai_tro() = any(array['ceo','kho','sale','tk_ban_hang']))
                                with check (kho.current_vai_tro() = any(array['ceo','kho','sale','tk_ban_hang']));
alter policy khach_doc on kho.khach using      (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
--   danh mục (đọc để dựng báo giá)
alter policy dm_doc on kho.don_vi_van_chuyen using (kho.current_vai_tro() = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
alter policy dm_doc on kho.mau_sac           using (kho.current_vai_tro() = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
alter policy dm_doc on kho.san_pham_mau      using (kho.current_vai_tro() = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
alter policy dm_doc on kho.thuong_hieu       using (kho.current_vai_tro() = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));
alter policy dm_doc on kho.vat_lieu_ban      using (kho.current_vai_tro() = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','tk_ban_hang']));

-- B2. GIÁ VỐN vẫn ẩn với tk_ban_hang: KHÔNG thêm nó vào bất kỳ policy nào của don_hang_gia_von /
--   tham_so_tai_chinh / san_pham_mau_gia_von (những bảng KHÔNG có 'sale' -> không đụng). ghi_gia_von_don
--   guard vẫn ('ceo','kho','thiet_ke') -> tk_ban_hang bị CHẶN. (Không sửa ở đây — chỉ khẳng định.)

-- ═══════════════ PHẦN C — VÒNG ĐỜI BÁO GIÁ + ĐO GIỜ ═══════════════
-- C1. Hai trạng thái kết thúc báo giá + lý do thua.
alter table kho.don_hang drop constraint don_hang_trang_thai_check;
alter table kho.don_hang add constraint don_hang_trang_thai_check
  check (trang_thai in
    ('bao_gia','bao_gia_thua','bao_gia_treo',                       -- ← MỚI: báo giá đã kết thúc
     'moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat','dang_lam',
     'xong_sx','cho_giao','da_giao','tam_ngung','huy'));
-- nhat_ky miền cùng tập trạng thái
alter table kho.don_hang_nhat_ky drop constraint don_hang_nhat_ky_tu_check;
alter table kho.don_hang_nhat_ky add constraint don_hang_nhat_ky_tu_check
  check (tu is null or tu in
    ('bao_gia','bao_gia_thua','bao_gia_treo','moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file',
     'cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy'));
alter table kho.don_hang_nhat_ky drop constraint don_hang_nhat_ky_den_check;
alter table kho.don_hang_nhat_ky add constraint don_hang_nhat_ky_den_check
  check (den in
    ('bao_gia','bao_gia_thua','bao_gia_treo','moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file',
     'cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy'));

alter table kho.don_hang add column if not exists ly_do_thua text
  check (ly_do_thua is null or ly_do_thua in ('gia_cao','cham','doi_y','chon_noi_khac','khac'));
alter table kho.don_hang add column if not exists ghi_chu_thua text;
-- C2. Mốc thời gian báo giá (ghi tự động bằng trigger).
alter table kho.don_hang add column if not exists ngay_tao_bao_gia      timestamptz;
alter table kho.don_hang add column if not exists ngay_ket_thuc_bao_gia timestamptz;

-- C1+C2 trigger: bắt buộc ly_do_thua khi vào bao_gia_thua + đóng/mở mốc ngày. GUC chan.off_thua để test.
create or replace function kho.moc_bao_gia() returns trigger
  language plpgsql security definer set search_path = kho as $$
begin
  -- CHỐT lý do thua: vào bao_gia_thua phải có ly_do_thua
  if new.trang_thai = 'bao_gia_thua'
     and (tg_op = 'INSERT' or old.trang_thai is distinct from 'bao_gia_thua')
     and current_setting('chan.off_thua', true) is distinct from '1'
     and coalesce(btrim(new.ly_do_thua), '') = '' then
    raise exception 'Đơn báo giá thua phải có lý do (ly_do_thua): gia_cao/cham/doi_y/chon_noi_khac/khac';
  end if;
  -- Mốc ngày
  if tg_op = 'INSERT' then
    if new.trang_thai = 'bao_gia' then new.ngay_tao_bao_gia := coalesce(new.ngay_tao_bao_gia, now()); end if;
  else
    if new.trang_thai = 'bao_gia' and old.trang_thai is distinct from 'bao_gia' then
      new.ngay_tao_bao_gia := coalesce(new.ngay_tao_bao_gia, now());
    end if;
    if old.trang_thai = 'bao_gia' and new.trang_thai is distinct from 'bao_gia' then
      new.ngay_ket_thuc_bao_gia := coalesce(new.ngay_ket_thuc_bao_gia, now());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_moc_bao_gia on kho.don_hang;
create trigger trg_moc_bao_gia before insert or update on kho.don_hang
  for each row execute function kho.moc_bao_gia();

-- C3. GIỜ THIẾT KẾ THỰC — ai bỏ bao nhiêu giờ vào đơn nào, loại giờ nào.
create table if not exists kho.gio_thiet_ke_thuc (
  id        uuid primary key default gen_random_uuid(),
  ma_don    text not null references kho.don_hang(ma_don) on delete cascade,
  ma_ns     uuid not null references kho.nguoi_dung(id),
  loai_gio  text not null check (loai_gio in ('ban_hang','xuong')),
  gio_thuc  numeric not null check (gio_thuc >= 0),
  cap       text,
  ghi_luc   timestamptz not null default now()
);
create index if not exists idx_gtt_ma_don on kho.gio_thiet_ke_thuc (ma_don);
grant select, insert on kho.gio_thiet_ke_thuc to authenticated;
revoke all on kho.gio_thiet_ke_thuc from anon;
alter table kho.gio_thiet_ke_thuc enable row level security;
-- Đọc: ceo/ke_toan hết; người khác chỉ dòng CỦA MÌNH (sale/tk_ban_hang không thấy dòng người khác).
drop policy if exists gtt_doc on kho.gio_thiet_ke_thuc;
create policy gtt_doc on kho.gio_thiet_ke_thuc for select using (
  kho.current_vai_tro() = any(array['ceo','ke_toan'])
  or ma_ns = (select id from kho.nguoi_dung where auth_uid = auth.uid()));
-- Ghi: tk_ban_hang ghi dòng 'ban_hang' của mình; thiet_ke ghi dòng 'xuong' của mình.
drop policy if exists gtt_ghi on kho.gio_thiet_ke_thuc;
create policy gtt_ghi on kho.gio_thiet_ke_thuc for insert with check (
  ma_ns = (select id from kho.nguoi_dung where auth_uid = auth.uid())
  and (
    (kho.current_vai_tro() = 'tk_ban_hang' and loai_gio = 'ban_hang')
    or (kho.current_vai_tro() = 'thiet_ke' and loai_gio = 'xuong')
  ));

-- C4. gio_theo_ket_qua — theo KẾT QUẢ đơn, KHÔNG theo tỷ lệ. Trả hai tổng riêng. Chưa nối phi_don.
--   thua/treo -> mọi giờ = chi phí bán hàng · đã thành đơn hàng -> mọi giờ = khối ③ giá vốn đơn đó.
create or replace function kho.gio_theo_ket_qua(p_ma_ky text)
  returns table (gio_ban_hang numeric, gio_von numeric)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'gio_theo_ket_qua: chỉ ceo/ke_toan';
  end if;
  return query
    select
      coalesce(sum(g.gio_thuc) filter (where d.trang_thai in ('bao_gia_thua','bao_gia_treo')), 0),
      coalesce(sum(g.gio_thuc) filter (where d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo')), 0)
    from kho.gio_thiet_ke_thuc g
    join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky;
end $$;
grant execute on function kho.gio_theo_ket_qua(text) to authenticated;

-- C5. bao_gia_* KHÔNG chốt giá + KHÔNG vào doanh thu/he_so_m.
create or replace function kho.kiem_giam_gia(d kho.don_hang)
  returns void language plpgsql security definer set search_path = kho as $$
declare
  v_pct numeric; v_tran numeric; v_tran_tn numeric; v_san numeric; v_vt text; v_mon jsonb; v_hesom numeric;
begin
  -- BÁO GIÁ (đang chạy / thua / treo): chưa/không chốt -> bỏ qua toàn bộ cổng chốt giá.
  if d.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then return; end if;

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

create or replace function kho.tinh_he_so_m(p_ma_ky text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare
  t record; v_hh numeric; v_gcg_tb numeric; v_ship_tb numeric;
  v_sum_gcg numeric; v_sum_ship numeric; v_sum_phi numeric; v_thieu text := '';
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'tinh_he_so_m: chỉ ceo/ke_toan';
  end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ma_ky;
  if not found then raise notice 'tinh_he_so_m(%): chưa có dòng tham số cho kỳ', p_ma_ky; return null; end if;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  select avg(g.gia_chuyen_giao) into v_gcg_tb
    from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky and d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo');
  select avg(d.ship_thuc_tra) into v_ship_tb
    from kho.don_hang d where d.ma_ky_ap_dung = p_ma_ky and d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo');
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

-- C7. Plugin đẩy giá vốn kèm GIỜ XUONG (tuỳ chọn). Thêm param gio_xuong; >0 -> ghi 1 dòng gio_thiet_ke_thuc
--   loai_gio='xuong', ma_ns = người đẩy. Bỏ trống vẫn đẩy giá vốn (báo chưa ghi giờ ở doc trả về).
drop function if exists kho.ghi_gia_von_don(text, numeric, numeric, numeric, numeric);   -- bỏ bản 5 tham số (tránh nhập nhằng)
create or replace function kho.ghi_gia_von_don(ma_don text, khoi_1 numeric, khoi_2 numeric, khoi_3 numeric,
                                               gia_chuyen_giao numeric, gio_xuong numeric default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
#variable_conflict use_column
declare v_uid uuid; v_gio_ghi boolean := false;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke') then
    raise exception 'ghi_gia_von_don: chỉ ceo/kho/thiet_ke được đẩy giá vốn';
  end if;
  if not exists (select 1 from kho.don_hang d where d.ma_don = ghi_gia_von_don.ma_don) then
    raise exception 'ghi_gia_von_don: không có đơn "%"', ghi_gia_von_don.ma_don;
  end if;
  select nd.id into v_uid from kho.nguoi_dung nd where nd.auth_uid = auth.uid();
  insert into kho.don_hang_gia_von (ma_don, khoi_1, khoi_2, khoi_3, gia_chuyen_giao, nguoi_day, cap_nhat_luc)
    values (ghi_gia_von_don.ma_don, ghi_gia_von_don.khoi_1, ghi_gia_von_don.khoi_2, ghi_gia_von_don.khoi_3,
            ghi_gia_von_don.gia_chuyen_giao, v_uid, now())
  on conflict (ma_don) do update set
    khoi_1 = excluded.khoi_1, khoi_2 = excluded.khoi_2, khoi_3 = excluded.khoi_3,
    gia_chuyen_giao = excluded.gia_chuyen_giao, nguoi_day = excluded.nguoi_day, cap_nhat_luc = excluded.cap_nhat_luc;
  -- GIỜ xưởng (tuỳ chọn)
  if gio_xuong is not null and gio_xuong > 0 then
    insert into kho.gio_thiet_ke_thuc (ma_don, ma_ns, loai_gio, gio_thuc, cap, ghi_luc)
      values (ghi_gia_von_don.ma_don, v_uid, 'xuong', gio_xuong, null, now());
    v_gio_ghi := true;
  end if;
  return jsonb_build_object('ok', true, 'ma_don', ghi_gia_von_don.ma_don, 'nguoi_day', v_uid,
                            'gio_da_ghi', v_gio_ghi, 'luc', now());
end $$;
grant execute on function kho.ghi_gia_von_don(text, numeric, numeric, numeric, numeric, numeric) to authenticated;
revoke all on function kho.ghi_gia_von_don(text, numeric, numeric, numeric, numeric, numeric) from anon;

commit;
