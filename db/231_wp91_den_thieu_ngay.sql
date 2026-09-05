-- db/231 · WP-91 L-91.3 · ĐÈN nói cả "THIẾU NGÀY NÀO": mở rộng ads_tinh_trang_keo() với dải ĐỦ-SỐ tách riêng
--   khỏi dải trễ-giờ. Lý do: sáng nay đèn (trễ-giờ) XANH trong khi thiếu 21/31 ngày tháng 8 — một đèn không
--   gánh được hai câu hỏi khác nhau ("chạy lúc nào" vs "số đã đủ chưa"). Ngưỡng theo khuôn QD-93 (khoảng hiệu lực).

begin;

-- Ngưỡng dải ĐỦ-SỐ [TẠM]: thiếu 0 ngày → xanh · thiếu ≤ vàng(2) → vàng · thiếu > vàng → đỏ.
insert into kho.ads_nguong (ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
select * from (values
  ('do_phu_thieu_vang_ngay'::text, 2::numeric, current_date, '[TẠM] thiếu 1–2 ngày (35 gần nhất) → vàng; 0 → xanh; >2 → đỏ'::text, 'db/231'::text)
) v(ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
where not exists (select 1 from kho.ads_nguong n where n.ma = v.ma and n.hieu_luc_den is null);

create or replace function kho.ads_tinh_trang_keo()
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_vang numeric; v_do numeric; v_thieu_vang numeric; v_ket jsonb;
        v_so_co int; v_khoang jsonb; v_thieu int; v_co_du_lieu boolean; v_ngay_moi date;
begin
  v_ngay_moi := (select max(ngay) from kho.chi_ads_ngay);
  v_co_du_lieu := exists(select 1 from kho.ads_moc_keo where nguon = 'meta_chi_ad' and trang_thai = 'xong');
  select gia_tri into v_vang from kho.ads_nguong where ma = 'keo_tre_vang_gio'
    and hieu_luc_tu <= current_date and (hieu_luc_den is null or hieu_luc_den >= current_date) order by hieu_luc_tu desc limit 1;
  select gia_tri into v_do from kho.ads_nguong where ma = 'keo_tre_do_gio'
    and hieu_luc_tu <= current_date and (hieu_luc_den is null or hieu_luc_den >= current_date) order by hieu_luc_tu desc limit 1;
  select gia_tri into v_thieu_vang from kho.ads_nguong where ma = 'do_phu_thieu_vang_ngay'
    and hieu_luc_tu <= current_date and (hieu_luc_den is null or hieu_luc_den >= current_date) order by hieu_luc_tu desc limit 1;

  -- ── DẢI TRỄ-GIỜ (mỗi nguồn: chạy lúc nào) — giữ nguyên ──
  select jsonb_agg(t order by t.nguon) into v_ket from (
    select n.nguon, x.ket_thuc_luc as lan_xong_luc, x.so_dong_ghi, x.khoang_den,
      case when x.ket_thuc_luc is null then null else round(extract(epoch from (now() - x.ket_thuc_luc))/3600.0, 1) end as tre_gio,
      case when x.ket_thuc_luc is null then 'chua_chay'
           when extract(epoch from (now() - x.ket_thuc_luc))/3600.0 < v_vang then 'xanh'
           when extract(epoch from (now() - x.ket_thuc_luc))/3600.0 < v_do   then 'vang' else 'do' end as den,
      case when e.id is null then null else jsonb_build_object('luc', e.ket_thuc_luc, 'van_ban', e.loi_van_ban) end as loi_gan_nhat
    from (values ('meta_chi_ad'),('meta_chi_chien_dich'),('gop_ky')) n(nguon)
    left join lateral (select ket_thuc_luc, so_dong_ghi, khoang_den from kho.ads_moc_keo
      where nguon = n.nguon and trang_thai = 'xong' order by ket_thuc_luc desc limit 1) x on true
    left join lateral (select id, ket_thuc_luc, loi_van_ban from kho.ads_moc_keo
      where nguon = n.nguon and trang_thai = 'loi' order by ket_thuc_luc desc nulls last limit 1) e on true
  ) t;

  -- ── DẢI ĐỦ-SỐ (35 ngày gần nhất: số đã đủ chưa) — TÁCH RIÊNG ──
  with ngay as (select generate_series(current_date - 34, current_date, interval '1 day')::date d),
  dk as (select ng.d, exists(select 1 from kho.ads_moc_keo mk
           where mk.nguon = 'meta_chi_ad' and mk.trang_thai = 'xong' and mk.khoang_tu is not null
             and ng.d between mk.khoang_tu and mk.khoang_den) co from ngay ng)
  select count(*) filter (where co) into v_so_co from dk;
  v_thieu := 35 - v_so_co;

  -- khoảng ngày THIẾU, gộp liên tiếp (gaps-and-islands) → "DD/MM–DD/MM"
  with ngay as (select generate_series(current_date - 34, current_date, interval '1 day')::date d),
  thieu as (select ng.d from ngay ng where not exists(select 1 from kho.ads_moc_keo mk
              where mk.nguon = 'meta_chi_ad' and mk.trang_thai = 'xong' and mk.khoang_tu is not null
                and ng.d between mk.khoang_tu and mk.khoang_den)),
  grp as (select d, (d - (row_number() over (order by d))::int) g from thieu),
  kh as (select min(d) tu, max(d) den from grp group by g)
  select coalesce(jsonb_agg(to_char(tu,'DD/MM') || '–' || to_char(den,'DD/MM') order by tu), '[]'::jsonb) into v_khoang from kh;

  return jsonb_build_object(
    'nguong', jsonb_build_object('vang_gio', v_vang, 'do_gio', v_do, 'thieu_vang_ngay', v_thieu_vang),
    'ngay_moi_nhat', jsonb_build_object(
      'chi_ads_ngay', (select max(ngay) from kho.chi_ads_ngay),
      'chi_chien_dich_ngay', (select max(ngay) from kho.chi_chien_dich_ngay)),
    'do_phu', jsonb_build_object(
      'cua_so_ngay', 35,
      -- Bảng RỖNG (chưa kéo lần nào) → nhãn riêng "chua_co_du_lieu", KHÔNG phải "thiếu 35", không chia 0.
      'so_ngay_co', case when v_co_du_lieu then v_so_co else null end,
      'thieu_so_ngay', case when v_co_du_lieu then v_thieu else null end,
      'ngay_du_lieu_moi_nhat', v_ngay_moi,
      'dai_du_so', case when not v_co_du_lieu then 'chua_co_du_lieu'
                        when v_thieu = 0 then 'xanh' when v_thieu <= v_thieu_vang then 'vang' else 'do' end,
      'khoang_thieu', case when v_co_du_lieu then v_khoang else '[]'::jsonb end),
    'nguon', coalesce(v_ket, '[]'::jsonb));
end $$;

grant execute on function kho.ads_tinh_trang_keo() to authenticated, service_role;

commit;
