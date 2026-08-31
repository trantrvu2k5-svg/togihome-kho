-- db/187 · WP-70 L-70r8 · GỘP LÔ lead_ghi → lead_ghi_lo: 540 câu/lượt → ~10. Cắt CPU dưới trần Free 10ms.
--   ⚠ KHÔNG IDEMPOTENT: create function (or-replace an toàn) — nhưng theo QD-61 vẫn backup.
--   Ngữ nghĩa GIỐNG HỆT lead_ghi: cùng DẤU VÂN (md5 14 field gồm cham_cuoi_luc), cùng quy tắc khong_doi,
--     cùng cách sinh stt (bigserial), idempotent. Khác một ly → 9.650 dòng sổ hiện có thành vô nghĩa.
--   GIỮ NGUYÊN lead_ghi cũ (cuu_sdt/backfill_moc đang gọi) — KHÔNG drop, KHÔNG đổi chữ ký.
--   Index dedup ix_lead_ht_stt (page_id,hoi_thoai_id,stt desc) ĐÃ CÓ (db/185) → KHÔNG tạo lại.
--   ⚠ Cổng backup QD-61: dump fail → DỪNG. CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: drop function kho.lead_ghi_lo(jsonb);
begin;

create or replace function kho.lead_ghi_lo(p_ds jsonb)
returns jsonb language plpgsql security definer set search_path to 'kho'
as $fn$
declare v_ghi int; v_uniq int;
begin
  -- cổng vai GIỐNG lead_ghi
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'lead_ghi_lo: chỉ ceo/ke_toan hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_ds,'[]'::jsonb)) e where e->>'page_id' is null or e->>'hoi_thoai_id' is null) then
    raise exception 'lead_ghi_lo: có phần tử thiếu page_id/hoi_thoai_id';
  end if;

  with src as (
    select
      e->>'page_id' as page_id, e->>'hoi_thoai_id' as hoi_thoai_id,
      coalesce(nullif(e->>'nguon',''),'pancake') as i_nguon,
      nullif(e->>'khach_pancake_id','') as i_khach, nullif(e->>'loai','') as i_loai,
      (e->>'thoi_diem_hoi_thoai')::timestamptz as i_tdt,
      e->>'luong' as i_luong, nullif(e->>'loai_ma','') as i_loaima,
      e->>'muc_chac_chan' as i_muc, nullif(e->>'ad_id','') as i_ad,
      nullif(e->>'ref_web','') as i_ref, nullif(e->>'sdt','') as i_sdt,
      nullif(e->>'ten_khach','') as i_ten,
      (nullif(e->>'cham_cuoi_luc',''))::timestamptz as i_cham,
      coalesce((e->>'moc_dang_ngo')::boolean, false) as i_ngo,
      -- DẤU VÂN: y hệt lead_ghi (concat_ws bỏ NULL; nguon coalesce, còn lại raw ->>)
      md5(concat_ws('|', coalesce(e->>'nguon','pancake'), e->>'page_id', e->>'hoi_thoai_id',
        e->>'khach_pancake_id', e->>'loai', e->>'thoi_diem_hoi_thoai',
        e->>'luong', e->>'loai_ma', e->>'muc_chac_chan',
        e->>'ad_id', e->>'ref_web', e->>'sdt', e->>'ten_khach', e->>'cham_cuoi_luc')) as dau_van,
      ord
    from jsonb_array_elements(coalesce(p_ds,'[]'::jsonb)) with ordinality t(e, ord)
  ),
  -- trong LÔ có 2 dòng cùng (page,ht) → giữ dòng CUỐI (ord lớn nhất): xác định, không đẻ 2 bản mâu thuẫn
  uniq as (
    select distinct on (page_id, hoi_thoai_id) * from src
    order by page_id, hoi_thoai_id, ord desc
  ),
  -- dấu vân HIỆN HÀNH per id (lateral limit 1 → dùng index ix_lead_ht_stt)
  cur as (
    select u.*, c.dau_van as cur_dv from uniq u
    left join lateral (
      select dau_van from kho.lead l
      where l.page_id = u.page_id and l.hoi_thoai_id = u.hoi_thoai_id
      order by l.stt desc limit 1
    ) c on true
  ),
  to_ins as (select * from cur where cur_dv is null or cur_dv <> dau_van),
  ins as (
    insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,loai_ma,muc_chac_chan,ad_id,ref_web,sdt,ten_khach,cham_cuoi_luc,moc_dang_ngo,dau_van)
    select i_nguon,page_id,hoi_thoai_id,i_khach,i_loai,i_tdt,i_luong,i_loaima,i_muc,i_ad,i_ref,i_sdt,i_ten,i_cham,i_ngo,dau_van
    from to_ins order by ord            -- ord tăng → stt đơn điệu theo thứ tự đến
    returning 1
  )
  select count(*)::int from ins into v_ghi;
  select count(*)::int from (select 1 from jsonb_array_elements(coalesce(p_ds,'[]'::jsonb)) with ordinality t(e,o)
    where e->>'page_id' is not null group by e->>'page_id', e->>'hoi_thoai_id') q into v_uniq;
  return jsonb_build_object('ghi', v_ghi, 'khong_doi', v_uniq - v_ghi);
end $fn$;
revoke execute on function kho.lead_ghi_lo(jsonb) from public, anon;
grant execute on function kho.lead_ghi_lo(jsonb) to authenticated;

do $$ begin
  if to_regprocedure('kho.lead_ghi_lo(jsonb)') is null then raise exception 'THIẾU lead_ghi_lo'; end if;
  raise notice 'db/187 OK: lead_ghi_lo (gộp lô) — lead_ghi cũ giữ nguyên.';
end $$;
commit;
