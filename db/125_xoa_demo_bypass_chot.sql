-- 125 — xoa_demo XOÁ ĐƯỢC đơn demo ĐÃ CHỐT (D8/WP-04): trigger MOC_CHUAN_DA_CHOT bỏ qua CHỈ khi GUC bật + demo.
--   GỐC: chan_sua_moc_chot (db/070) chặn CỨNG xoá số chuẩn đã chốt → xoa_demo không xoá nổi đơn đã bàn giao
--   (D6/L-66 phải TẮT trigger tay — nguy hiểm). Nay: xoa_demo đặt GUC set_config('kho.xoa_demo','1',true) TRONG tx;
--   trigger bỏ qua CHỈ khi GUC='1' VÀ dòng thuộc đơn la_demo=true. Đơn THẬT vẫn CHẶN kể cả khi GUC (không có đường bật GUC ngoài xoa_demo).
--   IDEMPOTENT: create or replace cả 2. HOÀN TÁC: chạy lại db/070 (trigger) + db/120 (xoa_demo).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ 1 · trigger: bypass CÓ ĐIỀU KIỆN ═══════════
create or replace function kho.chan_sua_moc_chot() returns trigger
  language plpgsql set search_path = kho as $$
declare v_demo boolean;
begin
  if tg_op = 'DELETE' then
    if old.moc = 'chuan' and old.chot_luc is not null then
      -- D8: cho xoá số chốt CHỈ khi xoa_demo đang chạy (GUC) VÀ đơn của món là demo. Đơn thật → luôn CHẶN.
      if current_setting('kho.xoa_demo', true) = '1' then
        select d.la_demo into v_demo from kho.don_hang_mon m join kho.don_hang d on d.id = m.don_id where m.id = old.mon_id;
        if coalesce(v_demo, false) then return old; end if;
      end if;
      raise exception 'MOC_CHUAN_DA_CHOT: số chuẩn của món đã chốt (bàn giao xuống xưởng) — không xoá được'; end if;
    return old;
  end if;
  -- UPDATE: chỉ chặn khi dòng ĐÃ chốt (giữ nguyên db/070; hành động CHỐT null→now vẫn cho).
  if old.moc = 'chuan' and old.chot_luc is not null then
    raise exception 'MOC_CHUAN_DA_CHOT: số chuẩn của món "%" đã chốt — không sửa được nữa', old.mon_id; end if;
  return new;
end $$;

-- ═══════════ 2 · xoa_demo: ĐẶT GUC trong tx (thêm 1 dòng set_config, thân còn lại như db/120) ═══════════
create or replace function kho.xoa_demo(p_ma_don text default null, p_xac_nhan text default null)
  returns jsonb language plpgsql security definer set search_path = kho, public as $$
declare v_targets text[]; v_ids uuid[]; r jsonb := '{}'::jsonb; n int;
  v_global boolean := (p_ma_don is null);
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

  delete from kho.su_kien_quet where tem_ma in (select tem_ma from kho.tien_do_tem where ma_don = any(v_targets)); get diagnostics n = row_count; r := r || jsonb_build_object('su_kien_quet', n);
  delete from kho.tien_do_tem where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tien_do_tem', n);
  delete from kho.tem_da_in where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tem_da_in', n);
  delete from kho.lan_in_tem where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('lan_in_tem', n);
  delete from kho.don_hang_mon_nhat_ky where don_id = any(v_ids); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang_mon_nhat_ky', n);
  update kho.phieu set ma_don = null where ma_don = any(v_targets);
  -- D8: xoá SỐ CHỐT của món demo TRƯỚC khi xoá don_hang — lúc này don_hang/don_hang_mon CÒN → trigger tra la_demo=true
  --   → bypass. Nếu để CASCADE (don_hang→don_hang_mon→so_don_vi_mon) thì khi trigger chạy parent đã bị xoá,
  --   join la_demo=NULL → CHẶN. Bypass CHỈ áp cho món của đơn demo (GUC đã bật ở trên).
  delete from kho.so_don_vi_mon where mon_id in (select id from kho.don_hang_mon where don_id = any(v_ids)); get diagnostics n = row_count; r := r || jsonb_build_object('so_don_vi_mon', n);
  delete from kho.don_hang where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang', n);
  delete from kho.khach where la_demo = true and sdt not in (select sdt_khach from kho.don_hang where sdt_khach is not null); get diagnostics n = row_count; r := r || jsonb_build_object('khach', n);
  if v_global then
    delete from kho.phieu_dem_ngay where la_demo = true; get diagnostics n = row_count; r := r || jsonb_build_object('phieu_dem_ngay', n);
  end if;
  return jsonb_build_object('ok', true, 'pham_vi', case when v_global then 'TOAN_BO' else p_ma_don end, 'xoa', r);
end $$;
grant execute on function kho.xoa_demo(text,text) to authenticated;

commit;
