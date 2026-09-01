-- db/199 · WP-77 vế (b) · Kéo chi phí Meta mức ad × ngày → chi_ads_ngay, nối vào ads_ad_ngay. QD-88.
--   chi_ads_ngay = bảng ĐỒNG BỘ (Meta chốt số muộn ~72h → upsert theo khoá), KHÔNG phải sổ append-only (khác họ QD-44/86).
--   chi_tieu lưu NGUYÊN TRẠNG số Meta (CẤM +VAT, CẤM quy đổi, CẤM làm tròn). nhan_vat='chua_ro_vat' tới khi có QD gỡ.
--   KHÔNG đụng chi_ads cũ (db/115, hạt kỳ×brand, app Tài chính đọc) — hai hạt khác nhau.
--   ⚠ KHÔNG IDEMPOTENT (create table + drop/create ads_ad_ngay). Cổng backup QD-61.
--   HOÀN TÁC: drop table kho.chi_ads_ngay; drop function kho.chi_ads_ngay_ghi(jsonb); + chạy lại db/189 (ads_ad_ngay).
begin;

-- ── Bảng đồng bộ ──
create table kho.chi_ads_ngay (
  id        bigserial primary key,
  act_id    text not null,
  ad_id     text not null,
  ad_name   text,
  ngay      date not null,
  chi_tieu  numeric not null,                       -- NGUYÊN TRẠNG Meta (không +VAT)
  hien_thi  bigint,
  luot_bam  bigint,
  tien_te   text not null default 'VND',
  nhan_vat  text not null default 'chua_ro_vat',    -- chưa đối chiếu hoá đơn → chưa biết gồm/chưa gồm VAT
  keo_luc   timestamptz not null default now(),
  nguon     text not null default 'meta_insights',
  unique (act_id, ad_id, ngay)                       -- kéo lại cùng ngày = CẬP NHẬT, không đẻ dòng
);
create index ix_can_ad_ngay on kho.chi_ads_ngay (ad_id, ngay);
comment on table kho.chi_ads_ngay is 'WP-77/QD-88: chi phí Meta mức ad×ngày. Bảng ĐỒNG BỘ (upsert theo khoá, Meta chốt muộn) — KHÔNG append-only. chi_tieu nguyên trạng, nhan_vat=chua_ro_vat.';
alter table kho.chi_ads_ngay enable row level security;
revoke all on kho.chi_ads_ngay from public, anon, authenticated;
create policy can_doc on kho.chi_ads_ngay for select to authenticated using (kho.current_vai_tro() in ('ceo','ke_toan','ads_user'));

-- ── Cửa GHI (upsert lô) — bộ kéo owner/hệ thống gọi (GUC meta_he_thong, khuôn lead_ghi_lo). ──
create or replace function kho.chi_ads_ngay_ghi(p_ds jsonb)
returns int language plpgsql security definer set search_path to 'kho' as $fn$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_ads_ngay_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_ds) as x(
      act_id text, ad_id text, ad_name text, ngay date, chi_tieu numeric, hien_thi bigint, luot_bam bigint, tien_te text))
  , up as (
    insert into kho.chi_ads_ngay(act_id, ad_id, ad_name, ngay, chi_tieu, hien_thi, luot_bam, tien_te, nguon, nhan_vat, keo_luc)
    select act_id, ad_id, ad_name, ngay, chi_tieu, hien_thi, luot_bam, coalesce(nullif(tien_te,''),'VND'), 'meta_insights', 'chua_ro_vat', now()
    from e where act_id is not null and ad_id is not null and ngay is not null and chi_tieu is not null
    on conflict (act_id, ad_id, ngay) do update set
      ad_name=excluded.ad_name, chi_tieu=excluded.chi_tieu, hien_thi=excluded.hien_thi, luot_bam=excluded.luot_bam,
      tien_te=excluded.tien_te, keo_luc=now()
    returning 1)
  select count(*)::int into n from up;
  return n;
end $fn$;
revoke execute on function kho.chi_ads_ngay_ghi(jsonb) from public, anon;
grant  execute on function kho.chi_ads_ngay_ghi(jsonb) to authenticated;

-- ── NỐI vào ads_ad_ngay: chi_ad/cac_ad/2 bậc phễu đọc từ chi_ads_ngay (DROP+CREATE vì +cột nhan_vat). ──
drop function if exists kho.ads_ad_ngay(date,date);
create function kho.ads_ad_ngay(p_tu_ngay date, p_den_ngay date)
returns table(
  ad_id text, ngay date, so_hoi_thoai int, so_co_sdt int,
  don_chot int, gia_tri_chot numeric, don_giao int, gia_tri_giao numeric,
  ty_le_chot numeric, chi_ad numeric, nguon_chi text, cac_ad numeric, nhan_vat text, pheu jsonb
) language plpgsql security definer set search_path to 'kho'
as $fn$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_ad_ngay: chỉ ceo/ke_toan/ads_user';
  end if;
  return query
  with base as (
    select v.id lead_id, v.ad_id, v.thoi_diem_hoi_thoai::date ngay, v.sdt
    from kho.v_lead_hien_hanh v
    where v.thoi_diem_hoi_thoai >= p_tu_ngay::timestamptz and v.thoi_diem_hoi_thoai < (p_den_ngay + 1)::timestamptz
  ),
  don as (
    select b.lead_id,
      count(*) filter (where dh.trang_thai <> 'bao_gia') as don_chot,
      sum(dh.doanh_thu) filter (where dh.trang_thai <> 'bao_gia') as gt_chot,
      count(*) filter (where dh.ngay_giao is not null) as don_giao,
      sum(dh.doanh_thu) filter (where dh.ngay_giao is not null) as gt_giao
    from base b join kho.don_hang dh on dh.lead_id = b.lead_id group by b.lead_id
  ),
  chi as (   -- chi phí Meta gom theo (ad_id, ngày) trong khoảng (một ad một act → thường 1 dòng)
    select ca.ad_id, ca.ngay, sum(ca.chi_tieu) chi, sum(ca.hien_thi) ht, sum(ca.luot_bam) lb, max(ca.nhan_vat) nhan
    from kho.chi_ads_ngay ca where ca.ngay >= p_tu_ngay and ca.ngay <= p_den_ngay group by ca.ad_id, ca.ngay
  )
  select
    b.ad_id, b.ngay,
    count(*)::int as so_hoi_thoai,
    count(*) filter (where b.sdt ~ '^[0-9]{9,11}$')::int as so_co_sdt,
    coalesce(sum(d.don_chot),0)::int as don_chot,
    sum(d.gt_chot) as gia_tri_chot,
    coalesce(sum(d.don_giao),0)::int as don_giao,
    sum(d.gt_giao) as gia_tri_giao,
    case when count(*)>0 then round(coalesce(sum(d.don_chot),0)::numeric*100/count(*),1) else null end as ty_le_chot,
    max(ch.chi) as chi_ad,                                                   -- có dòng khớp → số Meta; không → NULL
    case when max(ch.chi) is not null then 'meta_insights' else 'chua_co_nguon' end as nguon_chi,
    case when max(ch.chi) is not null and coalesce(sum(d.don_chot),0) > 0    -- CAC = chi ÷ đơn chốt (grain ad×ngày;
         then round(max(ch.chi) / coalesce(sum(d.don_chot),0), 0) else null end as cac_ad,  -- KHÁC kenh_cac_ky brand×khách-mới)
    case when max(ch.chi) is not null then max(ch.nhan) else null end as nhan_vat,  -- 'chua_ro_vat' khi có chi
    jsonb_build_array(
      case when max(ch.ht) is not null then jsonb_build_object('bac','hien_thi','gia_tri',max(ch.ht),'nhan','that')
           else jsonb_build_object('bac','hien_thi','gia_tri',null,'nhan','cho_nguon_meta') end,
      case when max(ch.lb) is not null then jsonb_build_object('bac','bam','gia_tri',max(ch.lb),'nhan','that')
           else jsonb_build_object('bac','bam','gia_tri',null,'nhan','cho_nguon_meta') end,
      jsonb_build_object('bac','hoi_thoai','gia_tri', count(*),                                          'nhan','that'),
      jsonb_build_object('bac','co_sdt',   'gia_tri', count(*) filter (where b.sdt ~ '^[0-9]{9,11}$'),   'nhan','that'),
      jsonb_build_object('bac','chot',     'gia_tri', coalesce(sum(d.don_chot),0),                       'nhan','that'),
      jsonb_build_object('bac','da_giao',  'gia_tri', coalesce(sum(d.don_giao),0),                       'nhan','that')
    ) as pheu
  from base b
    left join don d on d.lead_id = b.lead_id
    left join chi ch on ch.ad_id = b.ad_id and ch.ngay = b.ngay
  group by b.ad_id, b.ngay
  order by (b.ad_id is null), b.ad_id, b.ngay;
end $fn$;
revoke execute on function kho.ads_ad_ngay(date,date) from public, anon;
grant  execute on function kho.ads_ad_ngay(date,date) to authenticated;

do $$ begin
  if to_regclass('kho.chi_ads_ngay') is null then raise exception 'THIẾU chi_ads_ngay'; end if;
  raise notice 'db/199 OK: chi_ads_ngay (đồng bộ) + chi_ads_ngay_ghi + ads_ad_ngay nối chi_ad/cac_ad/phễu.';
end $$;
commit;
