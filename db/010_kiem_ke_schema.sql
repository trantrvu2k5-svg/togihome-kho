-- KHO-4 — Kiểm kê ván: cột giá tham khảo (≠ giá vốn) + loại giao dịch 'kiem_ke' + dvt='tấm'.
--   gia_tham_khao = giá mua thật để đối chiếu lần nhập sau, KHÔNG phải giá vốn. Thợ KHÔNG được xem (như giá vốn).
begin;

-- 1) Cột giá tham khảo (nhãn rõ, tách khỏi giá vốn).
alter table kho.vat_tu add column if not exists gia_tham_khao numeric;         -- giá mua tham khảo (đ/đơn vị)
alter table kho.vat_tu add column if not exists gia_tham_khao_ngay date;       -- ngày kiểm kê

-- 2) 'kiem_ke' là loại giao dịch riêng (không lẫn nhập/xuất).
do $$ declare cn text;
begin
  select conname into cn from pg_constraint
    where conrelid='kho.giao_dich'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%loai%';
  if cn is not null then execute format('alter table kho.giao_dich drop constraint %I', cn); end if;
end $$;
alter table kho.giao_dich add constraint giao_dich_loai_check
  check (loai in ('nhap','xuat','lay','tra','dieu_chinh','kiem_ke'));
-- nguon: thêm 'kiem_ke' (đang có phieu/quet_tem)
do $$ declare cn text;
begin
  select conname into cn from pg_constraint
    where conrelid='kho.giao_dich'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%nguon%';
  if cn is not null then execute format('alter table kho.giao_dich drop constraint %I', cn); end if;
end $$;
alter table kho.giao_dich add constraint giao_dich_nguon_check
  check (nguon in ('phieu','quet_tem','kiem_ke'));

-- 3) Đơn vị ván = tấm (CEO chốt).
update kho.vat_tu set dvt='tấm' where loai='van';

-- 4) ẨN gia_tham_khao khỏi anon/authenticated (giá — thợ không xem, như giá vốn): revoke table select,
--    grant lại theo cột TRỪ gia_tham_khao. Ceo/kho đọc giá tham khảo qua view.
revoke select on kho.vat_tu from anon, authenticated;
grant select (id,ma,ten,loai,nhom_id,dvt,so_moi_dvt,dvt_goc,do_day_mm,vat_lieu,hoan_thien,ma_van_ncc,
              anh_ma,ton_toi_thieu,can_kiem_tra,ghi_chu_co,tao_luc,sua_luc,nguoi_thao_tac,ngung_dung,gia_tham_khao_ngay)
  on kho.vat_tu to anon, authenticated;   -- gia_tham_khao KHÔNG cấp

create or replace view kho.v_gia_tham_khao with (security_invoker=false) as
  select id as vat_tu_id, ma, gia_tham_khao, gia_tham_khao_ngay
  from kho.vat_tu where kho.current_vai_tro() in ('ceo','kho');
grant select on kho.v_gia_tham_khao to authenticated;   -- thợ -> 0 dòng

-- 5) KIỂM tự RAISE.
do $$
begin
  if has_column_privilege('authenticated','kho.vat_tu','gia_tham_khao','SELECT') then raise exception 'HỎNG: authenticated đọc được gia_tham_khao'; end if;
  if has_column_privilege('anon','kho.vat_tu','gia_tham_khao','SELECT')          then raise exception 'HỎNG: anon đọc được gia_tham_khao'; end if;
  if not has_column_privilege('authenticated','kho.vat_tu','ten','SELECT')       then raise exception 'HỎNG: mất select vat_tu.ten'; end if;
  if not has_table_privilege('authenticated','kho.v_gia_tham_khao','SELECT')     then raise exception 'HỎNG: mất view giá tham khảo'; end if;
  if (select count(*) from kho.vat_tu where loai='van' and dvt<>'tấm') > 0       then raise exception 'HỎNG: còn ván dvt khác tấm'; end if;
  raise notice 'OK 010: cột gia_tham_khao (ẩn khỏi thợ, view cho ceo/kho) + loại kiem_ke + 45 ván dvt=tấm';
end $$;

commit;
