-- db/230 · WP-90 mở lại · RPC kiểm ĐỘ PHỦ chi ads (đủ ngày / thiếu ngày), cho bộ kéo kéo bù + màn TC sau.
--   Bài học L-22: sổ thiếu 77% chi ads tháng 8 vì cửa sổ 7 ngày chưa chạy đều — kiểm TỔNG không thấy,
--   phải kiểm ĐỘ PHỦ (đủ ngày, đủ đối tượng). "Đang hoạt động" = có ≥1 dòng trong khoảng (DB không hỏi
--   Meta được; tài khoản 0 dòng có thể là không-tiêu HOẶC chưa-kéo — phần đó nghiệm thu bằng Meta, VIỆC 5).

begin;

-- ĐO COVERAGE THEO MỐC KÉO (ads_moc_keo.khoang), KHÔNG theo row: ngày không-tiêu-tiền không có row
--   nhưng VẪN đã kéo (nằm trong khoang lượt xong) → KHÔNG tính trống (nếu không, auto-backfill kéo lại vô hạn).
--   Coverage là TOÀN-tài-khoản (một lượt kéo cả 6 TK) → báo theo THÁNG. Gap per-account (một TK lỗi riêng)
--   nghiệm thu bằng Meta (VIỆC 5), không phải bằng đếm row (row = có-tiêu, không phải đã-kéo).
create or replace function kho.chi_ads_kiem_do_phu(p_tu date, p_den date)
  returns jsonb language sql stable security definer set search_path = kho set jit = 'off' as $$
  with thang as (
    select generate_series(date_trunc('month', p_tu), date_trunc('month', p_den), interval '1 month')::date m
  ),
  ky_vong as (
    select t.m, generate_series(greatest(t.m, p_tu),
             least((t.m + interval '1 month' - interval '1 day')::date, p_den), interval '1 day')::date d
    from thang t
    where greatest(t.m, p_tu) <= least((t.m + interval '1 month' - interval '1 day')::date, p_den)
  ),
  da_keo as (   -- ngày đã kéo = nằm trong khoang của MỘT lượt meta_chi_ad ĐÃ XONG
    select distinct kv.d from ky_vong kv
    where exists (select 1 from kho.ads_moc_keo mk
      where mk.nguon = 'meta_chi_ad' and mk.trang_thai = 'xong'
        and mk.khoang_tu is not null and kv.d between mk.khoang_tu and mk.khoang_den)
  ),
  gom as (
    select kv.m,
      count(*) filter (where dk.d is not null) so_ngay_da_keo,
      count(*) so_ngay_thuc,
      coalesce(array_agg(to_char(kv.d,'YYYY-MM-DD') order by kv.d) filter (where dk.d is null), '{}') ngay_chua_keo
    from ky_vong kv left join da_keo dk on dk.d = kv.d
    group by kv.m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'thang', to_char(g.m, 'YYYY-MM'),
      'so_ngay_da_keo', g.so_ngay_da_keo,
      'so_ngay_thuc', g.so_ngay_thuc,
      'du', g.so_ngay_da_keo = g.so_ngay_thuc,
      'ngay_chua_keo', to_jsonb(g.ngay_chua_keo)
    ) order by g.m desc), '[]'::jsonb)
  from gom g;
$$;

revoke execute on function kho.chi_ads_kiem_do_phu(date,date) from public, anon;
grant  execute on function kho.chi_ads_kiem_do_phu(date,date) to authenticated, service_role;

commit;
