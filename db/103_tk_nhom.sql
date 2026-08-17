-- db/103 — L-73 PHẦN B: khối "Nhóm" app Thiết kế (trưởng nhóm TK) + mở vai truong_nhom_thiet_ke cho tài khoản. Idempotent.
--   (a) qly_them_nguoi + qly_doi_vai: THÊM 'truong_nhom_thiet_ke' vào whitelist (vai đã có trong guard nhưng chưa GÁN được).
--   (b) MỚI tk_nhom: 3 khối (việc theo người · giờ ước-vs-thực · chất lượng bản). Guard truong_nhom_thiet_ke/ceo, limit, KHÔNG giá vốn.
-- ═════ HOÀN TÁC: chạy lại db/052(-ish) khôi phục whitelist; drop function tk_nhom(int,int). ═════
begin;

-- ── (a) whitelist (body sao NGUYÊN, +truong_nhom_thiet_ke) ──
CREATE OR REPLACE FUNCTION kho.qly_them_nguoi(p_email text, p_ho_ten text, p_vai text, p_mat_khau text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_uid uuid := gen_random_uuid(); v_email text := lower(btrim(p_email));
begin
  perform kho._chi_ceo('qly_them_nguoi');
  if p_vai not in ('ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','truong_nhom_sale','tk_ban_hang','truong_nhom_thiet_ke') then
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
end $function$
;

CREATE OR REPLACE FUNCTION kho.qly_doi_vai(p_ns_id uuid, p_vai text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
begin
  perform kho._chi_ceo('qly_doi_vai');
  if p_vai not in ('ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','truong_nhom_sale','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'qly_doi_vai: vai "%" không hợp lệ', p_vai; end if;
  update kho.nguoi_dung set vai_tro = p_vai, sua_luc = now() where id = p_ns_id;
  if not found then raise exception 'qly_doi_vai: không có người %', p_ns_id; end if;
  return jsonb_build_object('ok', true);
end $function$
;

-- ── (b) MỚI · tk_nhom: 3 khối khối "Nhóm" app Thiết kế. Guard truong_nhom_thiet_ke/ceo, limit. KHÔNG giá vốn. ──
create or replace function kho.tk_nhom(p_ngay int default 30, p_gioi_han int default 50)
  returns jsonb language plpgsql stable security definer set search_path = kho as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('truong_nhom_thiet_ke','ceo') then
    raise exception 'tk_nhom: chỉ truong_nhom_thiet_ke/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  return jsonb_build_object('nguong_tam', 30, 'so_ngay', p_ngay,

  -- KHỐI 1 · VIỆC THEO NGƯỜI (phân hoạch đơn-trong-thiết-kế theo ma_ns_thiet_ke; NULL = chưa ai nhận)
  'viec', (
    with scope as (
      select d.ma_don, d.ma_ns_thiet_ke, d.luc_nhan_thiet_ke, d.ngay_chot,
        (select count(*) from kho.ban_thiet_ke b where b.ma_don=d.ma_don and b.trang_thai in ('khach_doi_y','chua_dung_yeu_cau')) vong
      from kho.don_hang d
      where coalesce(d.la_demo,false)=false and d.trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file')
    ), byng as (
      select ma_ns_thiet_ke, count(*) dang_cam,
        max(current_date - coalesce(luc_nhan_thiet_ke::date, ngay_chot, current_date)) cho_lau,
        max(vong) sua_vong
      from scope group by ma_ns_thiet_ke
    )
    select jsonb_build_object('tong', (select count(*) from scope),
      'ds', coalesce((select jsonb_agg(jsonb_build_object(
        'nguoi', coalesce((select ho_ten from kho.nguoi_dung n where n.id=z.ma_ns_thiet_ke),'(chưa ai nhận)'),
        'la_orphan', z.ma_ns_thiet_ke is null,
        'dang_cam', z.dang_cam, 'cho_lau', z.cho_lau, 'sua_vong', z.sua_vong) order by (z.ma_ns_thiet_ke is null), z.dang_cam desc)
      from (select * from byng order by (ma_ns_thiet_ke is null), dang_cam desc limit greatest(p_gioi_han,0)) z),'[]'::jsonb))),

  -- KHỐI 2 · GIỜ ƯỚC (don_hang.gio_thiet_ke) vs THỰC (gio_thiet_ke_thuc.gio_thuc), 30 ngày, theo người
  'gio', (
    select coalesce((select jsonb_agg(jsonb_build_object(
        'nguoi', coalesce((select ho_ten from kho.nguoi_dung nn where nn.id=z.ns),'(?)'),
        'uoc', round(z.uoc,1), 'thuc', round(z.thuc,1),
        'chenh_pct', case when z.uoc>0 then round((z.thuc-z.uoc)/z.uoc*100,1) end, 'n', z.n) order by (z.uoc+z.thuc) desc)
      from (
        select k.ns,
          coalesce((select sum(coalesce(d.gio_thiet_ke,0)) from kho.don_hang d where d.ma_ns_thiet_ke=k.ns and coalesce(d.la_demo,false)=false and coalesce(d.luc_nhan_thiet_ke, d.ngay_chot::timestamptz) >= now()-(p_ngay||' days')::interval),0) uoc,
          coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_ns=k.ns and g.ghi_luc >= now()-(p_ngay||' days')::interval),0) thuc,
          coalesce((select count(*)::int from kho.don_hang d where d.ma_ns_thiet_ke=k.ns and coalesce(d.la_demo,false)=false and coalesce(d.luc_nhan_thiet_ke, d.ngay_chot::timestamptz) >= now()-(p_ngay||' days')::interval),0) n
        from (
          select ma_ns_thiet_ke ns from kho.don_hang where ma_ns_thiet_ke is not null and coalesce(la_demo,false)=false and coalesce(luc_nhan_thiet_ke, ngay_chot::timestamptz) >= now()-(p_ngay||' days')::interval
          union select ma_ns from kho.gio_thiet_ke_thuc where ghi_luc >= now()-(p_ngay||' days')::interval and ma_ns is not null
        ) k
        order by (1) desc limit greatest(p_gioi_han,0)
      ) z),'[]'::jsonb)),

  -- KHỐI 3 · CHẤT LƯỢNG BẢN 30 ngày theo NGƯỜI DỰNG (ban_thiet_ke.ma_ns_gui) — dùng lại "mình dựng" của tk_chuong (c)
  'chat', (
    with b as (
      select bt.ma_ns_gui ns, bt.ma_don, bt.trang_thai bt_tt, d.trang_thai don_tt,
        (select count(*) from kho.ban_thiet_ke b2 where b2.ma_don=bt.ma_don and b2.trang_thai in ('khach_doi_y','chua_dung_yeu_cau')) vong
      from kho.ban_thiet_ke bt join kho.don_hang d on d.ma_don=bt.ma_don
      where coalesce(d.la_demo,false)=false and bt.luc_gui >= now()-(p_ngay||' days')::interval and bt.ma_ns_gui is not null
    ), byg as (
      select ns, count(*) ban_gui, round(avg(vong),2) vong_tb,
        round(count(*) filter (where bt_tt='khach_duyet')::numeric/nullif(count(*),0),3) ti_le_duyet,
        count(distinct ma_don) filter (where don_tt not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy','tam_ngung')) chot,
        count(distinct ma_don) filter (where don_tt='bao_gia_thua') thua
      from b group by ns
    )
    select coalesce((select jsonb_agg(jsonb_build_object(
        'nguoi', coalesce((select ho_ten from kho.nguoi_dung n where n.id=z.ns),'(?)'),
        'ban_gui', z.ban_gui, 'vong_tb', z.vong_tb, 'ti_le_duyet', z.ti_le_duyet,
        'chot', z.chot, 'thua', z.thua, 'n', z.ban_gui) order by z.ban_gui desc)
      from (select * from byg order by ban_gui desc limit greatest(p_gioi_han,0)) z),'[]'::jsonb)));
end $fn$;
grant execute on function kho.tk_nhom(int,int) to authenticated;

do $$ begin
  if to_regprocedure('kho.tk_nhom(int,int)') is null then raise exception 'THIẾU tk_nhom'; end if;
  raise notice 'db/103 OK: whitelist +truong_nhom_thiet_ke (qly_them_nguoi, qly_doi_vai) + tk_nhom (3 khối).';
end $$;
commit;
