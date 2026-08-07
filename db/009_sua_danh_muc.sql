-- KHO-3 — Kích hoạt sửa danh mục cho ceo/kho (grant cột + RLS gate) + dấu vết (trigger).
--   Giá vốn (ton.gia_von_bq) KHÔNG cấp update -> không sửa tay được (một-bản-sự-thật, đổi qua phiếu).
--   XOÁ: không cấp cho ai (vật tư có giao dịch -> xoá làm hỏng thẻ kho). Ngừng dùng = cờ ngung_dung.
begin;

-- 1) Cờ ngừng-dùng (thay cho xoá).
alter table kho.vat_tu add column if not exists ngung_dung boolean not null default false;

-- 2) DẤU VẾT: bảng nhật ký + trigger (ai · lúc nào · sửa gì). Trigger security-definer -> ghi được dù
--    người sửa không có quyền trên bảng nhật ký.
create table if not exists kho.nhat_ky_danh_muc (
  id uuid primary key default gen_random_uuid(),
  bang text not null, ban_ghi_id uuid, hanh_dong text not null,     -- insert | update
  thay_doi jsonb, nguoi uuid references kho.nguoi_dung(id), luc timestamptz not null default now()
);
alter table kho.nhat_ky_danh_muc enable row level security;
drop policy if exists nk_doc on kho.nhat_ky_danh_muc;
create policy nk_doc on kho.nhat_ky_danh_muc for select using (kho.current_vai_tro() in ('ceo','kho'));
grant select on kho.nhat_ky_danh_muc to authenticated;   -- RLS lọc ceo/kho

create or replace function kho.ghi_nhat_ky_danh_muc() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare uid uuid; diff jsonb;
begin
  select id into uid from nguoi_dung where auth_uid = auth.uid();
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, jsonb_build_object('cu', o.value, 'moi', n.value)) into diff
      from jsonb_each(to_jsonb(old)) o join jsonb_each(to_jsonb(new)) n on n.key = o.key
      where o.key not in ('sua_luc','tao_luc') and o.value is distinct from n.value;
    if diff is null then return new; end if;           -- không đổi gì thực -> không ghi
  end if;
  insert into nhat_ky_danh_muc(bang, ban_ghi_id, hanh_dong, thay_doi, nguoi)
    values (tg_table_name, new.id, lower(tg_op), coalesce(diff, to_jsonb(new)), uid);
  return new;
end $$;
revoke execute on function kho.ghi_nhat_ky_danh_muc() from public;   -- không phải entry point; hygiene

drop trigger if exists tg_nk_vat_tu on kho.vat_tu;
drop trigger if exists tg_nk_nhom on kho.nhom;
drop trigger if exists tg_nk_ncc on kho.nha_cung_cap;
create trigger tg_nk_vat_tu after insert or update on kho.vat_tu       for each row execute function kho.ghi_nhat_ky_danh_muc();
create trigger tg_nk_nhom    after insert or update on kho.nhom         for each row execute function kho.ghi_nhat_ky_danh_muc();
create trigger tg_nk_ncc     after insert or update on kho.nha_cung_cap for each row execute function kho.ghi_nhat_ky_danh_muc();

-- 3) GRANT sửa danh mục cho authenticated (RLS 'ghi_ceo_kho' gate ceo/kho; tho/anon chặn).
--    vat_tu: UPDATE chỉ các cột cho phép (KHÔNG ma/loai/id/tao_luc) + INSERT thêm mã. KHÔNG cấp DELETE.
grant insert on kho.vat_tu to authenticated;
grant update (ten,nhom_id,dvt,so_moi_dvt,dvt_goc,do_day_mm,vat_lieu,hoan_thien,ma_van_ncc,anh_ma,
              ton_toi_thieu,can_kiem_tra,ghi_chu_co,ngung_dung,sua_luc,nguoi_thao_tac)
  on kho.vat_tu to authenticated;
grant insert, update on kho.nhom to authenticated;
grant insert, update on kho.nha_cung_cap to authenticated;

-- 4) KIỂM tự RAISE.
do $$
begin
  -- ceo/kho sửa được: authenticated có UPDATE cột ten + INSERT vat_tu
  if not has_column_privilege('authenticated','kho.vat_tu','ten','UPDATE')          then raise exception 'HỎNG: authenticated không UPDATE được vat_tu.ten'; end if;
  if not has_table_privilege('authenticated','kho.vat_tu','INSERT')                 then raise exception 'HỎNG: authenticated không INSERT được vat_tu'; end if;
  if not has_table_privilege('authenticated','kho.nha_cung_cap','INSERT')           then raise exception 'HỎNG: authenticated không INSERT được nha_cung_cap'; end if;
  -- giá vốn KHÔNG sửa tay: authenticated KHÔNG có UPDATE trên ton (bất kỳ cột)
  if has_column_privilege('authenticated','kho.ton','gia_von_bq','UPDATE')          then raise exception 'HỎNG: authenticated UPDATE được ton.gia_von_bq (sửa giá tay)'; end if;
  if has_column_privilege('authenticated','kho.ton','so_luong','UPDATE')            then raise exception 'HỎNG: authenticated UPDATE được ton.so_luong'; end if;
  -- ma/loai KHÔNG cho sửa
  if has_column_privilege('authenticated','kho.vat_tu','ma','UPDATE')               then raise exception 'HỎNG: authenticated sửa được vat_tu.ma'; end if;
  if has_column_privilege('authenticated','kho.vat_tu','loai','UPDATE')             then raise exception 'HỎNG: authenticated sửa được vat_tu.loai'; end if;
  -- XOÁ không ai được
  if has_table_privilege('authenticated','kho.vat_tu','DELETE')                     then raise exception 'HỎNG: authenticated xoá được vat_tu'; end if;
  if has_table_privilege('anon','kho.vat_tu','INSERT') or has_table_privilege('anon','kho.vat_tu','UPDATE') then raise exception 'HỎNG: anon ghi được vat_tu'; end if;
  raise notice 'OK 009: ceo/kho sửa+thêm danh mục (RLS gate); giá vốn/ma/loai KHÔNG sửa tay; không ai xoá; anon chặn; dấu vết bằng trigger';
end $$;

commit;
