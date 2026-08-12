-- 052 — QUẢN LÝ TÀI KHOẢN (chỉ CEO): list · thêm · đổi vai · bật/tắt hoạt động (KHÔNG xoá) · đặt lại mật khẩu.
--   Ghi THẲNG DB (auth.users + auth.identities + kho.nguoi_dung) — thay đường cũ ghi bộ nhớ (reload là mất).
--   Tất cả RPC guard fail-đóng: chỉ ceo. Tạo/đổi mật khẩu chạm auth (SECURITY DEFINER owner=postgres).
--   node ops/run_sql.mjs ../db/052_quan_ly_tai_khoan.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.qly_dat_mat_khau(uuid,text); drop function if exists kho.qly_them_nguoi(text,text,text,text);
--   drop function if exists kho.qly_bat_tat(uuid,boolean); drop function if exists kho.qly_doi_vai(uuid,text);
--   drop function if exists kho.qly_ds_nguoi_dung();
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- helper guard (nội bộ)
create or replace function kho._chi_ceo(p_ham text) returns void language plpgsql stable as $$
begin
  if coalesce(kho.current_vai_tro(),'') <> 'ceo' then
    raise exception '%: chỉ CEO', p_ham; end if;
end $$;

-- ════════ 1) DANH SÁCH người dùng (kèm email từ auth.users) ════════
create or replace function kho.qly_ds_nguoi_dung()
  returns table(id uuid, ho_ten text, vai_tro text, dang_hoat_dong boolean, email text, tao_luc timestamptz)
  language plpgsql stable security definer set search_path = kho as $$
begin
  perform kho._chi_ceo('qly_ds_nguoi_dung');
  return query
    select n.id, n.ho_ten, n.vai_tro, n.dang_hoat_dong, u.email::text, n.tao_luc
    from kho.nguoi_dung n left join auth.users u on u.id = n.auth_uid
    order by n.dang_hoat_dong desc, n.ho_ten;
end $$;
grant execute on function kho.qly_ds_nguoi_dung() to authenticated;

-- ════════ 2) ĐỔI vai trò ════════
create or replace function kho.qly_doi_vai(p_ns_id uuid, p_vai text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  perform kho._chi_ceo('qly_doi_vai');
  if p_vai not in ('ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','truong_nhom_sale','tk_ban_hang') then
    raise exception 'qly_doi_vai: vai "%" không hợp lệ', p_vai; end if;
  update kho.nguoi_dung set vai_tro = p_vai, sua_luc = now() where id = p_ns_id;
  if not found then raise exception 'qly_doi_vai: không có người %', p_ns_id; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function kho.qly_doi_vai(uuid,text) to authenticated;

-- ════════ 3) BẬT/TẮT hoạt động (KHÔNG xoá — giữ vết) ════════
create or replace function kho.qly_bat_tat(p_ns_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  perform kho._chi_ceo('qly_bat_tat');
  update kho.nguoi_dung set dang_hoat_dong = p_on, sua_luc = now() where id = p_ns_id;
  if not found then raise exception 'qly_bat_tat: không có người %', p_ns_id; end if;
  return jsonb_build_object('ok', true, 'dang_hoat_dong', p_on);
end $$;
grant execute on function kho.qly_bat_tat(uuid,boolean) to authenticated;

-- ════════ 4) THÊM người mới (auth.users + auth.identities + nguoi_dung) ════════
create or replace function kho.qly_them_nguoi(p_email text, p_ho_ten text, p_vai text, p_mat_khau text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_uid uuid := gen_random_uuid(); v_email text := lower(btrim(p_email));
begin
  perform kho._chi_ceo('qly_them_nguoi');
  if p_vai not in ('ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','truong_nhom_sale','tk_ban_hang') then
    raise exception 'qly_them_nguoi: vai "%" không hợp lệ', p_vai; end if;
  if coalesce(v_email,'') = '' or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'qly_them_nguoi: email không hợp lệ'; end if;
  if length(coalesce(p_mat_khau,'')) < 6 then raise exception 'qly_them_nguoi: mật khẩu tối thiểu 6 ký tự'; end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'qly_them_nguoi: email "%" đã tồn tại', v_email; end if;

  -- ⚠ GoTrue so chuỗi trên các cột token -> phải là '' (rỗng), KHÔNG để NULL, nếu không LOGIN BÁO SAI mật khẩu.
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                         confirmation_token, recovery_token, email_change_token_new, email_change)
    values(v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
           extensions.crypt(p_mat_khau, extensions.gen_salt('bf')), now(),
           '{"provider":"email","providers":["email"]}'::jsonb,
           jsonb_build_object('email_verified', true), now(), now(),
           '', '', '', '');
  -- auth.identities.email là cột GENERATED (từ identity_data->>'email') — KHÔNG chèn thẳng.
  insert into auth.identities(id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values(gen_random_uuid(), v_uid::text, v_uid,
           jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
           'email', now(), now(), now());
  insert into kho.nguoi_dung(auth_uid, ho_ten, vai_tro, dang_hoat_dong)
    values(v_uid, p_ho_ten, p_vai, true);
  return jsonb_build_object('ok', true, 'auth_uid', v_uid, 'email', v_email);
end $$;
grant execute on function kho.qly_them_nguoi(text,text,text,text) to authenticated;

-- ════════ 5) ĐẶT LẠI mật khẩu ════════
create or replace function kho.qly_dat_mat_khau(p_ns_id uuid, p_mat_khau text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_auth uuid;
begin
  perform kho._chi_ceo('qly_dat_mat_khau');
  if length(coalesce(p_mat_khau,'')) < 6 then raise exception 'qly_dat_mat_khau: mật khẩu tối thiểu 6 ký tự'; end if;
  select auth_uid into v_auth from kho.nguoi_dung where id = p_ns_id;
  if v_auth is null then raise exception 'qly_dat_mat_khau: không có người % (hoặc chưa gán auth)', p_ns_id; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_mat_khau, extensions.gen_salt('bf')), updated_at = now()
   where id = v_auth;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function kho.qly_dat_mat_khau(uuid,text) to authenticated;

commit;
