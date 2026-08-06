-- KHO-1 sửa hướng — CHUYỂN 12 bảng kho từ public sang schema "kho" (một dự án Supabase,
--   tách bằng schema để sau nối CRM/ERP qua khoá ngoại chung). Chạy 1 LẦN cho DB hiện có (bảng ở public).
--   Fresh install: dùng 001/002/003 bản mới (đã tạo thẳng trong kho) -> KHÔNG chạy file này.
-- Giữ NGUYÊN dữ liệu. RLS + policy + FK + index ĐI THEO bảng (alter set schema). CHỈ 2 hàm phải sửa
--   search_path (chúng trỏ bảng qua public). Cuối có KIỂM tự RAISE.
begin;

create schema if not exists kho;

-- ── Chuyển 12 bảng (dữ liệu + RLS + policy + FK + index theo cùng) ──
alter table public.nguoi_dung   set schema kho;
alter table public.nhom         set schema kho;
alter table public.kho          set schema kho;
alter table public.nha_cung_cap set schema kho;
alter table public.vat_tu       set schema kho;
alter table public.ton          set schema kho;
alter table public.lo_nhap      set schema kho;
alter table public.phieu        set schema kho;
alter table public.phieu_dong   set schema kho;
alter table public.giao_dich    set schema kho;
alter table public.cai_dat      set schema kho;
alter table public.chuoi_so     set schema kho;

-- ── 2 HÀM: chuyển schema + TRỎ LẠI search_path sang kho (nếu không, body tìm bảng ở public -> vỡ) ──
--   current_vai_tro() được 10 policy gọi (theo OID) -> alter (KHÔNG drop) để policy giữ nguyên tham chiếu.
alter function public.current_vai_tro()    set schema kho;
alter function kho.current_vai_tro()       set search_path = kho;   -- body đọc nguoi_dung (auth.uid() vẫn qualified)
alter function public.cap_so_phieu(text)   set schema kho;
alter function kho.cap_so_phieu(text)      set search_path = kho;   -- body đọc/ghi chuoi_so

-- ════ KIỂM — sai thì RAISE (không nới lỏng) ════
do $$
begin
  if (select count(*) from kho.vat_tu) <> 199 then
    raise exception 'VẬT TƯ = % (cần 199)', (select count(*) from kho.vat_tu); end if;
  if (select count(*) from kho.vat_tu where loai='pk') <> 154 then
    raise exception 'PK = % (cần 154)', (select count(*) from kho.vat_tu where loai='pk'); end if;
  if (select count(*) from kho.vat_tu where loai='van') <> 45 then
    raise exception 'VÁN = % (cần 45)', (select count(*) from kho.vat_tu where loai='van'); end if;
  if (select count(*) from kho.lo_nhap) <> 133 then
    raise exception 'LÔ = % (cần 133)', (select count(*) from kho.lo_nhap); end if;
  if round((select coalesce(sum(t.so_luong*t.gia_von_bq),0)
            from kho.ton t join kho.vat_tu v on v.id=t.vat_tu_id
            where v.loai='pk' and t.gia_von_bq is not null)) <> 233054400 then
    raise exception 'TỔNG TỒN PK LỆCH SAU CHUYỂN = %',
      (select coalesce(sum(t.so_luong*t.gia_von_bq),0)
       from kho.ton t join kho.vat_tu v on v.id=t.vat_tu_id
       where v.loai='pk' and t.gia_von_bq is not null); end if;
  -- không còn bảng kho nào sót lại ở public
  if exists (select 1 from information_schema.tables
             where table_schema='public'
               and table_name in ('nguoi_dung','nhom','kho','nha_cung_cap','vat_tu','ton',
                                   'lo_nhap','phieu','phieu_dong','giao_dich','cai_dat','chuoi_so')) then
    raise exception 'CÒN bảng kho sót ở public'; end if;
  raise notice 'OK CHUYỂN: 12 bảng -> schema kho · 199 vật tư · 133 lô · tồn PK 233.054.400 giữ nguyên · RLS/policy theo cùng';
end $$;

commit;
