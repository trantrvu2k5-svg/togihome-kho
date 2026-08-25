-- 147 — WP-37 tầng 1b: bịt nốt đường đẩy plugin (QD-63 bổ sung).
--   1a · ghi_san_luong_don: +tk_ban_hang (12-driver tổng, san_luong_don — KHÔNG mốc, ghi đè).
--        bom_ma_kho_ds (db/145) ĐÃ có tk_ban_hang · quy_doi_export (db/145) plugin gọi ANON → cả hai ĐÃ THÔNG, KHÔNG đụng.
--   1b · day_tem_ban_ve: GIỮ KHOÁ + thêm chặn RÕ đơn bao_gia* (tem chỉ phát lúc SX, QD-47/ERP ch.6 estimate≠job card).
--   ⚠ CHẠY QUA: cd web && node ops/run_sql.mjs ../db/147_wp37_vai_plugin.sql   (cổng backup QD-61)
--   IDEMPOTENT: create or replace (chữ ký GIỮ NGUYÊN cả 2 hàm → không cần drop). Chạy lại vô hại.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;  -- chạy lại db/038 (ghi_san_luong_don bản cũ) + db/123 (day_tem_ban_ve bản cũ) để phục hồi guard.  commit;
-- ═══════════════════════════════

begin;

-- ═══════════ 1a · ghi_san_luong_don — +tk_ban_hang (chữ ký giữ nguyên) ═══════════
--   Ghi san_luong_don (12 cột driver, KHÔNG cột moc, on conflict ma_don do update = ghi đè). KHÔNG chạm trang_thai.
create or replace function kho.ghi_san_luong_don(p_ma_don text, p_drv jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke','tk_ban_hang') then
    raise exception 'ghi_san_luong_don: chỉ ceo/kho/thiet_ke/tk_ban_hang'; end if;
  if not exists (select 1 from kho.don_hang d where d.ma_don = p_ma_don) then raise exception 'ghi_san_luong_don: không có đơn "%"', p_ma_don; end if;
  insert into kho.san_luong_don(ma_don,cat,dan,cam,lot,pu,cup,thung,ray,canh,goi,son_canh,giuong_lap,ghi_luc)
    values(p_ma_don,(p_drv->>'cat')::numeric,(p_drv->>'dan')::numeric,(p_drv->>'cam')::numeric,(p_drv->>'lot')::numeric,
      (p_drv->>'pu')::numeric,(p_drv->>'cup')::numeric,(p_drv->>'thung')::numeric,(p_drv->>'ray')::numeric,
      (p_drv->>'canh')::numeric,(p_drv->>'goi')::numeric,(p_drv->>'son_canh')::numeric,(p_drv->>'giuong_lap')::numeric, now())
  on conflict (ma_don) do update set cat=excluded.cat,dan=excluded.dan,cam=excluded.cam,lot=excluded.lot,pu=excluded.pu,
    cup=excluded.cup,thung=excluded.thung,ray=excluded.ray,canh=excluded.canh,goi=excluded.goi,son_canh=excluded.son_canh,
    giuong_lap=excluded.giuong_lap,ghi_luc=now();
  return jsonb_build_object('ok',true,'ma_don',p_ma_don);
end $$;
grant execute on function kho.ghi_san_luong_don(text, jsonb) to authenticated;

-- ═══════════ 1b · day_tem_ban_ve — GIỮ KHOÁ + chặn RÕ bao_gia* (chữ ký giữ nguyên) ═══════════
create or replace function kho.day_tem_ban_ve(p_ma_don text, p_tam jsonb)
  returns jsonb language plpgsql security definer set search_path to 'kho'
as $function$
declare v_pb integer; t jsonb; v_don kho.don_hang; v_le_mau_san boolean; v_vai text; v_ten text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai = 'tk_ban_hang' then
    raise exception 'day_tem_ban_ve: thiết kế bán hàng không xuất file cắt (chỉ dựng 3D cho khách)';
  end if;
  if v_vai not in ('ceo','kho','thiet_ke') then
    raise exception 'day_tem_ban_ve: chỉ ceo/kho/thiết kế sản xuất';
  end if;
  select * into v_don from kho.don_hang d where d.ma_don = p_ma_don;
  if v_don.ma_don is null then
    raise exception 'day_tem_ban_ve: không có đơn "%"', p_ma_don;
  end if;
  -- [WP-37/QD-63] TEM KHÔNG PHÁT Ở BÁO GIÁ (estimate ≠ job/route card — ERP ch.6 · QD-47). Chặn cố ý, rõ ràng.
  if v_don.trang_thai in ('bao_gia','bao_gia_treo','bao_gia_thua') then
    raise exception 'day_tem_ban_ve: đơn "%" đang BÁO GIÁ — tem chỉ phát lúc sản xuất (QD-47), không ở báo giá', p_ma_don;
  end if;

  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then
      raise exception 'day_tem_ban_ve: đơn "%" CHƯA AI NHẬN việc thiết kế — nhận việc trước khi đẩy tem', p_ma_don;
    end if;
    if v_don.ma_ns_thiet_ke <> kho.current_ns() then
      select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
      raise exception 'day_tem_ban_ve: đơn "%" đang do % cầm — chỉ người cầm mới đẩy tem', p_ma_don, coalesce(v_ten,'người khác');
    end if;
  end if;

  -- [CỔNG KHOÁ CẮT] — không cắt ván khi khách chưa duyệt bản thiết kế (trừ đơn le mẫu sẵn).
  v_le_mau_san := (v_don.dong = 'le'
                   and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau_san
     and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'day_tem_ban_ve: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT — chưa được cắt ván.', p_ma_don;
  end if;

  select coalesce(max(phien_ban),0)+1 into v_pb from kho.tem_ban_ve where ma_don = p_ma_don;
  for t in select * from jsonb_array_elements(p_tam) loop
    insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,duong_dan_svg)
      values(p_ma_don, v_pb, t->>'ma_tam', t->>'vai_tro',
             (t->>'dai')::numeric, (t->>'rong')::numeric, (t->>'day')::numeric,
             coalesce(t->'canh_dan','[]'::jsonb), (t->>'kien')::int,
             p_ma_don||'/'||v_pb||'/'||replace(replace(t->>'ma_tam','|','_'),'#','_')||'.svg');
  end loop;

  update kho.don_hang set buoc_thiet_ke = 'xong_file' where ma_don = p_ma_don;

  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'phien_ban',v_pb,
                            'so_tam',jsonb_array_length(p_tam),'vao_chuyen',false);
end $function$;

commit;
