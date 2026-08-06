-- KHO-1 sửa — DỌN lô mở đầu bị nhân 3 (seed chạy lại 3 lần). Giữ bản CŨ NHẤT (tao_luc asc).
-- Chạy SAU khi đã xác nhận 399 dòng là 3 bản TRÙNG (xem truy vấn ĐO). Idempotent: chạy lại vô hại.
-- Tồn (ton) KHÔNG bị nhân (upsert) -> vẫn kiểm tổng để chắc.
begin;
set search_path = kho, public;   -- bảng nằm trong schema kho

-- 1) Xoá GIAO DỊCH mở đầu trỏ tới lô KHÔNG giữ (FK giao_dich.lo_nhap_id -> lo_nhap, xoá con trước).
with keep as (
  select distinct on (vat_tu_id, kho_id) id
  from lo_nhap
  order by vat_tu_id, kho_id, tao_luc asc, id
)
delete from giao_dich g
where g.lo_nhap_id is not null
  and g.lo_nhap_id not in (select id from keep);

-- 2) Xoá LÔ không giữ.
with keep as (
  select distinct on (vat_tu_id, kho_id) id
  from lo_nhap
  order by vat_tu_id, kho_id, tao_luc asc, id
)
delete from lo_nhap where id not in (select id from keep);

-- ════ KIỂM — sai thì RAISE (không nới lỏng) ════
do $$
begin
  if (select count(*) from lo_nhap) <> 133 then
    raise exception 'LÔ = % (cần 133)', (select count(*) from lo_nhap); end if;
  if (select count(distinct vat_tu_id) from lo_nhap) <> 133 then
    raise exception 'MÃ CÓ LÔ = % (cần 133)', (select count(distinct vat_tu_id) from lo_nhap); end if;
  if (select count(*) from giao_dich where lo_nhap_id is not null) <> 133 then
    raise exception 'GIAO DỊCH MỞ ĐẦU = % (cần 133)',
      (select count(*) from giao_dich where lo_nhap_id is not null); end if;
  if round((select coalesce(sum(t.so_luong*t.gia_von_bq),0)
            from ton t join vat_tu v on v.id=t.vat_tu_id
            where v.loai='pk' and t.gia_von_bq is not null)) <> 233054400 then
    raise exception 'TỔNG TỒN PK LỆCH SAU DỌN = %',
      (select coalesce(sum(t.so_luong*t.gia_von_bq),0)
       from ton t join vat_tu v on v.id=t.vat_tu_id
       where v.loai='pk' and t.gia_von_bq is not null); end if;
  raise notice 'OK DỌN: 133 lô · 133 giao dịch mở đầu · tổng tồn PK 233.054.400 giữ nguyên';
end $$;

commit;
