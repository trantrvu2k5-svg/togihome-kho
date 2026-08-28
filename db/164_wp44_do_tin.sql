-- db/164 (WP-44 L-27) — SỬA NHÃN ĐỘ TIN. Tách hai loại: giả-định-SỬA-ĐƯỢC (kéo 'uoc') vs cách-tính (luôn đúng).
--   BỎ he_so_huu_ich≠1 khỏi cac_gia_dinh: hệ số hữu ích là TÍNH CHẤT của phép ước năng lực (mọi tổ 0,88 cố hữu),
--   không phải thiếu sót dữ liệu; gộp vào giả định thì 'cao' vĩnh viễn không đạt → nhãn thành trang trí.
--   Chuyển 0,88 sang trường mới cach_tinh (vẫn hiện cho người đọc, không làm nhiễu nhãn).
--   Điều kiện ③ (năng lực chưa xác nhận) đổi TOÀN CỤC → THEO ĐƠN: chỉ tổ đơn này dùng, nêu đúng tên tổ.
begin;

CREATE OR REPLACE FUNCTION kho.ngay_giao_hua(p_ma_don text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare
  v_vai text; v_don kho.don_hang; v_kho uuid; v_lead_mac int;
  v_moc text; v_moc_nhan text;
  v_ngay_vat_tu date := current_date;     -- ngày đủ vật tư (mặc định = hôm nay = đã đủ)
  v_atp jsonb; v_ngay_tai date; v_ngay_hua date;
  v_can_cu jsonb := '[]'::jsonb; v_doan jsonb := '[]'::jsonb; v_gd jsonb := '[]'::jsonb;
  v_tong_vt int := 0; v_so_doan int := 0;
  r record; v_kd numeric; v_kdpo numeric; v_lead int; v_ncc_hen date; v_ngay date;
  v_to_don text[]; v_to_chua_ten text; v_heso_txt text; v_cach_tinh jsonb := '[]'::jsonb;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','xuong','ke_toan','sale','thiet_ke','tk_ban_hang') then
    raise exception 'ngay_giao_hua: vai không xem được'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'ngay_giao_hua: đơn không tồn tại "%"', p_ma_don; end if;
  select id into v_kho from kho.kho where la_mac_dinh limit 1;
  v_lead_mac := coalesce((select gia_tri from kho.tham_so_van_hanh where ma='lead_mac_dinh'),7)::int;

  -- mốc BOM: chuẩn nếu có, không thì dự kiến
  if exists (select 1 from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id=b.mon_id
             where m.don_id=v_don.id and b.moc='chuan')
    then v_moc := 'chuan'; else v_moc := 'du_kien'; end if;
  v_moc_nhan := case v_moc when 'chuan' then 'theo BOM chuẩn' else 'ước theo BOM dự kiến' end;

  -- ═ ■2a VẬT TƯ: gộp nhu cầu per vật tư, so v_ton_kha_dung ═
  for r in
    select b.vat_tu_id, max(v.ten) ten, sum(b.so_luong_co_so) can
    from kho.bom_don_ds(v_don.id, v_moc) b join kho.vat_tu v on v.id = b.vat_tu_id
    where b.vat_tu_id is not null and b.so_luong_co_so is not null
    group by b.vat_tu_id
  loop
    v_tong_vt := v_tong_vt + 1;
    select coalesce(kha_dung,0), coalesce(kha_dung_ke_ca_po,0) into v_kd, v_kdpo
      from kho.v_ton_kha_dung where vat_tu_id=r.vat_tu_id and kho_id=v_kho;
    v_kd := coalesce(v_kd,0); v_kdpo := coalesce(v_kdpo,0);
    if r.can <= v_kd then
      continue;                                   -- đủ tồn, không ràng buộc ngày
    elsif r.can <= v_kdpo then
      -- PO đang về đủ bù → lấy ngày NCC hẹn muộn nhất của lô đang về
      select max(d.ngay_ncc_hen) into v_ncc_hen
        from kho.don_mua_dong dd join kho.don_mua d on d.id=dd.don_mua_id
        where dd.vat_tu_id=r.vat_tu_id and d.kho_id=v_kho and d.trang_thai in ('da_gui','xac_nhan');
      v_ngay := coalesce(v_ncc_hen, current_date + v_lead_mac);
      v_can_cu := v_can_cu || to_jsonb('chờ ' || r.ten || ' theo lô đang về (dự kiến ' || to_char(v_ngay,'DD/MM') || ')');
    else
      -- thiếu cả khi kể PO → mua mới. Lead LỚN NHẤT (hứa chậm hơn hứa hụt); không có gia_ncc → lead mặc định + ĐÁNH DẤU đoán
      select max(lead_time_ngay) into v_lead from kho.gia_ncc where vat_tu_id=r.vat_tu_id;
      if v_lead is null then
        v_lead := v_lead_mac; v_so_doan := v_so_doan + 1; v_doan := v_doan || to_jsonb(r.ten);
        v_can_cu := v_can_cu || to_jsonb('chờ ' || r.ten || ' về (mua mới, lead mặc định ' || v_lead || ' ngày — CHƯA có giá NCC)');
      else
        v_can_cu := v_can_cu || to_jsonb('chờ ' || r.ten || ' về (mua mới, lead ' || v_lead || ' ngày)');
      end if;
      v_ngay := current_date + v_lead;
    end if;
    if v_ngay > v_ngay_vat_tu then v_ngay_vat_tu := v_ngay; end if;
  end loop;

  -- ═ ■2b NĂNG LỰC: atp() làm NGUỒN bên trong (không viết lại phép xếp; neo_xuoi bên trong _sched) ═
  v_atp := kho.atp(p_ma_don, v_moc);
  if (v_atp->>'ok')::boolean is true and (v_atp->>'ngay_hua_duoc') is not null then
    v_ngay_tai := (v_atp->>'ngay_hua_duoc')::date;
    if v_atp->'nut_that' is not null and v_atp->'nut_that' <> 'null'::jsonb then
      v_can_cu := v_can_cu || to_jsonb('tổ ' || coalesce(v_atp->'nut_that'->>'ma_to','?') || ' là chỗ nghẽn tải');
    else
      v_can_cu := v_can_cu || to_jsonb('xưởng làm nổi theo tải, không tổ nào nghẽn'::text);
    end if;
  else
    v_can_cu := v_can_cu || to_jsonb('chưa tính được ngày theo tải (' || coalesce(v_atp->>'loi','?') || ')');
    v_ngay_tai := null;
  end if;

  -- ═ ■2 ngày = MUỘN HƠN giữa vật tư và tải ═
  v_ngay_hua := greatest(v_ngay_vat_tu, coalesce(v_ngay_tai, v_ngay_vat_tu));

  -- ═ ■3 CÁC GIẢ ĐỊNH [TẠM] — đọc ĐỘNG ═
  if v_moc = 'du_kien' then v_gd := v_gd || to_jsonb('BOM dự kiến (chưa chốt số cắt thật)'::text); end if;
  if v_so_doan > 0 then v_gd := v_gd || to_jsonb('lead mặc định ' || v_lead_mac || ' ngày cho ' || v_so_doan || ' vật tư chưa có giá NCC'); end if;
  -- [db/164] TỔ ĐƠN NÀY DÙNG — lấy từ LỊCH atp đã trả về (ma_to mỗi bước) — dùng cho ③ (theo đơn) + cách tính
  select coalesce(array_agg(distinct e->>'ma_to'), '{}') into v_to_don
  from jsonb_array_elements(coalesce(v_atp->'lich', '[]'::jsonb)) e
  where e->>'ma_to' is not null;
  -- ③ THEO ĐƠN (db/164): chỉ tổ đơn NÀY dùng mà chưa ai xác nhận → kéo 'uoc', nêu ĐÚNG TÊN tổ
  select string_agg(distinct coalesce(ts.ten, nt.ma_to), ', ') into v_to_chua_ten
  from kho.nang_luc_to nt left join kho.to_san_xuat ts on ts.ma_to = nt.ma_to
  where nt.den_ngay is null and nt.xac_nhan = false and nt.ma_to = any(v_to_don);
  if v_to_chua_ten is not null then
    v_gd := v_gd || to_jsonb('tổ ' || v_to_chua_ten || ' chưa ai xác nhận năng lực');
  end if;
  -- [db/164] ④ he_so_huu_ich BỎ khỏi giả định: hệ số hữu ích là TÍNH CHẤT của phép ước năng lực,
  --   KHÔNG phải thiếu sót dữ liệu. Gộp nó vào giả định thì 'cao' vĩnh viễn không đạt (mọi tổ 0,88 cố hữu)
  --   → nhãn thành trang trí. Chuyển sang cach_tinh (luôn hiện, KHÔNG kéo do_tin).
  select string_agg(distinct replace(to_char(nt.he_so_huu_ich,'FM0.00'), '.', ','), ', ') into v_heso_txt
  from kho.nang_luc_to nt where nt.den_ngay is null and nt.ma_to = any(v_to_don);
  v_cach_tinh := jsonb_build_array(('năng lực tính theo hệ số hữu ích ' || coalesce(v_heso_txt, '?'))::text);

  return jsonb_build_object(
    'ok', true, 'ma_don', p_ma_don, 'ngay_hua', v_ngay_hua,
    'do_tin', case when jsonb_array_length(v_gd) = 0 then 'cao' else 'uoc' end,
    'moc_bom', v_moc, 'nhan_moc', v_moc_nhan,
    'can_cu', v_can_cu,
    'vat_tu_dang_doan', v_doan,
    'so_vat_tu_dang_doan', v_so_doan, 'tong_vat_tu_can', v_tong_vt,
    'cac_gia_dinh', v_gd, 'cach_tinh', v_cach_tinh,
    'ngay_theo_vat_tu', v_ngay_vat_tu, 'ngay_theo_tai', v_ngay_tai);
end $function$
;

commit;
-- HOÀN TÁC: chạy lại db/163 (ngay_giao_hua bản cũ).
