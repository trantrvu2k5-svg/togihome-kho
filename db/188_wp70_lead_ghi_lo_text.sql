-- db/188 · WP-70 L-70r8 vá · lead_ghi_lo nhận TEXT (cast ::jsonb trong hàm), KHÔNG nhận jsonb.
--   GỐC: postgres.js (Worker) mã hoá KÉP chuỗi gửi tới tham số JSONB → thành jsonb-string scalar →
--     "cannot extract elements from a scalar" (repro xác nhận). pg (CLI/test) không bị nên test qua giả.
--   Sửa: tham số TEXT → postgres.js gửi chuỗi thẳng (không encode) → cast ::jsonb trong hàm ra MẢNG.
--     JSON.stringify(mảng) chạy đúng cả pg lẫn postgres.js.
--   ⚠ KHÔNG IDEMPOTENT. Cổng backup QD-61, CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: drop function kho.lead_ghi_lo(text); (bản jsonb đã drop ở đây).
begin;

-- DROP bản jsonb (db/187) — đổi kiểu tham số phải drop, không create-or-replace (bài học 03 §C overload).
drop function if exists kho.lead_ghi_lo(jsonb);

create function kho.lead_ghi_lo(p_ds text)
returns jsonb language plpgsql security definer set search_path to 'kho'
as $fn$
declare v_ds jsonb := coalesce(p_ds, '[]')::jsonb; v_ghi int; v_uniq int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'lead_ghi_lo: chỉ ceo/ke_toan hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)';
  end if;
  if jsonb_typeof(v_ds) <> 'array' then raise exception 'lead_ghi_lo: p_ds phải là MẢNG JSON, nhận %', jsonb_typeof(v_ds); end if;
  if exists (select 1 from jsonb_array_elements(v_ds) e where e->>'page_id' is null or e->>'hoi_thoai_id' is null) then
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
      md5(concat_ws('|', coalesce(e->>'nguon','pancake'), e->>'page_id', e->>'hoi_thoai_id',
        e->>'khach_pancake_id', e->>'loai', e->>'thoi_diem_hoi_thoai',
        e->>'luong', e->>'loai_ma', e->>'muc_chac_chan',
        e->>'ad_id', e->>'ref_web', e->>'sdt', e->>'ten_khach', e->>'cham_cuoi_luc')) as dau_van,
      ord
    from jsonb_array_elements(v_ds) with ordinality t(e, ord)
  ),
  uniq as (select distinct on (page_id, hoi_thoai_id) * from src order by page_id, hoi_thoai_id, ord desc),
  cur as (
    select u.*, c.dau_van as cur_dv from uniq u
    left join lateral (select dau_van from kho.lead l where l.page_id=u.page_id and l.hoi_thoai_id=u.hoi_thoai_id order by l.stt desc limit 1) c on true
  ),
  to_ins as (select * from cur where cur_dv is null or cur_dv <> dau_van),
  ins as (
    insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,loai_ma,muc_chac_chan,ad_id,ref_web,sdt,ten_khach,cham_cuoi_luc,moc_dang_ngo,dau_van)
    select i_nguon,page_id,hoi_thoai_id,i_khach,i_loai,i_tdt,i_luong,i_loaima,i_muc,i_ad,i_ref,i_sdt,i_ten,i_cham,i_ngo,dau_van
    from to_ins order by ord returning 1
  )
  select count(*)::int from ins into v_ghi;
  select count(*)::int from (select 1 from jsonb_array_elements(v_ds) e where e->>'page_id' is not null group by e->>'page_id', e->>'hoi_thoai_id') q into v_uniq;
  return jsonb_build_object('ghi', v_ghi, 'khong_doi', v_uniq - v_ghi);
end $fn$;
revoke execute on function kho.lead_ghi_lo(text) from public, anon;
grant execute on function kho.lead_ghi_lo(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.lead_ghi_lo(text)') is null then raise exception 'THIẾU lead_ghi_lo(text)'; end if;
  if to_regprocedure('kho.lead_ghi_lo(jsonb)') is not null then raise exception 'CÒN bản jsonb (phải drop)'; end if;
  raise notice 'db/188 OK: lead_ghi_lo(text) — bản jsonb đã drop.';
end $$;
commit;
