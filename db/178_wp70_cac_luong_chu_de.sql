-- db/178 · WP-70 L-03 · RPC màn "Kênh & CAC theo luồng + chủ đề" (app Tài chính, tab Kênh & CAC).
--   Client KHÔNG tính (04 §A một bản sự thật). SecDef, vai ceo/ke_toan. Trả 4 khối cho mẫu man_cac_luong_chude_v1.
--
--   TÁI DÙNG db/115 (KHÔNG chép công thức): chi ads thật TỔNG kỳ = kenh_cac_ky(p_ky).tong.chi_ads_that
--     (db/115 đã ÷VAT theo tham_so_tai_chinh). Ta KHÔNG tự tính ÷VAT lần hai.
--   Phần MỚI (spec của MÀN, không phải công thức db/115): phân bổ chi TỔNG cho từng luồng/chủ đề THEO SỐ
--     lead 'xac_dinh' (QD-76: mức suy KHÔNG ăn chi phí), rồi CAC = chi phân bổ ÷ đơn chốt (mẫu mục 2/3).
--   0 đọc thành "miễn phí" → chi TỔNG = 0/NULL ⇒ mọi ô chi & CAC trả NULL, KHÔNG trả 0.
--
--   HOÀN TÁC: drop function kho.cac_theo_luong_chu_de(text);
--   ⚠ CẤM cờ BO_QUA_BACKUP (db≥177) — chạy backup bình thường.
begin;

create or replace function kho.cac_theo_luong_chu_de(p_ky text)
returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit='off' as $fn$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_from date; v_to date;
  v_chi_total numeric;                 -- chi ads thật TỔNG kỳ — LẤY TỪ db/115
  v_res jsonb;
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'cac_theo_luong_chu_de: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky !~ '^\d{4}-\d{2}$' then raise exception 'cac_theo_luong_chu_de: p_ky phải dạng YYYY-MM'; end if;
  v_from := to_date(p_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;

  -- ── chi ads thật TỔNG kỳ: tái dùng kenh_cac_ky (db/115). Kỳ thiếu tham số tài chính → NULL (không chặn màn). ──
  begin
    v_chi_total := (kho.kenh_cac_ky(p_ky) -> 'tong' ->> 'chi_ads_that')::numeric;
  exception when others then v_chi_total := null; end;
  if v_chi_total is not null and v_chi_total <= 0 then v_chi_total := null; end if;   -- 0/âm = không chạy ads → NULL

  with coh as (   -- cohort kỳ = lead hiện hành theo thoi_diem_hoi_thoai (ngày TẠO hội thoại)
    select v.id, v.page_id, v.hoi_thoai_id, v.luong, v.chu_de_ma, v.muc_chac_chan,
      case when v.page_id like 'pzl!_%' escape '!' then 'zalo'
           when v.page_id like 'igo!_%' escape '!' then 'instagram'
           else 'facebook' end as platform
    from kho.v_lead_hien_hanh v
    where v.nguon='pancake' and v.thoi_diem_hoi_thoai >= v_from and v.thoi_diem_hoi_thoai < v_to
  ),
  don as (   -- đơn chốt map theo hội thoại: đơn có lead_id, KHÔNG tính bao_gia (chưa chốt)
    select l.page_id, l.hoi_thoai_id, count(distinct dh.id) n
    from kho.don_hang dh join kho.lead l on l.id = dh.lead_id
    where dh.trang_thai <> 'bao_gia'
    group by l.page_id, l.hoi_thoai_id
  ),
  cd as (   -- gắn đơn chốt vào từng hội thoại cohort (0 nếu chưa có đơn)
    select coh.*, coalesce(d.n,0) as don_chot from coh left join don d
      on d.page_id=coh.page_id and d.hoi_thoai_id=coh.hoi_thoai_id
  ),
  tong as ( select count(*)::int n, count(*) filter (where muc_chac_chan='xac_dinh')::int xd from cd ),
  -- ── (a) chất lượng nguồn: 4 mức toàn kỳ + tách theo nền tảng ──
  chat as (
    select jsonb_build_object(
      'tong', (select n from tong),
      'xac_dinh',    count(*) filter (where muc_chac_chan='xac_dinh'),
      'suy_ref',     count(*) filter (where muc_chac_chan='suy_ref'),
      'doi_chieu_lo',count(*) filter (where muc_chac_chan='doi_chieu_lo'),
      'khong_biet',  count(*) filter (where muc_chac_chan='khong_biet')
    ) j from cd
  ),
  chat_trang as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'platform', platform, 'tong', tong,
      'xac_dinh', xd, 'suy_ref', sr, 'doi_chieu_lo', dc, 'khong_biet', kb
    ) order by tong desc, platform), '[]'::jsonb) j
    from (
      select platform, count(*) tong,
        count(*) filter (where muc_chac_chan='xac_dinh') xd,
        count(*) filter (where muc_chac_chan='suy_ref') sr,
        count(*) filter (where muc_chac_chan='doi_chieu_lo') dc,
        count(*) filter (where muc_chac_chan='khong_biet') kb
      from cd group by platform
    ) t
  ),
  -- ── (b) theo LUỒNG: 3 dòng cố định (qua_web · mess_truc_tiep · khong_biet), khong_biet cuối ──
  luong_g as (
    select g.luong,
      coalesce(count(cd.id),0)::int hoi_thoai,
      coalesce(sum(cd.don_chot),0)::int don_chot,
      coalesce(count(cd.id) filter (where cd.muc_chac_chan='xac_dinh'),0)::int xd
    from (values ('qua_web',1),('mess_truc_tiep',2),('khong_biet',3)) g(luong,ord)
    left join cd on cd.luong=g.luong
    group by g.luong, g.ord order by g.ord
  ),
  luong_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'luong', luong, 'hoi_thoai', hoi_thoai, 'don_chot', don_chot,
      'ty_le_chot', case when hoi_thoai>0 then round(don_chot::numeric*100/hoi_thoai,1) else null end,
      'chi_ads', case when v_chi_total is not null and (select xd from tong)>0 and xd>0
                      then round(v_chi_total * xd / (select xd from tong)) else null end,
      'cac', case when v_chi_total is not null and (select xd from tong)>0 and xd>0 and don_chot>0
                  then round(v_chi_total * xd / (select xd from tong) / don_chot) else null end,
      'cac_toi_da', null   -- WP-76
    )), '[]'::jsonb) j from luong_g
  ),
  -- ── (c) theo CHỦ ĐỀ: "chưa gán" (chu_de_ma null) ĐỨNG ĐẦU rồi từng chủ đề; cờ co_tron_suy ──
  chude_g as (
    select cd.chu_de_ma,
      (cd.chu_de_ma is null) chua_gan,
      count(*)::int hoi_thoai, sum(cd.don_chot)::int don_chot,
      count(*) filter (where cd.muc_chac_chan='xac_dinh')::int xd,
      bool_or(cd.muc_chac_chan in ('suy_ref','doi_chieu_lo')) co_tron_suy
    from cd group by cd.chu_de_ma
  ),
  chude_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'chu_de_ma', chu_de_ma, 'ten', coalesce((select ten from kho.chu_de c where c.ma=g.chu_de_ma), null),
      'chua_gan', chua_gan, 'co_tron_suy', coalesce(co_tron_suy,false),
      'hoi_thoai', hoi_thoai, 'don_chot', don_chot,
      'chi_ads', case when v_chi_total is not null and (select xd from tong)>0 and xd>0
                      then round(v_chi_total * xd / (select xd from tong)) else null end,
      'cac', case when v_chi_total is not null and (select xd from tong)>0 and xd>0 and don_chot>0
                  then round(v_chi_total * xd / (select xd from tong) / don_chot) else null end
    ) order by (not chua_gan), coalesce((select ten from kho.chu_de c where c.ma=g.chu_de_ma), g.chu_de_ma)), '[]'::jsonb) j
    from chude_g g
  ),
  -- tổng đơn chốt & hội thoại cả kỳ
  tongdon as ( select coalesce(sum(don_chot),0)::int dc from cd )
  select jsonb_build_object(
    'ma_ky', p_ky,
    'cohort_tong', (select n from tong),
    'don_chot_tong', (select dc from tongdon),
    'chi_ads_that_ky', v_chi_total,           -- NULL nếu 0/không chạy ads
    'chat_luong', (select j from chat),
    'chat_luong_trang', (select j from chat_trang),
    'luong', (select j from luong_j),
    'chu_de', (select j from chude_j)
  ) into v_res;

  -- ── (d) trạng thái bộ kéo: lần kéo gần nhất + hội thoại mới lần cuối (max qua các trang) ──
  v_res := v_res || jsonb_build_object('bo_keo', (
    select jsonb_build_object(
      'lan_keo_gan_nhat', max(lan_keo_luc),
      'phut_truoc', case when max(lan_keo_luc) is not null then floor(extract(epoch from (now()-max(lan_keo_luc)))/60)::int else null end,
      'hoi_thoai_moi_lan_cuoi', (select so_ban_ghi_lan_cuoi from kho.lead_moc_keo order by lan_keo_luc desc nulls last limit 1),
      'tre', case when max(lan_keo_luc) is not null then (now()-max(lan_keo_luc)) > interval '15 minutes' else null end
    ) from kho.lead_moc_keo
  ));

  return v_res;
end $fn$;
grant execute on function kho.cac_theo_luong_chu_de(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.cac_theo_luong_chu_de(text)') is null then raise exception 'THIẾU cac_theo_luong_chu_de'; end if;
  raise notice 'db/178 OK: cac_theo_luong_chu_de (tái dùng kenh_cac_ky/db-115 cho chi ads).';
end $$;
commit;
