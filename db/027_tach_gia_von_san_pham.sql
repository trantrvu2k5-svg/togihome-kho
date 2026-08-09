-- 027 — TÁCH cột giá vốn khỏi san_pham_mau (mọi vai trò đăng nhập đọc được) sang bảng RIÊNG
--   kho.san_pham_mau_gia_von — chỉ ceo/kho/ke_toan đọc/ghi (khuôn giống don_hang_gia_von).
--   Chuyển 14 dòng sang rồi DROP cột san_pham_mau.gia_von. Idempotent (chạy lại: cột đã drop -> bỏ qua).
--   node ops/run_sql.mjs ../db/027_tach_gia_von_san_pham.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod)
--
-- ══════════ HOÀN TÁC (trả cột gia_von về san_pham_mau, gỡ bảng tách) ══════════
--   begin;
--   alter table kho.san_pham_mau add column if not exists gia_von numeric;
--   update kho.san_pham_mau s set gia_von = g.gia_von from kho.san_pham_mau_gia_von g where g.ma = s.ma;
--   drop table if exists kho.san_pham_mau_gia_von;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists kho.san_pham_mau_gia_von (
  ma           text primary key references kho.san_pham_mau(ma) on delete cascade,
  gia_von      numeric check (gia_von is null or gia_von >= 0),
  cap_nhat_luc timestamptz not null default now()
);

-- Chuyển dữ liệu + drop cột — CHỈ khi cột còn tồn tại (idempotent, chạy lại không lỗi).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='kho' and table_name='san_pham_mau' and column_name='gia_von') then
    insert into kho.san_pham_mau_gia_von(ma, gia_von)
      select ma, gia_von from kho.san_pham_mau
      on conflict (ma) do update set gia_von = excluded.gia_von;
    alter table kho.san_pham_mau drop column gia_von;
  end if;
end $$;

-- GRANT theo bảng (anon revoke như don_hang_gia_von) + RLS chỉ ceo/kho/ke_toan.
grant select, insert, update on kho.san_pham_mau_gia_von to authenticated;
revoke all on kho.san_pham_mau_gia_von from anon;
alter table kho.san_pham_mau_gia_von enable row level security;

drop policy if exists spgv_doc  on kho.san_pham_mau_gia_von;
drop policy if exists spgv_sua  on kho.san_pham_mau_gia_von;
drop policy if exists spgv_them on kho.san_pham_mau_gia_von;
create policy spgv_doc  on kho.san_pham_mau_gia_von for select
  using (kho.current_vai_tro() = any(array['ceo','kho','ke_toan']));
create policy spgv_sua  on kho.san_pham_mau_gia_von for update
  using      (kho.current_vai_tro() = any(array['ceo','kho','ke_toan']))
  with check (kho.current_vai_tro() = any(array['ceo','kho','ke_toan']));
create policy spgv_them on kho.san_pham_mau_gia_von for insert
  with check (kho.current_vai_tro() = any(array['ceo','kho','ke_toan']));

commit;
