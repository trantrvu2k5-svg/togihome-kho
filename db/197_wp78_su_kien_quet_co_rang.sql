-- db/197 · WP-78 L-05f · su_kien_quet THÀNH SỔ CÓ RĂNG. QD-46 ('0 tác động') + QD-44 (append-only) + QD-86.
--   GỐC: QD-44 tuyên su_kien_quet append-only NHƯNG xoa_demo (db/120/125/132) vẫn DELETE thẳng — chỗ chưa cập nhật
--     khi QD-46 đổi '0 dấu vết'→'0 TÁC ĐỘNG' (22/08). giao_dich đã theo (dòng-đảo qua huy_phieu); su_kien_quet bị bỏ sót.
--   (1) xoa_demo THÔI xoá su_kien_quet — sổ quét là LOG THÔ sự kiện (QD-18: giờ chạm tay đã xảy ra), đảo vô nghĩa
--       (khác giao_dich có SỐ DƯ nên đảo được). Sự kiện quét demo NẰM LẠI, mồ côi, không ai đọc tới.
--   (2) dung_lai_tien_do CHỈ dựng lại tem còn ĐƠN SỐNG → không resurrect tien_do_tem cho tem demo mồ côi ('0 tác động').
--   (3) trigger sq_chan_sua chặn UPDATE/DELETE — RAISE CỨNG, KHÔNG cửa GUC thoát (cửa thoát biến sổ thành không-sổ).
--   ⚠ KHÔNG IDEMPOTENT (create trigger). Cổng backup QD-61, CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: drop trigger sq_chan_sua on kho.su_kien_quet; drop function kho.sq_chan_sua();
--     + chạy lại db/132(xoa_demo) + db/082(dung_lai_tien_do).
begin;

-- ── (1) xoa_demo: BỎ dòng delete su_kien_quet (verbatim db/132, chỉ đổi đúng một dòng). ──
create or replace function kho.xoa_demo(p_ma_don text default null::text, p_xac_nhan text default null::text)
 returns jsonb language plpgsql security definer set search_path to 'kho', 'public'
as $function$
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
  delete from kho.don_hang where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang', n);
  delete from kho.khach where la_demo = true and sdt not in (select sdt_khach from kho.don_hang where sdt_khach is not null); get diagnostics n = row_count; r := r || jsonb_build_object('khach', n);
  if v_global then
    delete from kho.phieu_dem_ngay where la_demo = true; get diagnostics n = row_count; r := r || jsonb_build_object('phieu_dem_ngay', n);
  end if;
  return jsonb_build_object('ok', true, 'pham_vi', case when v_global then 'TOAN_BO' else p_ma_don end, 'xoa', r);
end $function$;

-- ── (2) dung_lai_tien_do: chỉ dựng lại tem còn ĐƠN SỐNG (bỏ tem mồ côi — demo đã xoá đơn). '0 tác động'. ──
create or replace function kho.dung_lai_tien_do()
 returns integer language plpgsql security definer set search_path to 'kho'
as $function$
declare n int := 0; t text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'dung_lai_tien_do: chỉ ceo/xuong'; end if;
  delete from kho.tien_do_tem;
  -- [L-05f] CHỈ tem còn đơn sống: tem_ma → tem_ban_ve.ma_don → don_hang. Tem mồ côi (đơn demo đã xoá) KHÔNG dựng lại
  --   → sự kiện quét demo để lại KHÔNG resurrect tien_do_tem. Đây là điểm bảo đảm '0 tác động' của việc bỏ delete su_kien_quet.
  for t in select distinct sq.tem_ma from kho.su_kien_quet sq
             where sq.ket_qua='nhan'
               and exists (select 1 from kho.tem_ban_ve tbv join kho.don_hang dh on dh.ma_don = tbv.ma_don where tbv.ma_tam = sq.tem_ma)
           loop
    perform kho.capnhat_tien_do_tem(t); n := n + 1;
  end loop;
  return n;
end $function$;

-- ── (3) RĂNG: trigger chặn UPDATE/DELETE su_kien_quet (khuôn gd_chan_sua/cc_chan_sua/dhlnk_chan_sua, RAISE cứng). ──
create or replace function kho.sq_chan_sua() returns trigger language plpgsql as $fn$
begin raise exception 'su_kien_quet là SỔ QUÉT append-only — CẤM % (chỉ INSERT). Dọn demo: xoa_demo để LẠI log (QD-46 ''0 tác động''/QD-18/QD-44).', tg_op; end $fn$;
create trigger sq_chan_sua before update or delete on kho.su_kien_quet for each row execute function kho.sq_chan_sua();

do $$ begin
  if to_regprocedure('kho.sq_chan_sua()') is null then raise exception 'THIẾU sq_chan_sua'; end if;
  raise notice 'db/197 OK: su_kien_quet có răng · xoa_demo thôi xoá su_kien_quet · dung_lai_tien_do bỏ tem mồ côi.';
end $$;
commit;
