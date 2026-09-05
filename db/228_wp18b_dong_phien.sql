-- db/228 · WP-18b(3) L-20 · dong_phien — NỬA CÒN THIẾU của cặp mo_phien/dong_phien.
--   Lý do: chưa có đường NGHIỆP VỤ đóng phiên trạm (chỉ mo_phien đóng-khi-mở-mới; UI chỉ "Không phải tôi"
--   = nhượng, vẫn để mở). Robot (C) cần đóng phiên cuối vòng để "phiên treo=0" mà KHÔNG ghi thẳng bảng.
--   Guard KHỚP mo_phien: thợ đóng phiên CỦA MÌNH; đóng HỘ người khác chỉ quản đốc (xuong/ceo).
-- KHÔNG QD mới (chỉ hoàn thiện primitive đối xứng); nối dây ở QD-106 (mo_phien HỘ).

create or replace function kho.dong_phien(p_tram text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'kho'
as $function$
declare v_cur record; v_ten text; v_caller uuid; v_ho boolean;
begin
  perform kho.tram_gac_vai();                    -- người vận hành trạm: tho/xuong/ceo
  v_caller := kho.current_ns();
  if not exists (select 1 from kho.tram where ma_tram = p_tram) then
    raise exception 'dong_phien: trạm "%" không có trong hệ', p_tram;
  end if;
  select id, nguoi_id into v_cur from kho.phien_tram where ma_tram = p_tram and ket_thuc is null limit 1;
  if v_cur.id is null then
    return jsonb_build_object('da_dong', false, 'ly_do', 'không có phiên đang mở', 'tram', p_tram);
  end if;
  v_ho := (v_cur.nguoi_id is distinct from v_caller);   -- đóng phiên NGƯỜI KHÁC = đóng hộ
  if v_ho and coalesce(kho.current_vai_tro(),'') not in ('xuong','ceo') then
    raise exception 'dong_phien: đóng phiên HỘ người khác chỉ quản đốc (xuong/ceo) — vai "%"',
      coalesce(nullif(kho.current_vai_tro(),''),'(chưa đăng nhập)');
  end if;
  update kho.phien_tram set ket_thuc = now() where id = v_cur.id;
  select ho_ten into v_ten from kho.nguoi_dung where id = v_cur.nguoi_id;
  return jsonb_build_object('da_dong', true, 'tram', p_tram, 'nguoi_id', v_cur.nguoi_id, 'nguoi', v_ten);
end $function$;

grant execute on function kho.dong_phien(text) to authenticated;
