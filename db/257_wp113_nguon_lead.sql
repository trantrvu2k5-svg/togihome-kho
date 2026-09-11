-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 257 — WP-113 lô A: sửa NGUỒN lead dưới DB (luong tính MỘT chỗ, không hạ nguồn đã biết, chữa bản bị chôn).
--   BỆNH (L-113-1h): worker keo_lead_core:68 HARDCODE luong='khong_biet' → luong chết; và mỗi lần kéo APPEND
--   một dòng khong_biet (dau_van đổi theo cham_cuoi_luc) → CHÔN muc/suy_ref mà khop_click_lead đã nâng.
--   CHỮA (append-only, KHÔNG update/delete dòng cũ; v_lead_hien_hanh lấy stt cao nhất):
--     [1] lead_luong(ad,muc,ref) = MỘT chỗ tính luồng · [2] lead_ghi_lo carry-forward muc/ref mạnh nhất +
--     tính luong (bỏ giá trị worker) · [3] append dòng chỉnh (nguon='chinh_wp113') cho khoá bị chôn.
--   Ngoại lệ QD-79/80: moc_dang_ngo=true → GIỮ muc worker (cho hạ), không carry-forward.
--   HOÀN TÁC: chạy lại bản db trước của lead_ghi_lo + drop lead_luong/lead_muc_rank + xoá dòng nguon='chinh_wp113'.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ── [1a] xếp hạng mức chắc chắn (một nguồn) ──
create or replace function kho.lead_muc_rank(p text) returns int language sql immutable as $function$
  select case p when 'xac_dinh' then 3 when 'suy_ref' then 2 when 'doi_chieu_lo' then 1 else 0 end $function$;

-- ── [1b] LUỒNG tính MỘT chỗ. ad_id→mess; khớp web (suy_ref/ref_web)→qua_web; cả hai→khong_biet (QD-85 mơ hồ). ──
create or replace function kho.lead_luong(p_ad text, p_muc text, p_ref text) returns text
 language plpgsql immutable as $function$
declare v_mess boolean; v_web boolean; v text;
begin
  v_mess := (nullif(p_ad,'') is not null);
  v_web  := (p_muc = 'suy_ref' or nullif(p_ref,'') is not null);
  v := case when v_mess and v_web then 'khong_biet'
            when v_mess then 'mess_truc_tiep'
            when v_web  then 'qua_web'
            else 'khong_biet' end;
  if v not in ('mess_truc_tiep','qua_web','khong_biet') then
    raise exception 'lead_luong: giá trị luồng lạ "%"', v; end if;
  return v;
end $function$;

-- ── [2] lead_ghi_lo: carry-forward muc/ref mạnh nhất + tính luong (KHÔNG tin luong worker). moc_dang_ngo → giữ muc worker. ──
create or replace function kho.lead_ghi_lo(p_ds text)
 returns jsonb language plpgsql security definer set search_path to 'kho' as $function$
declare v_ds jsonb := coalesce(p_ds, '[]')::jsonb; v_ghi int; v_uniq int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'lead_ghi_lo: chỉ ceo/ke_toan hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)'; end if;
  if jsonb_typeof(v_ds) <> 'array' then raise exception 'lead_ghi_lo: p_ds phải là MẢNG JSON, nhận %', jsonb_typeof(v_ds); end if;
  if exists (select 1 from jsonb_array_elements(v_ds) e where e->>'page_id' is null or e->>'hoi_thoai_id' is null) then
    raise exception 'lead_ghi_lo: có phần tử thiếu page_id/hoi_thoai_id'; end if;

  with src as (
    select
      e->>'page_id' as page_id, e->>'hoi_thoai_id' as hoi_thoai_id,
      coalesce(nullif(e->>'nguon',''),'pancake') as i_nguon,
      nullif(e->>'khach_pancake_id','') as i_khach, nullif(e->>'loai','') as i_loai,
      (e->>'thoi_diem_hoi_thoai')::timestamptz as i_tdt,
      nullif(e->>'loai_ma','') as i_loaima,
      e->>'muc_chac_chan' as i_muc, nullif(e->>'ad_id','') as i_ad,
      nullif(e->>'ref_web','') as i_ref, nullif(e->>'sdt','') as i_sdt,
      nullif(e->>'ten_khach','') as i_ten,
      (nullif(e->>'cham_cuoi_luc',''))::timestamptz as i_cham,
      coalesce((e->>'moc_dang_ngo')::boolean, false) as i_ngo, ord
    from jsonb_array_elements(v_ds) with ordinality t(e, ord)
  ),
  uniq as (select distinct on (page_id, hoi_thoai_id) * from src order by page_id, hoi_thoai_id, ord desc),
  cur as (
    select u.*, c.dau_van cur_dv, c.muc_chac_chan cur_muc, c.ref_web cur_ref
    from uniq u
    left join lateral (select dau_van, muc_chac_chan, ref_web from kho.lead l
       where l.page_id=u.page_id and l.hoi_thoai_id=u.hoi_thoai_id order by l.stt desc limit 1) c on true
  ),
  eff as (
    select cur.*,
      -- [WP-113 §2] muc MẠNH NHẤT giữa mới và hiện hành; TRỪ mốc đáng ngờ (QD-79/80) → giữ muc worker (cho hạ)
      case when i_ngo then i_muc
           when kho.lead_muc_rank(i_muc) >= kho.lead_muc_rank(cur_muc) then i_muc else cur_muc end as e_muc,
      case when i_ngo then i_ref else coalesce(i_ref, cur_ref) end as e_ref
    from cur
  ),
  eff2 as (
    select eff.*, kho.lead_luong(i_ad, e_muc, e_ref) as e_luong from eff
  ),
  eff3 as (
    select eff2.*,
      md5(concat_ws('|', i_nguon, page_id, hoi_thoai_id, i_khach, i_loai, i_tdt::text,
        e_luong, i_loaima, e_muc, i_ad, e_ref, i_sdt, i_ten, i_cham::text)) as e_dauvan
    from eff2
  ),
  to_ins as (select * from eff3 where cur_dv is null or cur_dv <> e_dauvan),
  ins as (
    insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,loai_ma,muc_chac_chan,ad_id,ref_web,sdt,ten_khach,cham_cuoi_luc,moc_dang_ngo,dau_van)
    select i_nguon,page_id,hoi_thoai_id,i_khach,i_loai,i_tdt,e_luong,i_loaima,e_muc,i_ad,e_ref,i_sdt,i_ten,i_cham,i_ngo,e_dauvan
    from to_ins order by ord returning 1
  )
  select count(*)::int from ins into v_ghi;
  select count(*)::int from (select 1 from jsonb_array_elements(v_ds) e where e->>'page_id' is not null group by e->>'page_id', e->>'hoi_thoai_id') q into v_uniq;
  return jsonb_build_object('ghi', v_ghi, 'khong_doi', v_uniq - v_ghi);
end $function$;

-- ── [2b] lead_ghi (đơn) — GIỮ tương đương lead_ghi_lo (test đối chứng WP-70): cùng carry-forward + lead_luong + dấu vân. ──
create or replace function kho.lead_ghi(p_lead jsonb)
 returns jsonb language plpgsql security definer set search_path to 'kho' as $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_dv text; v_last text;
  v_page text := p_lead->>'page_id'; v_ht text := p_lead->>'hoi_thoai_id'; v_id uuid; v_stt bigint;
  i_nguon text := coalesce(nullif(p_lead->>'nguon',''),'pancake');
  i_khach text := nullif(p_lead->>'khach_pancake_id',''); i_loai text := nullif(p_lead->>'loai','');
  i_tdt timestamptz := (p_lead->>'thoi_diem_hoi_thoai')::timestamptz; i_loaima text := nullif(p_lead->>'loai_ma','');
  i_muc text := p_lead->>'muc_chac_chan'; i_ad text := nullif(p_lead->>'ad_id',''); i_ref text := nullif(p_lead->>'ref_web','');
  i_sdt text := nullif(p_lead->>'sdt',''); i_ten text := nullif(p_lead->>'ten_khach','');
  i_cham timestamptz := (nullif(p_lead->>'cham_cuoi_luc',''))::timestamptz;
  i_ngo boolean := coalesce((p_lead->>'moc_dang_ngo')::boolean,false);
  v_cur_muc text; v_cur_ref text; e_muc text; e_ref text; e_luong text;
begin
  if not (v_vai in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'lead_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)'; end if;
  if v_page is null or v_ht is null then raise exception 'lead_ghi: thiếu page_id/hoi_thoai_id'; end if;
  select muc_chac_chan, ref_web into v_cur_muc, v_cur_ref from kho.lead where page_id=v_page and hoi_thoai_id=v_ht order by stt desc limit 1;
  e_muc := case when i_ngo then i_muc when kho.lead_muc_rank(i_muc) >= kho.lead_muc_rank(v_cur_muc) then i_muc else v_cur_muc end;
  e_ref := case when i_ngo then i_ref else coalesce(i_ref, v_cur_ref) end;
  e_luong := kho.lead_luong(i_ad, e_muc, e_ref);
  v_dv := md5(concat_ws('|', i_nguon, v_page, v_ht, i_khach, i_loai, i_tdt::text,
     e_luong, i_loaima, e_muc, i_ad, e_ref, i_sdt, i_ten, i_cham::text));
  select dau_van into v_last from kho.lead where page_id=v_page and hoi_thoai_id=v_ht order by stt desc limit 1;
  if v_last is not null and v_last = v_dv then return jsonb_build_object('ket','khong_doi'); end if;
  insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,loai_ma,muc_chac_chan,ad_id,ref_web,sdt,ten_khach,cham_cuoi_luc,moc_dang_ngo,dau_van)
  values(i_nguon, v_page, v_ht, i_khach, i_loai, i_tdt, e_luong, i_loaima, e_muc, i_ad, e_ref, i_sdt, i_ten, i_cham, i_ngo, v_dv)
  returning id, stt into v_id, v_stt;
  return jsonb_build_object('ket','da_ghi','id',v_id,'stt',v_stt);
end $function$;

-- ── [3] CHỮA bản hiện hành bị chôn: append dòng chỉnh (stt tự tăng → thành hiện hành). Idempotent qua điều kiện "bị chôn". ──
insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,loai_ma,muc_chac_chan,ad_id,ref_web,sdt,ten_khach,cham_cuoi_luc,moc_dang_ngo,dau_van)
select 'chinh_wp113', cur.page_id, cur.hoi_thoai_id, cur.khach_pancake_id, cur.loai, cur.thoi_diem_hoi_thoai,
       kho.lead_luong(case when h.co_ad then 'x' end, h.mx_muc, case when h.co_ref then 'x' end),
       cur.loai_ma, h.mx_muc, cur.ad_id, cur.ref_web, cur.sdt, cur.ten_khach, cur.cham_cuoi_luc, cur.moc_dang_ngo,
       md5('chinh_wp113|'||cur.page_id||'|'||cur.hoi_thoai_id||'|'||h.mx_muc||'|'||clock_timestamp()::text)
from (
  select page_id, hoi_thoai_id, max(kho.lead_muc_rank(muc_chac_chan)) mx_rank,
    (array_agg(muc_chac_chan order by kho.lead_muc_rank(muc_chac_chan) desc))[1] mx_muc,
    bool_or(ad_id is not null) co_ad, bool_or(ref_web is not null) co_ref
  from kho.lead group by page_id, hoi_thoai_id
) h
join (select distinct on (page_id,hoi_thoai_id) * from kho.lead order by page_id,hoi_thoai_id,stt desc) cur
  using (page_id, hoi_thoai_id)
where h.mx_rank > kho.lead_muc_rank(cur.muc_chac_chan)   -- hiện hành yếu hơn lịch sử = bị chôn
   or cur.luong <> kho.lead_luong(case when h.co_ad then 'x' end, h.mx_muc, case when h.co_ref then 'x' end);

commit;
