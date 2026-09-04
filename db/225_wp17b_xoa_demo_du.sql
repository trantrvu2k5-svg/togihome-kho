-- WP-17b (1) L-14 · db/225 · xoa_demo xoá ĐỦ: su_kien_meta + lead_nhat_ky cascade-able (escape append-only hẹp), NO ACTION xoá tường minh.
-- Blocker duy nhất (L-13) = su_kien_meta (append-only + FK NO ACTION, không escape). Nới ĐÚNG MỘT ĐƯỜNG: GUC kho.xoa_demo + đơn la_demo.
-- KHÔNG tắt trigger. Dữ liệu THẬT vẫn append-only tuyệt đối. giao_dich/su_kien_quet KHÔNG đụng (QD-44/45, không nối đơn).

-- ═══ A1/A2 · FK → ON DELETE CASCADE (để xoá don_hang tự cascade xuống 2 sổ, escape cho qua) ═══
alter table kho.su_kien_meta            drop constraint su_kien_meta_don_id_fkey;
alter table kho.su_kien_meta            add  constraint su_kien_meta_don_id_fkey            foreign key (don_id) references kho.don_hang(id) on delete cascade;
alter table kho.don_hang_lead_nhat_ky   drop constraint don_hang_lead_nhat_ky_don_id_fkey;
alter table kho.don_hang_lead_nhat_ky   add  constraint don_hang_lead_nhat_ky_don_id_fkey   foreign key (don_id) references kho.don_hang(id) on delete cascade;

-- ═══ A2 · escape DELETE hẹp (GUC + la_demo) ═══
CREATE OR REPLACE FUNCTION kho.sm_chan_sua()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'DELETE' then
    -- [WP-17b] LỐI DUY NHẤT: dọn demo qua xoa_demo (GUC kho.xoa_demo) + dòng thuộc đơn la_demo. Ngoài đó CẤM (WP-77).
    if current_setting('kho.xoa_demo', true) = '1'
       and exists (select 1 from kho.don_hang d where d.id = old.don_id and d.la_demo) then return old; end if;
    raise exception 'su_kien_meta: hàng đợi append-only — CẤM DELETE (chỉ INSERT + đổi trạng thái)';
  end if;
  -- UPDATE: chỉ cho đổi trang_thai/so_lan_thu/phan_hoi_meta/gui_luc. Đụng payload → CẤM.
  if (new.don_id, new.loai_su_kien, new.event_id, new.gia_tri, new.tien_te, new.sdt_bam, new.email_bam, new.ad_id, new.ma_hoi_thoai, new.thoi_diem_don)
     is distinct from
     (old.don_id, old.loai_su_kien, old.event_id, old.gia_tri, old.tien_te, old.sdt_bam, old.email_bam, old.ad_id, old.ma_hoi_thoai, old.thoi_diem_don) then
    raise exception 'su_kien_meta: PAYLOAD append-only — CẤM sửa nội dung (chỉ đổi trạng thái gửi)';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION kho.dhlnk_chan_sua()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- [WP-17b] escape DELETE hẹp: dọn demo (GUC) + đơn la_demo; ngoài đó CẤM (khuôn su_kien_meta).
  if tg_op = 'DELETE' and current_setting('kho.xoa_demo', true) = '1'
     and exists (select 1 from kho.don_hang d where d.id = old.don_id and d.la_demo) then return old; end if;
  raise exception 'don_hang_lead_nhat_ky: sổ APPEND-ONLY — CẤM % (chỉ INSERT qua don_gan_lead)', tg_op;
end $function$
;

-- ═══ A3 · xoa_demo bổ sung NO ACTION không-cascade ═══
CREATE OR REPLACE FUNCTION kho.xoa_demo(p_ma_don text DEFAULT NULL::text, p_xac_nhan text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho', 'public'
AS $function$
declare v_targets text[]; v_ids uuid[]; r jsonb := '{}'::jsonb; n int;
  v_global boolean := (p_ma_don is null); v_sp_huy text;
begin
  if coalesce(kho.current_vai_tro(),'') <> 'ceo' then raise exception 'xoa_demo: chỉ CEO'; end if;
  if v_global then
    if coalesce(p_xac_nhan,'') <> 'XOA_HET' then
      raise exception 'xoa_demo TOÀN BỘ demo cần p_xac_nhan=''XOA_HET'' (xoá cả seed cũ)'; end if;
    select array_agg(ma_don) into v_targets from kho.don_hang where la_demo = true;
  else
    if not exists(select 1 from kho.don_hang where ma_don = p_ma_don and la_demo = true) then
      raise exception 'xoa_demo: đơn % không tồn tại hoặc KHÔNG phải demo (la_demo=false)', p_ma_don; end if;
    v_targets := array[p_ma_don];
  end if;
  v_targets := coalesce(v_targets, '{}');
  select array_agg(id) into v_ids from kho.don_hang where ma_don = any(v_targets);

  perform set_config('kho.xoa_demo','1',true);   -- D8: mở cổng bypass MOC_CHUAN_DA_CHOT cho đơn demo (local tx)

  -- [L-05f] KHÔNG xoá su_kien_quet: sổ QUÉT là LOG THÔ append-only (QD-44). Dọn demo = 0 TÁC ĐỘNG chứ không 0 dấu vết
  --   (QD-46 sửa 22/08). Sự kiện quét ĐÃ XẢY RA — đảo vô nghĩa (khác giao_dich có số dư). Để lại: tem_ma demo mồ côi,
  --   dung_lai_tien_do bỏ qua (guard đơn sống), năng-suất/giờ-công đọc per-tem live, giá vốn = giao_dich (không nối).
  r := r || jsonb_build_object('su_kien_quet', 'giu_lai_log_tho');
  delete from kho.tien_do_tem where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tien_do_tem', n);
  delete from kho.tem_da_in where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tem_da_in', n);
  delete from kho.lan_in_tem where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('lan_in_tem', n);
  delete from kho.don_hang_mon_nhat_ky where don_id = any(v_ids); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang_mon_nhat_ky', n);
  for v_sp_huy in select so_phieu from kho.phieu where ma_don = any(v_targets) and loai='xuat_sx' and trang_thai='ghi_so' loop
    perform kho.huy_phieu(v_sp_huy, 'xoa demo (WP-33 đảo sổ)'); end loop;
  update kho.phieu set ma_don = null where ma_don = any(v_targets);
  delete from kho.so_don_vi_mon where mon_id in (select id from kho.don_hang_mon where don_id = any(v_ids)); get diagnostics n = row_count; r := r || jsonb_build_object('so_don_vi_mon', n);
  -- [WP-17b] NO ACTION không cascade → xoá tường minh trước cha (tem_ban_ve.mon_id, mon_doi_phien_ban.mon_id)
  delete from kho.su_kien_meta where don_id = any(v_ids); get diagnostics n = row_count; r := r || jsonb_build_object('su_kien_meta', n);
  delete from kho.don_hang_lead_nhat_ky where don_id = any(v_ids); get diagnostics n = row_count; r := r || jsonb_build_object('lead_nhat_ky', n);
  delete from kho.tem_ban_ve where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tem_ban_ve', n);
  delete from kho.mon_doi_phien_ban where mon_id in (select id from kho.don_hang_mon where don_id = any(v_ids)); get diagnostics n = row_count; r := r || jsonb_build_object('mon_doi_phien_ban', n);
  delete from kho.don_hang where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang', n);
  delete from kho.khach where la_demo = true and sdt not in (select sdt_khach from kho.don_hang where sdt_khach is not null); get diagnostics n = row_count; r := r || jsonb_build_object('khach', n);
  if v_global then
    delete from kho.phieu_dem_ngay where la_demo = true; get diagnostics n = row_count; r := r || jsonb_build_object('phieu_dem_ngay', n);
  end if;
  return jsonb_build_object('ok', true, 'pham_vi', case when v_global then 'TOAN_BO' else p_ma_don end, 'xoa', r);
end $function$
;
