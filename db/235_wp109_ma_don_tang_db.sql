-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 235 — WP-109 D-1: MÃ ĐƠN cấp ở TẦNG DB (chat não D-1).
--   GỐC LỖI: client sinh ma_don = MAX(seq cùng tháng)+1 từ db.don LOCAL (togihome_sale.html L5144).
--   Hai sale lưu cùng lúc → cùng thấy seq cũ → sinh TRÙNG mã (họ lỗi WP-15b: mã sinh từ độ dài/седnội mảng).
--   Nay: tao_don(p_ma_don NULL) → DB tự cấp qua cap_so_phieu('DON') — cấp số ATOMIC (chuoi_so + UPDATE..RETURNING,
--   khoá dòng → hai phiên đồng thời nhận seq KHÁC nhau). KHÔNG max()+1, KHÔNG đếm dòng.
--
--   TÁI DÙNG cap_so_phieu (QD-02/03) — MỞ RỘNG chính nó (thêm nhánh 'DON'), KHÔNG đẻ hàm cấp số thứ hai.
--   Mã đơn reset theo THÁNG, format T{tháng}-{NNN}; tháng lấy theo Asia/Ho_Chi_Minh (QD-99), CẤM toISOString.
--
--   CHUYỂN TIẾP "DB nhận cả hai dạng" (06 §1c.1): p_ma_don khác NULL VẪN nhận (mã client cũ) tới khi UI lên;
--   SIẾT (từ chối p_ma_don) nằm ở db/236 — chạy SAU khi UI deploy + chạy đúng.
--
--   HOÀN TÁC: create or replace lại cap_so_phieu (bỏ nhánh DON) + drop function kho.tao_don rồi chạy lại db/151.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- 1) MỞ RỘNG cap_so_phieu: thêm nhánh 'DON' (reset THÁNG, T{m}-{NNN}). Nhánh cũ (năm, LOAI-YYYY-NNNN) GIỮ NGUYÊN.
create or replace function kho.cap_so_phieu(p_loai text) returns text
  language plpgsql set search_path = kho, public as $$
declare y int; th int; per int; n int;
begin
  if p_loai = 'DON' then
    -- MÃ ĐƠN HÀNG: reset theo THÁNG (giờ VN — QD-99). chuoi_so.nam = YYYYMM (khoá tháng) → mỗi tháng một bộ đếm.
    th  := extract(month from (now() at time zone 'Asia/Ho_Chi_Minh'));
    per := extract(year  from (now() at time zone 'Asia/Ho_Chi_Minh'))::int * 100 + th;   -- 202609
    insert into chuoi_so(loai, nam, so_hien_tai) values ('DON', per, 0)
      on conflict (loai, nam) do nothing;
    update chuoi_so set so_hien_tai = so_hien_tai + 1
      where loai = 'DON' and nam = per returning so_hien_tai into n;
    return 'T' || th || '-' || lpad(n::text, 3, '0');   -- T9-001
  end if;
  -- NHÁNH CŨ (năm) — byte-identical với db/001.
  y := extract(year from now());
  insert into chuoi_so(loai, nam, so_hien_tai) values (p_loai, y, 0)
    on conflict (loai, nam) do nothing;
  update chuoi_so set so_hien_tai = so_hien_tai + 1
    where loai = p_loai and nam = y returning so_hien_tai into n;
  return p_loai || '-' || y || '-' || lpad(n::text, 4, '0');   -- NK-2026-0001
end $$;

-- 2) SEED bộ đếm 'DON' tháng hiện tại = MAX seq đang có trong don_hang (0 nếu rỗng) → DB-gen TIẾP NỐI, không đè mã cũ.
do $$
declare th  int := extract(month from (now() at time zone 'Asia/Ho_Chi_Minh'));
        per int := extract(year  from (now() at time zone 'Asia/Ho_Chi_Minh'))::int * 100
                 + extract(month from (now() at time zone 'Asia/Ho_Chi_Minh'))::int;
        mx  int;
begin
  select coalesce(max((substring(ma_don from '^T[0-9]+-([0-9]+)$'))::int), 0) into mx
    from kho.don_hang where ma_don ~ ('^T' || th || '-[0-9]+$');
  insert into kho.chuoi_so(loai, nam, so_hien_tai) values ('DON', per, mx)
    on conflict (loai, nam) do update set so_hien_tai = greatest(kho.chuoi_so.so_hien_tai, excluded.so_hien_tai);
end $$;

-- 3) tao_don: p_ma_don NULL → DB tự cấp qua cap_so_phieu('DON'). Khác NULL → TẠM vẫn nhận (gỡ ở db/236).
--    ⚠ App gọi ký BA-tham-số kho.tao_don(jsonb,boolean,uuid) — thêm p_lead_id (WP-70, db/175/176). db/175 CỐ Ý
--    drop ký 2-tham-số để CHỈ CÓ MỘT BẢN (tránh overload ambiguous). Nên ở đây SỬA ĐÚNG ký 3-tham-số db/176,
--    và DROP ký 2-tham-số (giữ thiết kế MỘT bản). CHỈ đổi bước lấy mã (mục 2); INSERT/CHỐT/trả về = db/176.
drop function if exists kho.tao_don(jsonb, boolean);          -- gỡ ký 2-tham-số (khôi phục thiết kế MỘT bản db/175)
drop function if exists kho.tao_don(jsonb, boolean, uuid);
create function kho.tao_don(p_don jsonb, p_chot boolean default false, p_lead_id uuid default null::uuid)
  returns table(id uuid, ma_don text, trang_thai text)
  language plpgsql security definer set search_path to 'kho', 'public' as $function$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ma  text := nullif(btrim(p_don->>'ma_don'),'');
  v_id  uuid;
begin
  -- 1) VAI: chỉ sale/ceo (theo current_vai_tro → auth_uid, KHÔNG map nguoi_dung.id).
  if v_vai not in ('sale','ceo') then
    raise exception 'tao_don: chỉ sale/ceo được tạo đơn (vai "%")', v_vai; end if;
  -- 2) [WP-109 D-1] MÃ ĐƠN cấp ở TẦNG DB. NULL → cap_so_phieu('DON') (atomic; reset THÁNG; T{m}-{NNN}).
  --    Khác NULL: TẠM vẫn nhận mã client cũ (gỡ ở db/236 sau khi UI lên). Vẫn gác TRÙNG, lỗi rõ chữ, không nuốt.
  if v_ma is null then v_ma := kho.cap_so_phieu('DON'); end if;
  if exists (select 1 from kho.don_hang d where d.ma_don = v_ma) then
    raise exception 'tao_don: mã đơn "%" đã tồn tại — không tạo trùng', v_ma; end if;
  -- 3) INSERT: trang_thai HARD-CODE 'bao_gia'. Nhận đúng bộ trường client gửi (donToRow) TRỪ trang_thai.
  --    nguoi_tao: server tự gán current_ns() (không tin client). Trigger BEFORE INSERT (gan_sale_phu_trach,
  --    moc_bao_gia, dong_bo_khach, giu_hen_ban_dau, kiem_chuyen…) vẫn chạy như thường. lead_id = p_lead_id (WP-70).
  insert into kho.don_hang(
    ma_don, trang_thai,
    ngay_chot, thuong_hieu, sdt_khach, ten_khach, tinh_khach, dia_chi_khach,
    dong, loai, chiet_khau, gia_cong_thuc, gia_chot, ma_ns_duyet_giam, ly_do_giam,
    ly_do_huy, ly_do_thua, ghi_chu_thua, tk_coc, tien_coc, so_tien_thuc_thu,
    lap_ai, file_tk, gio_thiet_ke, nguoi_tk, don_vi_van_chuyen, khoi_luong_kg, dia_ban,
    ship_thuc_tra, lap_thuc_tra, ngay_di_hang, ngay_giao, ngay_du_kien, ngay_hen_khach,
    lo, ghi_chu, link, phong_cach, ngan_sach_trieu, tu_dung, nguon_khach,
    kgs, hoa_don, nguoi_tao, lead_id)
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
      case when p_lead_id is not null then (select case when l.ad_id is not null then 'quang_cao' else 'khac' end from kho.lead l where l.id=p_lead_id) else nullif(btrim(p_don->>'nguon_khach'),'') end,
    case when jsonb_typeof(p_don->'kgs') = 'array'
         then array(select jsonb_array_elements_text(p_don->'kgs')) end,
    case when jsonb_typeof(p_don->'hoa_don') in ('object','array') then p_don->'hoa_don' end,
    coalesce(nullif(p_don->>'nguoi_tao','')::uuid, kho.current_ns()), p_lead_id)
  returning don_hang.id into v_id;
  -- 4) CHỐT tuỳ chọn — CÙNG transaction. chot_don (db/148) RAISE (thiếu nguồn/thương hiệu, món giá…) thì
  --    exception nổi ra khỏi tao_don → cả INSERT rollback theo (kể cả seq chuoi_so vừa cấp — không để lủng số).
  if p_chot then
    perform kho.chot_don(v_id, nullif(btrim(p_don->>'nguon_khach'),''), nullif(btrim(p_don->>'thuong_hieu'),''));
  end if;
  -- 5) trả id + ma_don + trạng thái CUỐI (bao_gia nếu không chốt, moi_len_don nếu chốt).
  return query select d.id, d.ma_don, d.trang_thai from kho.don_hang d where d.id = v_id;
end $function$;
grant execute on function kho.tao_don(jsonb, boolean, uuid) to authenticated;

commit;
