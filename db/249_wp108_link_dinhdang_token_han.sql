-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 249 — WP-108 L-7 (3 việc nhỏ):
--   (a) HẠN TOKEN META — MỘT CHỖ DUY NHẤT: kho.tham_so_van_hanh ma='meta_token_han' (epoch giây, mẫu như wp79b).
--       Client đọc qua RPC meta_token_trang_thai() → đèn màn "Việc phải làm". Thay token thì SỬA NGÀY Ở ĐÂY.
--   (c) ĐỊNH DẠNG 'quảng cáo link': link_data CÓ link nhưng KHÔNG image_hash/child/video (2 mẫu Sophia trước rơi 'chưa rõ').
--       Thêm nhánh vào ads_suy_dinh_dang + điền lại dinh_dang_that. (Ảnh: Meta không trả qua API → ô xám ghi rõ, xử ở client.)
--   Idempotent. HOÀN TÁC: xoá row tham_so + drop RPC + chạy lại ads_suy_dinh_dang bản db/240.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- (a) hạn token — một chỗ duy nhất
insert into kho.tham_so_van_hanh(ma, gia_tri, don_vi, ghi_chu)
select 'meta_token_han', extract(epoch from timestamptz '2026-11-07 00:00:00+07'), 'epoch_giay',
  'WP-108 L-7: hạn token Meta (META_CAPI_TOKEN) — MỘT CHỖ DUY NHẤT. Client đọc qua meta_token_trang_thai(); bộ kéo tham chiếu. Thay token thì ĐỔI NGÀY Ở ĐÂY.'
where not exists (select 1 from kho.tham_so_van_hanh where ma='meta_token_han');

create or replace function kho.meta_token_trang_thai() returns jsonb
language sql stable security definer set search_path to 'kho' as $$
  select jsonb_build_object(
    'han', to_char((to_timestamp(gia_tri) at time zone 'Asia/Ho_Chi_Minh')::date, 'DD/MM/YYYY'),
    'con_ngay', floor(extract(epoch from (to_timestamp(gia_tri) - now())) / 86400)::int)
  from kho.tham_so_van_hanh where ma='meta_token_han';
$$;
revoke execute on function kho.meta_token_trang_thai() from public, anon;
grant  execute on function kho.meta_token_trang_thai() to authenticated;

-- (c) nhánh 'quảng cáo link' trong ads_suy_dinh_dang (giữ nguyên các nhánh cũ, chèn trước 'chưa rõ')
create or replace function kho.ads_suy_dinh_dang(p_tho jsonb) returns text
language plpgsql immutable set search_path to 'kho' as $fn$
declare oss jsonb; vd jsonb; ld jsonb; nchild int; afs jsonb; link text; appdest text;
begin
  oss := p_tho->'object_story_spec';
  vd  := oss->'video_data'; ld := oss->'link_data';
  nchild := case when jsonb_typeof(ld->'child_attachments')='array' then jsonb_array_length(ld->'child_attachments') else 0 end;
  afs := p_tho->'asset_feed_spec';
  link := coalesce(ld->>'link', vd->'call_to_action'->'value'->>'link', ld->'call_to_action'->'value'->>'link', '');
  appdest := coalesce(vd->'call_to_action'->'value'->>'app_destination', ld->'call_to_action'->'value'->>'app_destination');
  if (vd->>'video_id' is not null or vd->>'image_hash' is not null) and nchild < 2 then return 'video đơn'; end if;
  if (ld->>'image_hash' is not null) and nchild < 2 then return 'ảnh đơn'; end if;
  if nchild >= 2 then return 'ảnh xoay vòng'; end if;
  if link ~* 'canvas_doc' then return 'trải nghiệm tức thì'; end if;
  if appdest = 'MESSENGER' or afs->'message_extensions' is not null then return 'chạy tin nhắn'; end if;
  if afs is not null then return 'mẫu linh hoạt'; end if;
  if p_tho->>'effective_object_story_id' is not null and vd is null and ld is null then return 'đẩy bài có sẵn'; end if;
  if ld is not null and nullif(ld->>'link','') is not null then return 'quảng cáo link'; end if;   -- [L-108-7] link_data có link, không image_hash/child/video
  return 'chưa rõ';
end $fn$;

update kho.ads_mau set dinh_dang_that = kho.ads_suy_dinh_dang(tho);

commit;
