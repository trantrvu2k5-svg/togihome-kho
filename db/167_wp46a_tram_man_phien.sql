-- db/167 (WP-46a L-35) — tram_man TRẢ THÊM phiên thợ HÔM NAY (để trạm quét hiện "ai đang làm").
--   Chỉ THÊM 3 field (co_phien/phien_nguoi_id/phien_ho_ten); ca_lam fields giữ nguyên (chấm công).
begin;

CREATE OR REPLACE FUNCTION kho.tram_man(p_tram text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v jsonb; v_ca record; v_ten_nguoi text; v_ph record; v_ph_ten text;
begin
  perform kho.tram_gac_vai();
  select nguoi_id, bat_dau into v_ca from kho.ca_lam where ma_tram = p_tram and ket_thuc is null order by bat_dau desc limit 1;
  if v_ca.nguoi_id is not null then select ho_ten into v_ten_nguoi from kho.nguoi_dung where id = v_ca.nguoi_id; end if;
  -- phiên thợ HÔM NAY (nguồn "ai làm" — WP-46a)
  select nguoi_id into v_ph from kho.phien_tram
    where ma_tram = p_tram and ket_thuc is null and bat_dau::date = current_date limit 1;
  if v_ph.nguoi_id is not null then select ho_ten into v_ph_ten from kho.nguoi_dung where id = v_ph.nguoi_id; end if;
  select jsonb_build_object(
    'ma_tram', t.ma_tram, 'ten', t.ten, 'hoat_dong', t.hoat_dong,
    'hd_ten', coalesce(d.ten, t.hoat_dong), 'dang_dung', t.dang_dung,
    'co_ca', (v_ca.nguoi_id is not null), 'nguoi_truc', v_ten_nguoi,
    'co_phien', (v_ph.nguoi_id is not null), 'phien_nguoi_id', v_ph.nguoi_id, 'phien_ho_ten', v_ph_ten,
    'trang_thai', coalesce(kho.sq_tram_trang_thai(p_tram), 'chay'))
    into v from kho.tram t left join kho.don_gia_baseline d on d.hoat_dong = t.hoat_dong
    where t.ma_tram = p_tram;
  return coalesce(v, jsonb_build_object('ma_tram', p_tram, 'khong_co', true));
end $function$;

commit;
