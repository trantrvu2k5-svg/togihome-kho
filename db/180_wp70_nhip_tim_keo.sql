-- db/180 · WP-70 L-06 · NHỊP TIM bộ kéo — tách "chạy lượt" khỏi "có lead mới".
--   Lỗi L-03/L-05: lan_keo_luc chỉ đổi khi CÓ lead mới → kỳ lặng 20' thì màn CAC báo đỏ "bộ kéo chết"
--   trong khi nó vẫn chạy đủ. Màn báo động SAI còn tệ hơn màn không báo.
--   Sửa: hai cột tách bạch trong lead_moc_keo:
--     · lan_keo_luc     = NHỊP TIM — ghi MỖI LƯỢT, kể cả 0 lead mới (đèn đỏ 15' đọc cột này).
--     · lan_co_lead_luc = lần gần nhất THỰC SỰ có lead mới (dòng nhỏ "lead mới gần nhất: …").
--   lead_moc_ghi nhận cả hai: moc_cap_nhat NULL = lượt lặng → chỉ đập nhịp tim, GIỮ mốc cũ.
--
--   HOÀN TÁC: alter table kho.lead_moc_keo drop column lan_co_lead_luc;
--     -- lead_moc_ghi: chạy lại bản db/176 (overwrite, không nhịp-tim-rỗng).
--   ⚠ migration ≥177 LUÔN backup (cờ BO_QUA_BACKUP đã bỏ 29/08).
begin;

-- (1) cột nhịp "có lead" (nullable — chưa có lead thì NULL)
alter table kho.lead_moc_keo add column if not exists lan_co_lead_luc timestamptz;

-- (1b) BACKFILL (idempotent): dòng có sẵn từng được lượt-có-lead ghi trước khi có cột này → lấy ghi_nhan_luc
--   của lead mới nhất mỗi trang làm "lead mới gần nhất". Tránh màn hiện "chưa có lead" trong khi đã có 4541 lead.
update kho.lead_moc_keo mk
  set lan_co_lead_luc = (select max(l.ghi_nhan_luc) from kho.lead l where l.page_id = mk.page_id)
  where mk.lan_co_lead_luc is null
    and exists (select 1 from kho.lead l where l.page_id = mk.page_id);

-- (2) lead_moc_ghi — nhịp tim MỖI LƯỢT + chỉ đập lan_co_lead khi có lead. (cùng chữ ký → không overload.)
--   moc_cap_nhat/last_conversation_id: COALESCE — NULL (lượt lặng) thì GIỮ mốc cũ, KHÔNG reset frontier.
--   so_ban_ghi_lan_cuoi + lan_co_lead_luc: chỉ đổi khi p_so_ban_ghi > 0 (giữ số lần-có-lead gần nhất).
create or replace function kho.lead_moc_ghi(p_page_id text, p_moc_cap_nhat timestamptz default null,
    p_last_conversation_id text default null, p_so_ban_ghi int default null)
returns kho.lead_moc_keo language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); r kho.lead_moc_keo; v_co_lead boolean := coalesce(p_so_ban_ghi,0) > 0;
begin
  if not (v_vai in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'lead_moc_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.lead_he_thong)'; end if;
  if p_page_id is null then raise exception 'lead_moc_ghi: thiếu page_id'; end if;
  insert into kho.lead_moc_keo(page_id, moc_cap_nhat, last_conversation_id, lan_keo_luc, lan_co_lead_luc, so_ban_ghi_lan_cuoi)
    values(p_page_id, p_moc_cap_nhat, p_last_conversation_id, now(),
           case when v_co_lead then now() else null end, p_so_ban_ghi)
  on conflict (page_id) do update set
    moc_cap_nhat         = coalesce(excluded.moc_cap_nhat, kho.lead_moc_keo.moc_cap_nhat),                 -- NULL lượt lặng → giữ cũ
    last_conversation_id = coalesce(excluded.last_conversation_id, kho.lead_moc_keo.last_conversation_id),
    lan_keo_luc          = now(),                                                                          -- NHỊP TIM: luôn
    lan_co_lead_luc      = case when v_co_lead then now() else kho.lead_moc_keo.lan_co_lead_luc end,       -- chỉ khi có lead
    so_ban_ghi_lan_cuoi  = case when v_co_lead then excluded.so_ban_ghi_lan_cuoi else kho.lead_moc_keo.so_ban_ghi_lan_cuoi end
  returning * into r;
  return r;
end $fn$;
grant execute on function kho.lead_moc_ghi(text, timestamptz, text, int) to authenticated;

-- (3) cac_theo_luong_chu_de (db/178) — bộ_keo thêm lan_co_lead_luc + số phút. Đèn đỏ VẪN theo lan_keo_luc (nhịp tim).
create or replace function kho.cac_theo_luong_chu_de(p_ky text)
returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit='off' as $fn$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_from date; v_to date;
  v_chi_total numeric;
  v_res jsonb;
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'cac_theo_luong_chu_de: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky !~ '^\d{4}-\d{2}$' then raise exception 'cac_theo_luong_chu_de: p_ky phải dạng YYYY-MM'; end if;
  v_from := to_date(p_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;

  begin
    v_chi_total := (kho.kenh_cac_ky(p_ky) -> 'tong' ->> 'chi_ads_that')::numeric;
  exception when others then v_chi_total := null; end;
  if v_chi_total is not null and v_chi_total <= 0 then v_chi_total := null; end if;

  with coh as (
    select v.id, v.page_id, v.hoi_thoai_id, v.luong, v.chu_de_ma, v.muc_chac_chan,
      case when v.page_id like 'pzl!_%' escape '!' then 'zalo'
           when v.page_id like 'igo!_%' escape '!' then 'instagram'
           else 'facebook' end as platform
    from kho.v_lead_hien_hanh v
    where v.nguon='pancake' and v.thoi_diem_hoi_thoai >= v_from and v.thoi_diem_hoi_thoai < v_to
  ),
  don as (
    select l.page_id, l.hoi_thoai_id, count(distinct dh.id) n
    from kho.don_hang dh join kho.lead l on l.id = dh.lead_id
    where dh.trang_thai <> 'bao_gia'
    group by l.page_id, l.hoi_thoai_id
  ),
  cd as (
    select coh.*, coalesce(d.n,0) as don_chot from coh left join don d
      on d.page_id=coh.page_id and d.hoi_thoai_id=coh.hoi_thoai_id
  ),
  tong as ( select count(*)::int n, count(*) filter (where muc_chac_chan='xac_dinh')::int xd from cd ),
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
      'platform', platform, 'tong', tong, 'xac_dinh', xd, 'suy_ref', sr, 'doi_chieu_lo', dc, 'khong_biet', kb
    ) order by tong desc, platform), '[]'::jsonb) j
    from ( select platform, count(*) tong,
        count(*) filter (where muc_chac_chan='xac_dinh') xd, count(*) filter (where muc_chac_chan='suy_ref') sr,
        count(*) filter (where muc_chac_chan='doi_chieu_lo') dc, count(*) filter (where muc_chac_chan='khong_biet') kb
      from cd group by platform ) t
  ),
  luong_g as (
    select g.luong, coalesce(count(cd.id),0)::int hoi_thoai, coalesce(sum(cd.don_chot),0)::int don_chot,
      coalesce(count(cd.id) filter (where cd.muc_chac_chan='xac_dinh'),0)::int xd
    from (values ('qua_web',1),('mess_truc_tiep',2),('khong_biet',3)) g(luong,ord)
    left join cd on cd.luong=g.luong group by g.luong, g.ord order by g.ord
  ),
  luong_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'luong', luong, 'hoi_thoai', hoi_thoai, 'don_chot', don_chot,
      'ty_le_chot', case when hoi_thoai>0 then round(don_chot::numeric*100/hoi_thoai,1) else null end,
      'chi_ads', case when v_chi_total is not null and (select xd from tong)>0 and xd>0 then round(v_chi_total * xd / (select xd from tong)) else null end,
      'cac', case when v_chi_total is not null and (select xd from tong)>0 and xd>0 and don_chot>0 then round(v_chi_total * xd / (select xd from tong) / don_chot) else null end,
      'cac_toi_da', null
    )), '[]'::jsonb) j from luong_g
  ),
  chude_g as (
    select cd.chu_de_ma, (cd.chu_de_ma is null) chua_gan, count(*)::int hoi_thoai, sum(cd.don_chot)::int don_chot,
      count(*) filter (where cd.muc_chac_chan='xac_dinh')::int xd,
      bool_or(cd.muc_chac_chan in ('suy_ref','doi_chieu_lo')) co_tron_suy
    from cd group by cd.chu_de_ma
  ),
  chude_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'chu_de_ma', chu_de_ma, 'ten', coalesce((select ten from kho.chu_de c where c.ma=g.chu_de_ma), null),
      'chua_gan', chua_gan, 'co_tron_suy', coalesce(co_tron_suy,false), 'hoi_thoai', hoi_thoai, 'don_chot', don_chot,
      'chi_ads', case when v_chi_total is not null and (select xd from tong)>0 and xd>0 then round(v_chi_total * xd / (select xd from tong)) else null end,
      'cac', case when v_chi_total is not null and (select xd from tong)>0 and xd>0 and don_chot>0 then round(v_chi_total * xd / (select xd from tong) / don_chot) else null end
    ) order by (not chua_gan), coalesce((select ten from kho.chu_de c where c.ma=g.chu_de_ma), g.chu_de_ma)), '[]'::jsonb) j
    from chude_g g
  ),
  tongdon as ( select coalesce(sum(don_chot),0)::int dc from cd )
  select jsonb_build_object(
    'ma_ky', p_ky, 'cohort_tong', (select n from tong), 'don_chot_tong', (select dc from tongdon),
    'chi_ads_that_ky', v_chi_total, 'chat_luong', (select j from chat), 'chat_luong_trang', (select j from chat_trang),
    'luong', (select j from luong_j), 'chu_de', (select j from chude_j)
  ) into v_res;

  -- bộ kéo: đèn đỏ theo lan_keo_luc (NHỊP TIM, mỗi lượt); thêm lan_co_lead_luc (lead mới gần nhất).
  v_res := v_res || jsonb_build_object('bo_keo', (
    select jsonb_build_object(
      'lan_keo_gan_nhat', max(lan_keo_luc),
      'phut_truoc', case when max(lan_keo_luc) is not null then floor(extract(epoch from (now()-max(lan_keo_luc)))/60)::int else null end,
      'lan_co_lead', max(lan_co_lead_luc),
      'phut_co_lead', case when max(lan_co_lead_luc) is not null then floor(extract(epoch from (now()-max(lan_co_lead_luc)))/60)::int else null end,
      'hoi_thoai_moi_lan_cuoi', (select so_ban_ghi_lan_cuoi from kho.lead_moc_keo order by lan_co_lead_luc desc nulls last limit 1),
      'tre', case when max(lan_keo_luc) is not null then (now()-max(lan_keo_luc)) > interval '15 minutes' else null end
    ) from kho.lead_moc_keo
  ));
  return v_res;
end $fn$;
grant execute on function kho.cac_theo_luong_chu_de(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.lead_moc_ghi(text,timestamptz,text,int)') is null then raise exception 'THIẾU lead_moc_ghi'; end if;
  raise notice 'db/180 OK: lan_co_lead_luc + nhịp tim lead_moc_ghi + bộ_keo hai mốc.';
end $$;
commit;
