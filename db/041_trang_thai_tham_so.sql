-- 041 — NHÃN TẠM/ĐÃ CHỐT theo TỪNG tham số kỳ (thay 1 cột ghi_chu chung không tách được).
--   Bảng trang_thai_tham_so + RPC toggle (guard ceo/ke_toan — KHÔNG sửa policy, giống ghi_so_tham_so_xuong).
--   CHỈ hiển thị/đánh dấu — KHÔNG đụng công thức giá.
--   node ... — ⚠ CHỜ TEST XANH. CHƯA áp prod.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.dat_trang_thai_tham_so(text, text, text);
--   drop table if exists kho.trang_thai_tham_so;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists kho.trang_thai_tham_so (
  ma_ky       text not null,
  ten_tham_so text not null,     -- khoá tham số (dt_muc_tieu, hh_sale, ...)
  trang_thai  text not null default 'tam' check (trang_thai in ('tam','da_chot')),
  ghi_chu     text,
  nguoi_chot  uuid references kho.nguoi_dung(id),
  ngay_chot   timestamptz,
  primary key (ma_ky, ten_tham_so)
);
grant select on kho.trang_thai_tham_so to authenticated;
revoke all on kho.trang_thai_tham_so from anon;
alter table kho.trang_thai_tham_so enable row level security;
drop policy if exists ttts_doc on kho.trang_thai_tham_so;
create policy ttts_doc on kho.trang_thai_tham_so for select using (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- RPC toggle 1 tham số. da_chot -> ghi người + ngày; tam -> xoá dấu chốt. Guard ceo/ke_toan (SECURITY DEFINER).
create or replace function kho.dat_trang_thai_tham_so(p_ma_ky text, p_ten text, p_trang_thai text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_uid uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'dat_trang_thai_tham_so: chỉ ceo/ke_toan'; end if;
  if p_trang_thai not in ('tam','da_chot') then
    raise exception 'dat_trang_thai_tham_so: trạng thái phải tam | da_chot'; end if;
  select id into v_uid from kho.nguoi_dung where auth_uid = auth.uid();
  insert into kho.trang_thai_tham_so(ma_ky, ten_tham_so, trang_thai, nguoi_chot, ngay_chot)
    values(p_ma_ky, p_ten, p_trang_thai,
           case when p_trang_thai='da_chot' then v_uid end,
           case when p_trang_thai='da_chot' then now() end)
    on conflict (ma_ky, ten_tham_so) do update set
      trang_thai = excluded.trang_thai, nguoi_chot = excluded.nguoi_chot, ngay_chot = excluded.ngay_chot;
  return jsonb_build_object('ok', true, 'ma_ky', p_ma_ky, 'ten_tham_so', p_ten, 'trang_thai', p_trang_thai);
end $$;
grant execute on function kho.dat_trang_thai_tham_so(text, text, text) to authenticated;

commit;
