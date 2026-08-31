-- db/185 · WP-70 L-70r4 · Mốc CHẠM CUỐI (updated_at) tách khỏi thoi_diem_hoi_thoai (inserted_at). QD-15 ba mốc.
--   ⚠ KHÔNG IDEMPOTENT: add column / create index / or-replace hàm+view chạy lại có thể lỗi. Chạy ĐÚNG MỘT LẦN.
--   Vì sao HAI mốc, không một: thoi_diem_hoi_thoai = ngày QUEN khách (inserted_at) — trả lời "khách từ bao giờ";
--     cham_cuoi_luc = lần CHẠM CUỐI (updated_at) — trả lời "hoạt động gần nhất". Gộp làm một là mất một câu.
--     ⚠ updated_at NHÍCH cả khi CHÍNH MÌNH trả lời (last_sent_by=page) → là "chạm cuối", KHÔNG thuần "khách nhắn".
--     Đối chiếu cửa sổ 30' của WP-79 đọc cham_cuoi_luc, KHÔNG đọc thoi_diem_hoi_thoai (bài học lead Vy lệch 480 ngày).
--   ⚠ Cổng backup QD-61: dump fail → DỪNG. CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: drop view kho.v_lead_hien_hanh; (tạo lại bản cũ) ; alter table kho.lead drop column cham_cuoi_luc, drop column moc_dang_ngo;
--     và tạo lại lead_ghi bản không có cham_cuoi_luc.
begin;

alter table kho.lead add column cham_cuoi_luc timestamptz null;
alter table kho.lead add column moc_dang_ngo  boolean not null default false;
comment on column kho.lead.cham_cuoi_luc is 'updated_at Pancake = lần CHẠM CUỐI (gồm cả mình trả lời) — dùng cho đối chiếu cửa sổ 30 phút WP-79. KHÁC thoi_diem_hoi_thoai (=inserted_at, ngày quen khách).';
comment on column kho.lead.moc_dang_ngo is 'true khi mốc KHÔNG chắc: thiếu cham_cuoi_luc, hoặc |cham_cuoi_luc - thoi_diem_hoi_thoai| > 24h (contact cũ nhắn lại). WP-79 LOẠI/HẠ MỨC nhóm này khỏi doi_chieu_lo. Số suy đeo nhãn (QD-10/15).';
-- Index: cham_cuoi_luc SẼ bị lọc theo cửa sổ thời gian (khác duong_dan db/184 chưa ai lọc nên cố ý không index).
create index ix_lead_cham_cuoi on kho.lead (cham_cuoi_luc);

-- ── lead_ghi: THÊM cham_cuoi_luc vào INSERT + vào DẤU VÂN (nếu không, backfill fields-giống-hệt trả khong_doi). ──
create or replace function kho.lead_ghi(p_lead jsonb)
 returns jsonb language plpgsql security definer set search_path to 'kho'
as $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_dv text; v_last text;
  v_page text := p_lead->>'page_id'; v_ht text := p_lead->>'hoi_thoai_id'; v_id uuid; v_stt bigint;
begin
  if not (v_vai in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then raise exception 'lead_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)'; end if;
  if v_page is null or v_ht is null then raise exception 'lead_ghi: thiếu page_id/hoi_thoai_id'; end if;
  v_dv := md5(concat_ws('|', coalesce(p_lead->>'nguon','pancake'), v_page, v_ht,
     p_lead->>'khach_pancake_id', p_lead->>'loai', p_lead->>'thoi_diem_hoi_thoai',
     p_lead->>'luong', p_lead->>'loai_ma', p_lead->>'muc_chac_chan',
     p_lead->>'ad_id', p_lead->>'ref_web', p_lead->>'sdt', p_lead->>'ten_khach',
     p_lead->>'cham_cuoi_luc'));                                    -- ← thêm vào dấu vân
  select dau_van into v_last from kho.lead where page_id=v_page and hoi_thoai_id=v_ht order by stt desc limit 1;
  if v_last is not null and v_last = v_dv then return jsonb_build_object('ket','khong_doi'); end if;
  insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,loai_ma,muc_chac_chan,ad_id,ref_web,sdt,ten_khach,cham_cuoi_luc,moc_dang_ngo,dau_van)
  values(coalesce(nullif(p_lead->>'nguon',''),'pancake'), v_page, v_ht,
     nullif(p_lead->>'khach_pancake_id',''), nullif(p_lead->>'loai',''),
     (p_lead->>'thoi_diem_hoi_thoai')::timestamptz, p_lead->>'luong',
     nullif(p_lead->>'loai_ma',''), p_lead->>'muc_chac_chan',
     nullif(p_lead->>'ad_id',''), nullif(p_lead->>'ref_web',''), nullif(p_lead->>'sdt',''),
     nullif(p_lead->>'ten_khach',''),
     (nullif(p_lead->>'cham_cuoi_luc',''))::timestamptz,             -- ← mốc chạm cuối
     coalesce((p_lead->>'moc_dang_ngo')::boolean, false),           -- ← cờ nghi
     v_dv)
  returning id, stt into v_id, v_stt;
  return jsonb_build_object('ket','da_ghi','id',v_id,'stt',v_stt);
end $function$;

-- ── v_lead_hien_hanh: thêm 2 cột mới (cột thêm ở CUỐI → create-or-replace view hợp lệ). ──
create or replace view kho.v_lead_hien_hanh as
  select distinct on (page_id, hoi_thoai_id)
    id, stt, nguon, page_id, hoi_thoai_id, khach_pancake_id, loai, thoi_diem_hoi_thoai,
    luong, muc_chac_chan, ad_id, ref_web, sdt, dau_van, ghi_nhan_luc, ten_khach, loai_ma,
    cham_cuoi_luc, moc_dang_ngo
  from kho.lead
  order by page_id, hoi_thoai_id, stt desc;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='kho' and table_name='lead' and column_name='cham_cuoi_luc') then raise exception 'THIẾU cột cham_cuoi_luc'; end if;
  raise notice 'db/185 OK: +cham_cuoi_luc +moc_dang_ngo · lead_ghi (dấu vân +cham_cuoi) · view cập nhật.';
end $$;
commit;
