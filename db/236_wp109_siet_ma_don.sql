-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 236 — WP-109 D-1 BƯỚC 4: SIẾT. UI (sale-CVTOeAcl.js) đã deploy + chạy đúng (đơn/món/nhật ký tạo với mã DB,
--   0 console đỏ, ca đồng thời an toàn). Nay tao_don TỪ CHỐI p_ma_don khác NULL — mã CHỈ do DB cấp.
--   Chốt chuyển tiếp "DB nhận cả hai dạng" (06 §1c.1): db/235 nhận cả hai; db/236 bỏ nhánh nhận mã client.
--
--   RÀ QUYỀN GHI CỘT (họ WP-11b/11c): ma_don KHÔNG nằm trong whitelist grant don_hang cho authenticated
--   (đã kiểm: client KHÔNG PATCH thẳng được ma_don) → không cần đổi grant, chỉ siết ở RPC.
--   Caller kho.tao_don DUY NHẤT: web/src/sale.js (gửi p_lead_id, ma_don=null). Plugin có DonHang.tao_don RIÊNG
--   (Ruby, tạo thư mục cục bộ) — KHÔNG gọi RPC này. Không caller nào còn gửi ma_don.
--
--   HOÀN TÁC: chạy lại db/235 (khôi phục nhánh "NULL → cấp; khác NULL → tạm nhận").
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists kho.tao_don(jsonb, boolean, uuid);
create function kho.tao_don(p_don jsonb, p_chot boolean default false, p_lead_id uuid default null::uuid)
  returns table(id uuid, ma_don text, trang_thai text)
  language plpgsql security definer set search_path to 'kho', 'public' as $function$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ma  text := nullif(btrim(p_don->>'ma_don'),'');
  v_id  uuid;
begin
  -- 1) VAI: chỉ sale/ceo.
  if v_vai not in ('sale','ceo') then
    raise exception 'tao_don: chỉ sale/ceo được tạo đơn (vai "%")', v_vai; end if;
  -- 2) [WP-109 D-1 SIẾT] MÃ ĐƠN cấp ở TẦNG DB. Client KHÔNG được gửi ma_don nữa.
  if v_ma is not null then
    raise exception 'tao_don: client KHÔNG được gửi ma_don — mã do DB cấp (WP-109 D-1). Bỏ ma_don khỏi payload.'; end if;
  v_ma := kho.cap_so_phieu('DON');   -- atomic; reset THÁNG; T{m}-{NNN}
  if exists (select 1 from kho.don_hang d where d.ma_don = v_ma) then
    raise exception 'tao_don: mã đơn "%" đã tồn tại — không tạo trùng', v_ma; end if;
  -- 3) INSERT: trang_thai HARD-CODE 'bao_gia'. Nhận đúng bộ trường client gửi (donToRow) TRỪ trang_thai.
  --    nguoi_tao: server tự gán current_ns(). lead_id = p_lead_id (WP-70). Trigger BEFORE INSERT vẫn chạy.
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
  -- 4) CHỐT tuỳ chọn — CÙNG transaction (chot_don RAISE thì cả INSERT + seq rollback theo).
  if p_chot then
    perform kho.chot_don(v_id, nullif(btrim(p_don->>'nguon_khach'),''), nullif(btrim(p_don->>'thuong_hieu'),''));
  end if;
  -- 5) trả id + ma_don + trạng thái CUỐI.
  return query select d.id, d.ma_don, d.trang_thai from kho.don_hang d where d.id = v_id;
end $function$;
grant execute on function kho.tao_don(jsonb, boolean, uuid) to authenticated;

commit;
