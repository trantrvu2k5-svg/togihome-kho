-- HOÀN TÁC 022 — đưa don_hang về đúng trạng thái SAU lô 021.
--   node ops/run_sql.mjs ../db/022_hoan_tac.sql
--   An toàn chạy nhiều lần (IF EXISTS). KHÔNG đụng dữ liệu kho khác. Bảng don_hang đang RỖNG.
begin;

-- Bảng mới của 022 (drop tự gỡ RLS/index/grant/policy của chúng).
drop table if exists kho.don_hang_nhat_ky;
drop table if exists kho.don_hang_mon;

-- Cột 022 thêm vào don_hang + ràng buộc kèm.
alter table kho.don_hang drop constraint if exists chk_loai;
alter table kho.don_hang drop constraint if exists chk_tien_coc;
alter table kho.don_hang
  drop column if exists loai,
  drop column if exists link,
  drop column if exists lap_ai,
  drop column if exists file_tk,
  drop column if exists nguoi_tk,
  drop column if exists lo,
  drop column if exists ghi_chu,
  drop column if exists ngay_du_kien,
  drop column if exists ngay_di_hang,
  drop column if exists ngay_giao,
  drop column if exists kgs,
  drop column if exists hoa_don,
  drop column if exists tinh_khach,
  drop column if exists tien_coc;

-- Trả tk_coc về kiểu SỐ TIỀN (numeric) + check như lô 021.
alter table kho.don_hang drop constraint if exists chk_tk_coc;
do $$ begin
  if (select data_type from information_schema.columns
      where table_schema='kho' and table_name='don_hang' and column_name='tk_coc') <> 'numeric' then
    alter table kho.don_hang alter column tk_coc type numeric using tk_coc::numeric;
  end if;
end $$;
alter table kho.don_hang drop constraint if exists don_hang_tk_coc_check;
alter table kho.don_hang add  constraint don_hang_tk_coc_check
  check (tk_coc is null or tk_coc >= 0);

commit;
