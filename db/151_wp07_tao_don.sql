-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 151 — WP-07 (QD-67): RPC kho.tao_don — MỘT cửa TẠO đơn. Đơn LUÔN khởi tạo ở 'bao_gia'.
--   Nay client Sale INSERT don_hang KÈM trang_thai (bao_gia | moi_len_don) — lỗ TẠO còn hở sau WP-06.
--   ERP 5.5.1 (báo giá = đơn CHƯA validate; khách nhận → CHUYỂN thành order, không tạo mới ở order) +
--   5.3.3 (trạng thái là thứ HỆ ghi theo mức đã đi, không phải người nhập chọn).
--   → tao_don HARD-CODE trang_thai='bao_gia'; "+ Lên đơn" = tao_don(p_chot=true) → gọi CỔNG chot_don
--     (WP-06 db/148) trong CÙNG transaction. Đường vào moi_len_don vẫn CHỈ một cổng (QD-47/QD-64),
--     vẫn bị trg_kiem_chuyen_trang_thai ép nguon_khach + thuong_hieu.
--   KHÔNG đẻ đường ghi trạng thái thứ hai: hàm CẤM UPDATE trang_thai (chỉ INSERT bao_gia + chot_don).
--   REVOKE quyền INSERT cột trang_thai nằm ở L-134 (sau khi UI chuyển sang gọi tao_don) — KHÔNG ở đây.
--
--   HOÀN TÁC: drop function kho.tao_don(jsonb, boolean);
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists kho.tao_don(jsonb, boolean);
create function kho.tao_don(p_don jsonb, p_chot boolean default false)
  returns table(id uuid, ma_don text, trang_thai text)
  language plpgsql security definer set search_path = kho, public as $$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ma  text := nullif(btrim(p_don->>'ma_don'),'');
  v_id  uuid;
begin
  -- 1) VAI: chỉ sale/ceo (theo current_vai_tro → auth_uid, KHÔNG map nguoi_dung.id).
  if v_vai not in ('sale','ceo') then
    raise exception 'tao_don: chỉ sale/ceo được tạo đơn (vai "%")', v_vai; end if;
  -- 2) MÃ ĐƠN do client sinh (giữ nguyên cách sinh); RPC chỉ gác THIẾU + TRÙNG, lỗi rõ chữ, không nuốt.
  if v_ma is null then raise exception 'tao_don: thiếu ma_don'; end if;
  if exists (select 1 from kho.don_hang d where d.ma_don = v_ma) then
    raise exception 'tao_don: mã đơn "%" đã tồn tại — không tạo trùng', v_ma; end if;
  -- 3) INSERT: trang_thai HARD-CODE 'bao_gia'. Nhận đúng bộ trường client gửi (donToRow) TRỪ trang_thai.
  --    nguoi_tao: server tự gán current_ns() (không tin client). Trigger BEFORE INSERT (gan_sale_phu_trach,
  --    moc_bao_gia, dong_bo_khach, giu_hen_ban_dau, kiem_chuyen…) vẫn chạy như thường.
  insert into kho.don_hang(
    ma_don, trang_thai,
    ngay_chot, thuong_hieu, sdt_khach, ten_khach, tinh_khach, dia_chi_khach,
    dong, loai, chiet_khau, gia_cong_thuc, gia_chot, ma_ns_duyet_giam, ly_do_giam,
    ly_do_huy, ly_do_thua, ghi_chu_thua, tk_coc, tien_coc, so_tien_thuc_thu,
    lap_ai, file_tk, gio_thiet_ke, nguoi_tk, don_vi_van_chuyen, khoi_luong_kg, dia_ban,
    ship_thuc_tra, lap_thuc_tra, ngay_di_hang, ngay_giao, ngay_du_kien, ngay_hen_khach,
    lo, ghi_chu, link, phong_cach, ngan_sach_trieu, tu_dung, nguon_khach,
    kgs, hoa_don, nguoi_tao)
  values(
    v_ma, 'bao_gia',
    nullif(p_don->>'ngay_chot','')::date, nullif(btrim(p_don->>'thuong_hieu'),''),
      nullif(btrim(p_don->>'sdt_khach'),''), nullif(btrim(p_don->>'ten_khach'),''),
      nullif(btrim(p_don->>'tinh_khach'),''), nullif(btrim(p_don->>'dia_chi_khach'),''),
    nullif(btrim(p_don->>'dong'),''), nullif(btrim(p_don->>'loai'),''),
      nullif(p_don->>'chiet_khau','')::numeric, nullif(p_don->>'gia_cong_thuc','')::numeric,
      nullif(p_don->>'gia_chot','')::numeric, nullif(btrim(p_don->>'ma_ns_duyet_giam'),''),
      nullif(btrim(p_don->>'ly_do_giam'),''),
    nullif(btrim(p_don->>'ly_do_huy'),''), nullif(btrim(p_don->>'ly_do_thua'),''),
      nullif(btrim(p_don->>'ghi_chu_thua'),''), nullif(btrim(p_don->>'tk_coc'),''),
      nullif(p_don->>'tien_coc','')::numeric, nullif(p_don->>'so_tien_thuc_thu','')::numeric,
    nullif(btrim(p_don->>'lap_ai'),''), nullif(btrim(p_don->>'file_tk'),''),
      nullif(p_don->>'gio_thiet_ke','')::numeric, nullif(btrim(p_don->>'nguoi_tk'),''),
      nullif(btrim(p_don->>'don_vi_van_chuyen'),''), nullif(p_don->>'khoi_luong_kg','')::numeric,
      nullif(btrim(p_don->>'dia_ban'),''),
    nullif(p_don->>'ship_thuc_tra','')::numeric, nullif(p_don->>'lap_thuc_tra','')::numeric,
      nullif(p_don->>'ngay_di_hang','')::date, nullif(p_don->>'ngay_giao','')::date,
      nullif(p_don->>'ngay_du_kien','')::date, nullif(p_don->>'ngay_hen_khach','')::date,
    nullif(btrim(p_don->>'lo'),''), nullif(btrim(p_don->>'ghi_chu'),''),
      nullif(btrim(p_don->>'link'),''), nullif(btrim(p_don->>'phong_cach'),''),
      nullif(p_don->>'ngan_sach_trieu','')::numeric, coalesce((p_don->>'tu_dung')::boolean, false),
      nullif(btrim(p_don->>'nguon_khach'),''),
    case when jsonb_typeof(p_don->'kgs') = 'array'
         then array(select jsonb_array_elements_text(p_don->'kgs')) end,
    case when jsonb_typeof(p_don->'hoa_don') in ('object','array') then p_don->'hoa_don' end,
    coalesce(nullif(p_don->>'nguoi_tao','')::uuid, kho.current_ns()))
  returning don_hang.id into v_id;
  -- 4) CHỐT tuỳ chọn — CÙNG transaction. chot_don (db/148) RAISE (thiếu nguồn/thương hiệu, món giá…) thì
  --    exception nổi ra khỏi tao_don → cả INSERT rollback theo (không để đơn cụt). KHÔNG bọc EXCEPTION.
  if p_chot then
    perform kho.chot_don(v_id, nullif(btrim(p_don->>'nguon_khach'),''), nullif(btrim(p_don->>'thuong_hieu'),''));
  end if;
  -- 5) trả id + ma_don + trạng thái CUỐI (bao_gia nếu không chốt, moi_len_don nếu chốt).
  return query select d.id, d.ma_don, d.trang_thai from kho.don_hang d where d.id = v_id;
end $$;
grant execute on function kho.tao_don(jsonb, boolean) to authenticated;

commit;
