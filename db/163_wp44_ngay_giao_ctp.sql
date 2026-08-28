-- db/163 (WP-44 L-24) — NGÀY GIAO HỨA theo CTP (ERP 5.4.3): ATP(tải) + thiếu vật tư + lead mua.
--   atp() chỉ tính NĂNG LỰC (không đọc vật tư). ngay_giao_hua GỘP: muộn hơn giữa (đủ vật tư) và (tải).
--   KHÔNG chép phép xếp — atp()/neo_xuoi() làm nguồn bên trong. Tôn trọng vung_cua_tuan + khoa_lich_luc.
begin;

-- ■1 · THAM SỐ (không viết cứng). moc_lich đơn vị TUẦN không hợp ngày; tham_so_tai_chinh là bảng
--   tài chính rộng theo kỳ. → bảng tham số VẬN HÀNH key-value chung, đơn vị NGÀY rõ ràng.
create table if not exists kho.tham_so_van_hanh (
  ma text primary key,
  gia_tri numeric not null,
  don_vi text,
  ghi_chu text,
  sua_luc timestamptz default now()
);
insert into kho.tham_so_van_hanh(ma, gia_tri, don_vi, ghi_chu)
  values ('lead_mac_dinh', 7, 'ngay', '[TẠM] lead mua mặc định khi vật tư chưa có giá NCC — CEO đổi 1 chỗ')
  on conflict (ma) do nothing;
grant select on kho.tham_so_van_hanh to authenticated;

-- ■2/■3 · RPC ngay_giao_hua
create or replace function kho.ngay_giao_hua(p_ma_don text) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $function$
declare
  v_vai text; v_don kho.don_hang; v_kho uuid; v_lead_mac int;
  v_moc text; v_moc_nhan text;
  v_ngay_vat_tu date := current_date;     -- ngày đủ vật tư (mặc định = hôm nay = đã đủ)
  v_atp jsonb; v_ngay_tai date; v_ngay_hua date;
  v_can_cu jsonb := '[]'::jsonb; v_doan jsonb := '[]'::jsonb; v_gd jsonb := '[]'::jsonb;
  v_tong_vt int := 0; v_so_doan int := 0;
  r record; v_kd numeric; v_kdpo numeric; v_lead int; v_ncc_hen date; v_ngay date;
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
  if exists (select 1 from kho.nang_luc_to where den_ngay is null and xac_nhan = false) then
    v_gd := v_gd || to_jsonb('năng lực tổ chưa ai xác nhận (đang dùng số đặt tạm)'::text); end if;
  if exists (select 1 from kho.nang_luc_to where den_ngay is null and he_so_huu_ich <> 1) then
    v_gd := v_gd || to_jsonb('hệ số hữu ích năng lực đang là số đặt tạm'::text); end if;

  return jsonb_build_object(
    'ok', true, 'ma_don', p_ma_don, 'ngay_hua', v_ngay_hua,
    'do_tin', case when jsonb_array_length(v_gd) = 0 then 'cao' else 'uoc' end,
    'moc_bom', v_moc, 'nhan_moc', v_moc_nhan,
    'can_cu', v_can_cu,
    'vat_tu_dang_doan', v_doan,
    'so_vat_tu_dang_doan', v_so_doan, 'tong_vat_tu_can', v_tong_vt,
    'cac_gia_dinh', v_gd,
    'ngay_theo_vat_tu', v_ngay_vat_tu, 'ngay_theo_tai', v_ngay_tai);
end $function$;
grant execute on function kho.ngay_giao_hua(text) to authenticated;

commit;
-- HOÀN TÁC: drop function kho.ngay_giao_hua(text); drop table kho.tham_so_van_hanh;
