-- db/189 · WP-78 L-02 · Vai ads_user + RPC ads_ad_ngay (mức ad_id × NGÀY) + index. QD-81.
--   ⚠ KHÔNG IDEMPOTENT: alter check / create index / or-replace function. Chạy ĐÚNG MỘT LẦN (index dùng IF NOT EXISTS).
--   RPC KHÔNG chép công thức CAC (họ bệnh atp: một công thức hai bản). App ads GỌI LẠI cac_theo_luong_loai cho khối kỳ.
--   Chi tiêu ad: chi_ad NULL + nguon_chi='chua_co_nguon' — Pancake không trả spend (L-01). CẤM để 0, CẤM chia đều.
--   Ngày = thoi_diem_hoi_thoai (mốc khách nhắn lần đầu = lúc ad mang khách tới), KHÔNG lấy ngày kéo (ghi_nhan_luc).
--   ⚠ Cổng backup QD-61: dump fail → DỪNG. CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: drop function kho.ads_ad_ngay(date,date); drop index kho.ix_lead_ad_id, kho.ix_don_hang_lead_id;
--     (khôi phục check vai_tro bản cũ nếu cần).
begin;

-- ── VIỆC 1: thêm vai ads_user vào danh mục (CHECK nguoi_dung.vai_tro) ──
do $$
declare cn text;
begin
  select conname into cn from pg_constraint
    where conrelid='kho.nguoi_dung'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%vai_tro%';
  if cn is not null then execute 'alter table kho.nguoi_dung drop constraint '||quote_ident(cn); end if;
  alter table kho.nguoi_dung add constraint nguoi_dung_vai_tro_check check (vai_tro = any (array[
    'ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','truong_nhom_sale','tk_ban_hang','truong_nhom_thiet_ke',
    'ads_user']));
end $$;

-- ── Index: gộp lô/quy kết làm truy vấn ad_id + lead_id thành điểm nóng (mục A2 thiếu cả hai). ──
create index if not exists ix_lead_ad_id on kho.lead (ad_id);
create index if not exists ix_don_hang_lead_id on kho.don_hang (lead_id);

-- ── VIỆC 2+3: RPC mức ad_id × ngày + 6 bậc phễu (chỉ bậc có số thật; 2 bậc Meta để NULL + nhãn). ──
create or replace function kho.ads_ad_ngay(p_tu_ngay date, p_den_ngay date)
returns table(
  ad_id text, ngay date, so_hoi_thoai int, so_co_sdt int,
  don_chot int, gia_tri_chot numeric, don_giao int, gia_tri_giao numeric,
  ty_le_chot numeric, chi_ad numeric, nguon_chi text, cac_ad numeric, pheu jsonb
) language plpgsql security definer set search_path to 'kho'
as $fn$
begin
  -- cổng vai: ceo/ke_toan hoặc ads_user (KHÔNG mở cho vai khác)
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_ad_ngay: chỉ ceo/ke_toan/ads_user';
  end if;

  return query
  with base as (   -- lead HIỆN HÀNH trong khoảng, theo mốc khách nhắn; ad_id NULL giữ nguyên (ngoài quy kết)
    select v.id lead_id, v.ad_id, v.thoi_diem_hoi_thoai::date ngay, v.sdt
    from kho.v_lead_hien_hanh v
    where v.thoi_diem_hoi_thoai >= p_tu_ngay::timestamptz
      and v.thoi_diem_hoi_thoai <  (p_den_ngay + 1)::timestamptz
  ),
  don as (   -- đơn gắn lead: chốt = trang_thai<>'bao_gia' (như cac_theo_luong_loai) · giao = ngay_giao có · giá trị doanh_thu (gồm VAT)
    select b.lead_id,
      count(*) filter (where dh.trang_thai <> 'bao_gia')                          as don_chot,
      sum(dh.doanh_thu) filter (where dh.trang_thai <> 'bao_gia')                 as gt_chot,
      count(*) filter (where dh.ngay_giao is not null)                           as don_giao,
      sum(dh.doanh_thu) filter (where dh.ngay_giao is not null)                  as gt_giao
    from base b join kho.don_hang dh on dh.lead_id = b.lead_id
    group by b.lead_id
  )
  select
    b.ad_id, b.ngay,
    count(*)::int                                                   as so_hoi_thoai,
    count(*) filter (where b.sdt ~ '^[0-9]{9,11}$')::int            as so_co_sdt,
    coalesce(sum(d.don_chot),0)::int                                as don_chot,
    sum(d.gt_chot)                                                  as gia_tri_chot,   -- NULL nếu không đơn (không bịa 0)
    coalesce(sum(d.don_giao),0)::int                               as don_giao,
    sum(d.gt_giao)                                                 as gia_tri_giao,
    case when count(*)>0 then round(coalesce(sum(d.don_chot),0)::numeric*100/count(*),1) else null end as ty_le_chot,
    null::numeric                                                  as chi_ad,        -- CHƯA CÓ NGUỒN (không để 0)
    'chua_co_nguon'::text                                          as nguon_chi,
    null::numeric                                                  as cac_ad,        -- không có chi → không CAC mức ad
    jsonb_build_array(
      jsonb_build_object('bac','hien_thi', 'gia_tri', null, 'nhan','cho_nguon_meta'),
      jsonb_build_object('bac','bam',      'gia_tri', null, 'nhan','cho_nguon_meta'),
      jsonb_build_object('bac','hoi_thoai','gia_tri', count(*),                                          'nhan','that'),
      jsonb_build_object('bac','co_sdt',   'gia_tri', count(*) filter (where b.sdt ~ '^[0-9]{9,11}$'),   'nhan','that'),
      jsonb_build_object('bac','chot',     'gia_tri', coalesce(sum(d.don_chot),0),                       'nhan','that'),
      jsonb_build_object('bac','da_giao',  'gia_tri', coalesce(sum(d.don_giao),0),                       'nhan','that')
    )                                                              as pheu
  from base b left join don d on d.lead_id = b.lead_id
  group by b.ad_id, b.ngay
  order by (b.ad_id is null), b.ad_id, b.ngay;   -- dòng ad NULL (ngoài quy kết) xuống CUỐI
end $fn$;
revoke execute on function kho.ads_ad_ngay(date,date) from public, anon;
grant  execute on function kho.ads_ad_ngay(date,date) to authenticated;

do $$ begin
  if to_regprocedure('kho.ads_ad_ngay(date,date)') is null then raise exception 'THIẾU ads_ad_ngay'; end if;
  raise notice 'db/189 OK: vai ads_user + ads_ad_ngay + index lead(ad_id)/don_hang(lead_id).';
end $$;
commit;
