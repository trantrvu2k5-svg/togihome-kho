-- 141 — WP-42 (QD-60) tầng DB bổ sung: đường GHI cho UI Cần đặt hàng.
--   A · dat_muc_ton: đặt mức min/max theo mã (kho gõ tay).
--   B · tao_po_tu_canh_bao: tạo PO NHÁP từ cảnh báo — GOM theo NCC, đối chiếu gia_ncc, BỌC dm_tao (WP-20).
--   IDEMPOTENT (create or replace). HOÀN TÁC: drop function kho.dat_muc_ton(uuid,numeric,numeric),
--     kho.tao_po_tu_canh_bao(jsonb);
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ A · dat_muc_ton — đặt mức tồn tối thiểu / đặt-lên-tới ═══════════
-- SECURITY DEFINER + kiểm vai TRONG hàm (né allowlist cột db/131/138). RAISE tiếng Việt trước UPDATE
-- (CHECK bảng db/139 vẫn là chốt chặn cuối). p_min=0 HỢP LỆ (kho gõ 0 tường minh = không cần dự trữ, CEO 23/08).
create or replace function kho.dat_muc_ton(p_vat_tu_id uuid, p_min numeric, p_max numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_row kho.vat_tu;
begin
  if v_vai not in ('kho','ceo') then raise exception 'dat_muc_ton: chỉ kho/ceo'; end if;
  if p_vat_tu_id is null or not exists(select 1 from kho.vat_tu where id = p_vat_tu_id) then
    raise exception 'dat_muc_ton: vật tư không tồn tại'; end if;
  if p_min is not null and p_min < 0 then raise exception 'dat_muc_ton: mức tối thiểu không được âm'; end if;
  if p_max is not null and p_max < 0 then raise exception 'dat_muc_ton: mức đặt-lên-tới không được âm'; end if;
  if p_min is not null and p_max is not null and p_max < p_min then
    raise exception 'dat_muc_ton: mức đặt-lên-tới (%) phải >= mức tối thiểu (%)', p_max, p_min; end if;
  -- CHỈ đụng 2 cột mức
  update kho.vat_tu set ton_toi_thieu = p_min, muc_dat_len_toi = p_max where id = p_vat_tu_id returning * into v_row;
  return jsonb_build_object('ok', true, 'vat_tu_id', v_row.id, 'ma', v_row.ma,
    'ton_toi_thieu', v_row.ton_toi_thieu, 'muc_dat_len_toi', v_row.muc_dat_len_toi);
end $$;
grant execute on function kho.dat_muc_ton(uuid, numeric, numeric) to authenticated;

-- ═══════════ B · tao_po_tu_canh_bao — PO NHÁP từ cảnh báo (bọc dm_tao) ═══════════
-- p_dong = mảng {vat_tu_id, so_luong, ncc_id, don_gia}. GOM theo ncc_id → mỗi NCC 1 don_mua trạng thái 'moi'
-- (đầu chuỗi, db/126). Đơn giá phải KHỚP gia_ncc còn hiệu lực của đúng (NCC × vật tư) — lệch/thiếu → RAISE.
-- KHÔNG gửi NCC (p_gui_ngay=false) — chỉ nháp, kho sửa/gửi ở tab Đơn mua. Tạo THẬT qua dm_tao (không nhân bản logic).
create or replace function kho.tao_po_tu_canh_bao(p_dong jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); d jsonb; i int := 0;
  v_ncc uuid; v_vt uuid; v_sl numeric; v_dg numeric; v_gia numeric;
  v_kho uuid; v_res jsonb := '[]'::jsonb; grp record; v_r jsonb;
begin
  if v_vai not in ('kho','ceo') then raise exception 'tao_po_tu_canh_bao: chỉ kho/ceo'; end if;
  if p_dong is null or jsonb_typeof(p_dong) <> 'array' or jsonb_array_length(p_dong) = 0 then
    raise exception 'tao_po_tu_canh_bao: cần ít nhất một dòng'; end if;
  v_kho := (select id from kho.kho where la_mac_dinh limit 1);

  -- (1) validate TỪNG dòng trước khi tạo bất cứ gì (all-or-nothing)
  for d in select * from jsonb_array_elements(p_dong) loop
    i := i + 1;
    v_ncc := nullif(d->>'ncc_id','')::uuid;
    v_vt  := nullif(d->>'vat_tu_id','')::uuid;
    v_sl  := nullif(d->>'so_luong','')::numeric;
    v_dg  := nullif(d->>'don_gia','')::numeric;
    if v_ncc is null then raise exception 'dòng % — thiếu ncc_id (chưa có NCC để đặt hàng)', i; end if;
    if not exists(select 1 from kho.nha_cung_cap where id = v_ncc) then raise exception 'dòng % — NCC không hợp lệ', i; end if;
    if v_vt is null or not exists(select 1 from kho.vat_tu where id = v_vt) then raise exception 'dòng % — vật tư không hợp lệ', i; end if;
    if v_sl is null or v_sl <= 0 then raise exception 'dòng % — số lượng phải > 0', i; end if;
    -- đối chiếu gia_ncc còn hiệu lực (UNIQUE ncc×vật tư ở db/137)
    select don_gia into v_gia from kho.gia_ncc where ncc_id = v_ncc and vat_tu_id = v_vt and ap_dung_tu <= current_date;
    if v_gia is null then raise exception 'dòng % — NCC này chưa có giá còn hiệu lực cho vật tư', i; end if;
    if v_dg is null or v_dg <> v_gia then
      raise exception 'dòng % — đơn giá % lệch bảng giá NCC (giá hiện hành %)', i, coalesce(v_dg,0), v_gia; end if;
  end loop;

  -- (2) GOM theo ncc_id → mỗi NCC một dm_tao (đơn vị = cơ sở, giá đã đối chiếu)
  for grp in
    select (e->>'ncc_id')::uuid ncc,
      jsonb_agg(jsonb_build_object(
        'vat_tu_id', e->>'vat_tu_id',
        'so_luong', (e->>'so_luong')::numeric,
        'don_gia', (e->>'don_gia')::numeric,
        'don_vi', (select don_vi_co_so from kho.vat_tu where id = (e->>'vat_tu_id')::uuid))) dong
    from jsonb_array_elements(p_dong) e
    group by (e->>'ncc_id')::uuid
  loop
    v_r := kho.dm_tao(grp.ncc, v_kho, null, 'PO nháp từ cảnh báo đặt hàng (WP-42)', grp.dong, false);
    v_res := v_res || jsonb_build_object('ncc_id', grp.ncc, 'po_id', (v_r->>'id'), 'so_don', (v_r->>'so_don'));
  end loop;

  return jsonb_build_object('ok', true, 'so_po', jsonb_array_length(v_res), 'po', v_res);
end $$;
grant execute on function kho.tao_po_tu_canh_bao(jsonb) to authenticated;

commit;
