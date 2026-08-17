-- db/099 — L-67 (bản mỏng): NGUỒN KHÁCH + DẢI SỐ BÁN HÀNG. Idempotent.
--   PHẦN 1: don_hang.nguon_khach (lỗ thu thập — bịt trước khi đơn thật chảy). Miền 6 giá trị + null.
--   PHẦN 2: sale_dai_so_bao_gia — 6 con số mặt-đồng-hồ dưới khối thua/treo. KHÔNG đụng don_hang_gia_von (sale không thấy giá vốn).
--   Chạy: cd web && node ops/run_sql.mjs ../db/099_nguon_khach_dai_so.sql
-- ══════════ HOÀN TÁC ══════════  begin; alter table kho.don_hang drop column if exists nguon_khach;
--                                        drop function if exists kho.sale_dai_so_bao_gia(int); commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ── PHẦN 1 · cột nguồn khách ── (miền đọc từ thực tế công ty; CEO sửa được — in ra lúc chạy)
alter table kho.don_hang add column if not exists nguon_khach text;
alter table kho.don_hang drop constraint if exists don_hang_nguon_khach_check;
alter table kho.don_hang add constraint don_hang_nguon_khach_check
  check (nguon_khach is null or nguon_khach in ('quang_cao','gioi_thieu','cua_hang','san_tmdt','khach_cu','khac'));
comment on column kho.don_hang.nguon_khach is 'Khách biết mình qua đâu (L-67): quang_cao·gioi_thieu·cua_hang·san_tmdt·khach_cu·khac. Không bắt buộc.';

-- ── PHẦN 2 · dải 6 số màn Báo giá ── (mỗi số kèm n để app dán [TẠM] khi n<30; KHÔNG số nào đụng giá vốn)
create or replace function kho.sale_dai_so_bao_gia(p_gioi_han int default 50)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); r jsonb;
begin
  if v_vai not in ('sale','truong_nhom_sale','tk_ban_hang','ceo') then
    raise exception 'sale_dai_so_bao_gia: chỉ sale/truong_nhom_sale/tk_ban_hang/ceo (vai "%")',
      coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;

  with f as (   -- FUNNEL báo giá: đơn thật (không demo) đã có báo giá
    select d.ma_don, d.trang_thai, d.ly_do_thua, d.tao_luc, d.ngay_tao_bao_gia, d.ngay_chot,
           d.tu_dung, coalesce(d.doanh_thu, d.gia_goc) tien,          -- GIÁ BÁN, không giá vốn
           coalesce(d.ma_ns_tk_ban_hang, d.nguoi_tao) sale_id,
           (d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy','tam_ngung')) chot,
           (d.phong_cach is not null or d.ngan_sach_trieu is not null) co_nhu_cau,
           (select count(*) from kho.ban_thiet_ke b
              where b.ma_don = d.ma_don and b.trang_thai in ('khach_doi_y','chua_dung_yeu_cau')) vong_sua
    from kho.don_hang d
    where coalesce(d.la_demo,false) = false and d.ngay_tao_bao_gia is not null
  )
  select jsonb_build_object(
    -- ① thua vì giá / tổng thua
    'so1_thua_gia', (select jsonb_build_object(
        'ti_le', case when count(*) > 0 then round(count(*) filter (where ly_do_thua='gia_cao')::numeric / count(*), 3) end,
        'thua_gia', count(*) filter (where ly_do_thua='gia_cao'), 'tong_thua', count(*), 'n', count(*))
      from f where trang_thai='bao_gia_thua'),
    -- ② quãng hỏi (đơn mở) → khách thấy giá (báo giá tạo), TRUNG VỊ ngày
    'so2_hoi_den_gia', (select jsonb_build_object(
        'trung_vi_ngay', round(percentile_cont(0.5) within group (order by (ngay_tao_bao_gia::date - tao_luc::date))::numeric, 1),
        'n', count(*)) from f where tao_luc is not null),
    -- ③ tỉ lệ chốt trong 7/14/25 ngày kể từ báo giá (mẫu số = cả funnel)
    'so3_chot_theo_treo', (select jsonb_build_object(
        'd7',  round(avg((chot and ngay_chot is not null and (ngay_chot - ngay_tao_bao_gia::date) <= 7)::int)::numeric, 3),
        'd14', round(avg((chot and ngay_chot is not null and (ngay_chot - ngay_tao_bao_gia::date) <= 14)::int)::numeric, 3),
        'd25', round(avg((chot and ngay_chot is not null and (ngay_chot - ngay_tao_bao_gia::date) <= 25)::int)::numeric, 3),
        'n', count(*)) from f),
    -- ④ vòng sửa TB — tách có/không ghi nhu cầu (phong_cach/ngân sách)
    'so4_vong_sua', (select jsonb_build_object(
        'co_nhu_cau', jsonb_build_object('tb', round(avg(vong_sua) filter (where co_nhu_cau), 2), 'n', count(*) filter (where co_nhu_cau)),
        'khong',      jsonb_build_object('tb', round(avg(vong_sua) filter (where not co_nhu_cau), 2), 'n', count(*) filter (where not co_nhu_cau))) from f),
    -- ⑤ tỉ lệ chốt: tu_dung vs giao thiết kế
    'so5_chot_tu_dung', (select jsonb_build_object(
        'tu_dung', jsonb_build_object('ti_le', round(avg(chot::int) filter (where tu_dung), 3),                'n', count(*) filter (where tu_dung)),
        'giao_tk', jsonb_build_object('ti_le', round(avg(chot::int) filter (where not coalesce(tu_dung,false)), 3), 'n', count(*) filter (where not coalesce(tu_dung,false)))) from f),
    -- ⑥ tỉ lệ chốt + đơn TB theo sale (CÔNG KHAI) — LIST có limit
    'so6_theo_sale', (select coalesce(jsonb_agg(s.j order by (s.j->>'n')::int desc), '[]'::jsonb)
      from (
        select jsonb_build_object('sale', coalesce(nn.ho_ten,'(chưa gán)'),
                 'ti_le_chot', round(avg(f.chot::int), 3), 'don_tb', round(avg(f.tien)), 'n', count(*)) j
        from f left join kho.nguoi_dung nn on nn.id = f.sale_id
        group by coalesce(nn.ho_ten,'(chưa gán)')
        order by count(*) desc
        limit greatest(p_gioi_han, 0)
      ) s(j)),
    'tong_funnel', (select count(*) from f),
    'nguong_tam', 30                                   -- app dán [TẠM] khi n < ngưỡng này
  ) into r;
  return r;
end $$;
grant execute on function kho.sale_dai_so_bao_gia(int) to authenticated;

do $$ begin
  raise notice 'MIỀN nguon_khach: quang_cao · gioi_thieu · cua_hang · san_tmdt · khach_cu · khac (+ null). CEO sửa CHECK nếu lệch.';
  raise notice 'db/099 OK: don_hang.nguon_khach + sale_dai_so_bao_gia(6 số, ngưỡng TẠM=30).';
end $$;
commit;
