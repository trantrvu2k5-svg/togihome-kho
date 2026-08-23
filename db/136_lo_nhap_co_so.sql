-- 136 — WP-25: LÔ NHẬP VỀ ĐƠN VỊ CƠ SỞ (QD-53). CẤM COMMIT tới khi CEO duyệt.
--   Nhận hàng: quy số + giá dòng đơn mua (đơn vị hiển thị) → CƠ SỞ ngay lúc nhận → lo_nhap.con_lai/gia_von_lo cùng đơn vị với
--   giao_dich/ton → FIFO & back-flush hết lệch hệ số. Snapshot he_so_ap_dung/don_vi_nguon/so_luong_nguon lên lô (như BOM) để
--   HĐ tính đúng dù hệ số đổi sau. gia_von_lo = đơn giá ÷ hệ số (giá/cơ sở). KHÔNG làm tròn con_lai (10 m² × 0,336 = 3,36 tấm).
--   ⚠ Sửa TẠI CHỖ ghi_so_phieu/dm_nhan_hang/hd_ncc_ghi/hd_ncc_xoa (QD-03 một đường ghi) — không đẻ hàm mới.
--   §3 migrate lô cũ trong transaction, in TRƯỚC/SAU; Σ con_lai (mã đổi) ≠ ton → RAISE (rollback cả migration).
--   HOÀN TÁC: chạy lại db/127 (ghi_so_phieu/dm_nhan_hang) + db/135 (hd_ncc_ghi/hd_ncc_xoa); alter table lo_nhap drop column he_so_ap_dung, don_vi_nguon, so_luong_nguon.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══ 1 · CỘT snapshot đơn vị nguồn trên lô ═══
alter table kho.lo_nhap add column if not exists he_so_ap_dung numeric;
alter table kho.lo_nhap add column if not exists don_vi_nguon  text;
alter table kho.lo_nhap add column if not exists so_luong_nguon numeric;

-- ═══ 2 · ghi_so_phieu (lưu snapshot; số/giá đã cơ sở) ═══
CREATE OR REPLACE FUNCTION kho.ghi_so_phieu(p_loai text, p_ncc uuid, p_ly_do text, p_ghi_chu text, p_dong jsonb, p_ma_to text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare vt text; sp text; pid uuid; kid uuid; uid uuid; d jsonb;
        vid uuid; sl numeric; dg numeric; cur numeric; moi numeric; am text[] := '{}'; v_ng text;
begin
  vt := current_vai_tro();
  if vt is null or vt not in ('ceo','kho') then raise exception 'Chỉ CEO/kho được ghi sổ'; end if;
  if p_loai not in ('nhap','xuat','xuat_sx') then raise exception 'loai phải nhap/xuat/xuat_sx'; end if;
  if p_loai = 'xuat' and p_ma_to is null then raise exception 'Phiếu xuất phải chọn TỔ nhận'; end if;
  v_ng := case when p_loai='xuat_sx' then 'quet_tem' else 'phieu' end;
  select id into kid from kho where la_mac_dinh limit 1;
  select id into uid from nguoi_dung where auth_uid = auth.uid();
  sp := cap_so_phieu(case when p_loai='nhap' then 'NK' when p_loai='xuat_sx' then 'XSX' else 'XK' end);
  insert into phieu(so_phieu,loai,kho_id,trang_thai,ncc_id,ly_do,ma_to,ghi_so_luc,ghi_so_boi,nguoi_thao_tac)
    values(sp,p_loai,kid,'ghi_so',p_ncc,p_ly_do,p_ma_to,now(),uid,uid) returning id into pid;
  for d in select * from jsonb_array_elements(p_dong) loop
    vid := (d->>'vat_tu_id')::uuid; sl := (d->>'so_luong')::numeric; dg := nullif(d->>'don_gia','')::numeric;
    if sl is null or sl <= 0 then continue; end if;
    insert into phieu_dong(phieu_id,vat_tu_id,so_luong,don_gia,thanh_tien,ncc_id,ly_do,don_mua_dong_id,so_luong_chuan,hao_hut_pct_ap_dung,so_du_lam_tron)
      values(pid,vid,sl,dg, case when dg is not null then sl*dg end, p_ncc,
             coalesce(nullif(d->>'ghi_chu',''), p_ly_do), (d->>'don_mua_dong_id')::uuid,
             (d->>'so_luong_chuan')::numeric, (d->>'hao_hut_pct_ap_dung')::numeric, (d->>'so_du_lam_tron')::numeric);   -- ghi_chu theo dòng (fallback ly_do chung)
    select so_luong into cur from ton where vat_tu_id=vid and kho_id=kid; cur := coalesce(cur,0);
    if p_loai='nhap' then
      insert into lo_nhap(vat_tu_id,kho_id,phieu_id,so_luong_nhap,gia_von_lo,con_lai,nguoi_thao_tac,he_so_ap_dung,don_vi_nguon,so_luong_nguon)
        values(vid,kid,pid,sl,dg,sl,uid, nullif(d->>'he_so_ap_dung','')::numeric, nullif(d->>'don_vi_nguon',''), nullif(d->>'so_luong_nguon','')::numeric);
      insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
        values(vid,kid,'nhap', sl, pid, 0, 'phieu', uid);
    else
      moi := cur - sl;
      declare con numeric := sl; tru numeric; lg record;
      begin
        for lg in select id, con_lai from lo_nhap where vat_tu_id=vid and kho_id=kid and con_lai>0 order by tao_luc asc, id asc loop
          exit when con <= 0;
          tru := least(lg.con_lai, con);
          update lo_nhap set con_lai = con_lai - tru where id = lg.id;
          con := con - tru;
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,lo_nhap_id,so_du_sau,nguon,nguoi_thao_tac)
            values(vid,kid,'xuat', -tru, pid, lg.id, 0, v_ng, uid);
        end loop;
        if con > 0 then
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
            values(vid,kid,'xuat', -con, pid, 0, v_ng, uid);
        end if;
      end;
      if moi < 0 then am := am || vid::text; end if;
    end if;
  end loop;
  return jsonb_build_object('so_phieu', sp, 'phieu_id', pid, 'ton_am', am);   -- + phieu_id (WP-21); caller cũ đọc .so_phieu vẫn ổn
end $function$;

-- ═══ 3 · dm_nhan_hang (quy về cơ sở lúc nhận) ═══
CREATE OR REPLACE FUNCTION kho.dm_nhan_hang(p_don_mua_id uuid, p_dong jsonb, p_ngay date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare
  v_vai text := coalesce(current_vai_tro(),'');
  v_dm record; d jsonb; v_dd record;
  v_dong_id uuid; v_sl numeric; v_ghi text; v_key text; v_base numeric; v_hs numeric;
  v_ghi_dong jsonb := '[]'::jsonb;               -- dòng đưa vào ghi_so_phieu
  v_vt uuid; v_vt_ids uuid[] := '{}';            -- vật tư distinct (tồn trước/sau)
  v_truoc jsonb := '{}'::jsonb; v_ts jsonb := '[]'::jsonb;
  v_res jsonb; v_so_phieu text; v_phieu_id uuid;
  v_dong_du int; v_dong_tong int; v_tt text;
  v_cur numeric;
begin
  if v_vai not in ('kho','ceo') then raise exception 'dm_nhan_hang: chỉ kho/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  select * into v_dm from kho.don_mua where id = p_don_mua_id for update;
  if v_dm.id is null then raise exception 'dm_nhan_hang: đơn không tồn tại'; end if;
  if v_dm.trang_thai <> 'xac_nhan' then raise exception 'DM_SAI_TRANG_THAI: đơn "%" đang "%" — chỉ nhận hàng khi NCC đã xác nhận', v_dm.so_don, v_dm.trang_thai; end if;
  if p_dong is null or jsonb_array_length(p_dong) = 0 then raise exception 'dm_nhan_hang: phải nhận ÍT NHẤT MỘT dòng'; end if;
  -- ghi_so_phieu ghi vào KHO MẶC ĐỊNH (xưởng 1 kho). Guard: đơn kho khác → chặn (WP sau mở đa kho mới nới).
  if v_dm.kho_id <> (select id from kho.kho where la_mac_dinh limit 1) then
    raise exception 'dm_nhan_hang: đơn nhận vào kho không mặc định — chưa hỗ trợ (mở đa kho ở WP sau)'; end if;

  -- duyệt dòng nhận: kiểm thuộc đơn · sl>0 · không vượt đặt · gom dòng cho ghi_so_phieu (kèm giá dòng đơn + ghi_chu + móc dòng)
  for d in select * from jsonb_array_elements(p_dong) loop
    v_dong_id := (d->>'dong_id')::uuid;
    v_sl := (d->>'so_luong')::numeric;
    v_ghi := nullif(d->>'ghi_chu_lo','');
    if v_sl is null or v_sl <= 0 then raise exception 'dm_nhan_hang: số lượng nhận phải > 0 (dong_id=%)', v_dong_id; end if;
    select * into v_dd from kho.don_mua_dong where id = v_dong_id and don_mua_id = p_don_mua_id for update;
    if v_dd.id is null then raise exception 'dm_nhan_hang: dòng % không thuộc đơn %', v_dong_id, v_dm.so_don; end if;
    if v_dd.so_luong_da_nhan + v_sl > v_dd.so_luong then
      raise exception 'DM_VUOT_SO_DAT: dòng % nhận % + đã nhận % = vượt đặt % (dong_id=%)',
        v_dd.stt, v_sl, v_dd.so_luong_da_nhan, v_dd.so_luong, v_dong_id;
    end if;
    -- WP-25: đơn vị dòng đơn (v_dd.dvt, hiển thị có dấu) → khoá no-dấu → CƠ SỞ. Lạ không hệ số → quy_ve_co_so RAISE.
    v_key := coalesce((select ma from kho.don_vi where ma = v_dd.dvt or ten = v_dd.dvt limit 1), v_dd.dvt);
    v_base := kho.quy_ve_co_so(v_dd.vat_tu_id, v_key, v_sl);
    v_hs := v_base / nullif(v_sl, 0);
    v_ghi_dong := v_ghi_dong || jsonb_build_object('vat_tu_id', v_dd.vat_tu_id, 'so_luong', v_base,
      'don_gia', v_dd.don_gia / nullif(v_hs, 0), 'ghi_chu', v_ghi, 'don_mua_dong_id', v_dd.id,
      'don_vi_nguon', v_key, 'so_luong_nguon', v_sl, 'he_so_ap_dung', v_hs);
    if not (v_dd.vat_tu_id = any(v_vt_ids)) then v_vt_ids := v_vt_ids || v_dd.vat_tu_id; end if;
  end loop;

  -- tồn TRƯỚC (theo kho của đơn) cho mỗi vật tư distinct
  foreach v_vt in array v_vt_ids loop
    select coalesce(so_luong,0) into v_cur from kho.ton where vat_tu_id = v_vt and kho_id = v_dm.kho_id;
    v_truoc := v_truoc || jsonb_build_object(v_vt::text, coalesce(v_cur,0));
  end loop;

  -- MỘT ĐƯỜNG GHI: phiếu nhập tự sinh (giá lô = đơn giá dòng), gắn kho của đơn + NCC của đơn
  v_res := kho.ghi_so_phieu('nhap', v_dm.ncc_id, 'Nhận hàng đơn mua ' || v_dm.so_don, null, v_ghi_dong, null);
  v_so_phieu := v_res->>'so_phieu';
  v_phieu_id := (v_res->>'phieu_id')::uuid;
  update kho.phieu set don_mua_id = p_don_mua_id where id = v_phieu_id;

  -- cập nhật đã nhận theo từng dòng
  for d in select * from jsonb_array_elements(p_dong) loop
    update kho.don_mua_dong set so_luong_da_nhan = so_luong_da_nhan + (d->>'so_luong')::numeric
      where id = (d->>'dong_id')::uuid;
  end loop;

  -- lịch sử nhận hàng (giữ nguyên trạng thái đơn — cổng chuyển do dm_chuyen_trang_thai)
  insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
    values(p_don_mua_id, kho.current_ns(), v_vai, v_dm.trang_thai, v_dm.trang_thai,
           jsonb_build_object('nhan_hang', jsonb_build_object('so_phieu', v_so_phieu, 'so_dong', jsonb_array_length(p_dong))));

  -- đủ hết dòng → tự chuyển da_nhan qua CỔNG (GUC cho phép hệ thống, không cần ceo)
  select count(*) filter (where so_luong_da_nhan >= so_luong), count(*) into v_dong_du, v_dong_tong
    from kho.don_mua_dong where don_mua_id = p_don_mua_id;
  if v_dong_du = v_dong_tong then
    perform set_config('kho.dm_he_thong', '1', true);
    perform kho.dm_chuyen_trang_thai(p_don_mua_id, 'da_nhan', null, 'nhận đủ qua phiếu ' || v_so_phieu);
    perform set_config('kho.dm_he_thong', '', true);
  end if;
  select trang_thai into v_tt from kho.don_mua where id = p_don_mua_id;

  -- tồn SAU
  foreach v_vt in array v_vt_ids loop
    select coalesce(so_luong,0) into v_cur from kho.ton where vat_tu_id = v_vt and kho_id = v_dm.kho_id;
    v_ts := v_ts || jsonb_build_object('vat_tu_id', v_vt, 'truoc', (v_truoc->>v_vt::text)::numeric, 'sau', coalesce(v_cur,0));
  end loop;

  return jsonb_build_object('phieu_id', v_phieu_id, 'so_phieu', v_so_phieu, 'trang_thai_don', v_tt,
    'dong_du', v_dong_du, 'dong_tong', v_dong_tong, 'ton_truoc_sau', v_ts);
end $function$;

-- ═══ 4 · hd_ncc_ghi (giá HĐ ÷ hệ số) ═══
CREATE OR REPLACE FUNCTION kho.hd_ncc_ghi(p_don_mua_id uuid, p_so_hd text, p_loai text, p_ngay_hd date, p_han date, p_vat_pct numeric, p_ghi_chu text, p_dong jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_dm record; v_hd_id uuid;
  v_vat numeric; v_ngay date; v_han date; d jsonb; v_dd record;
  v_dong_id uuid; v_sl numeric; v_dg_hd numeric; v_da_hd numeric;
  v_chua numeric := 0; v_lech_n int := 0; v_lech_sum numeric := 0;
  v_kho uuid; v_canh text[] := '{}'; v_upd int; v_chua_khop boolean;
begin
  if v_vai not in ('kho','ke_toan','ceo') then raise exception 'hd_ncc_ghi: chỉ kho/ke_toan/ceo'; end if;
  select * into v_dm from kho.don_mua where id=p_don_mua_id for update;
  if v_dm.id is null then raise exception 'hd_ncc_ghi: đơn mua không tồn tại'; end if;
  if v_dm.trang_thai not in ('da_nhan','da_khop_hd') then
    raise exception 'HD_DON_CHUA_NHAN: đơn "%" đang "%" — chỉ khớp HĐ khi đã nhận', v_dm.so_don, v_dm.trang_thai; end if;
  if coalesce(btrim(p_so_hd),'') = '' then raise exception 'hd_ncc_ghi: thiếu số hoá đơn'; end if;
  if p_loai not in ('hoa_don_vat','bang_ke') then raise exception 'hd_ncc_ghi: loại chứng từ phải hoa_don_vat/bang_ke'; end if;
  if p_dong is null or jsonb_array_length(p_dong) = 0 then raise exception 'hd_ncc_ghi: HĐ phải có ít nhất một dòng'; end if;
  v_vat := case when p_loai='bang_ke' then 0 else coalesce(p_vat_pct,0) end;   -- bảng kê ép VAT 0
  if v_vat not in (0,5,8,10) then raise exception 'hd_ncc_ghi: VAT phải 0/5/8/10'; end if;
  v_ngay := coalesce(p_ngay_hd, current_date);
  v_han  := coalesce(p_han, v_ngay + 30);                                        -- [GIẢ ĐỊNH] +30 ngày
  v_kho := v_dm.kho_id;
  if exists(select 1 from kho.hoa_don_ncc where ncc_id=v_dm.ncc_id and so_hd=btrim(p_so_hd) and da_xoa_luc is null) then
    raise exception 'HD_TRUNG: NCC này đã có hoá đơn số "%"', btrim(p_so_hd); end if;

  insert into kho.hoa_don_ncc(so_hd, loai_chung_tu, ncc_id, don_mua_id, ngay_hd, han_thanh_toan, vat_pct, ghi_chu, la_demo, tao_boi)
    values(btrim(p_so_hd), p_loai, v_dm.ncc_id, p_don_mua_id, v_ngay, v_han, v_vat, nullif(btrim(p_ghi_chu),''), false, kho.current_ns())
    returning id into v_hd_id;

  for d in select * from jsonb_array_elements(p_dong) loop
    v_dong_id := (d->>'don_mua_dong_id')::uuid;
    v_sl := (d->>'so_luong')::numeric;
    v_dg_hd := coalesce((d->>'don_gia_hd')::numeric, 0);
    select * into v_dd from kho.don_mua_dong where id=v_dong_id and don_mua_id=p_don_mua_id;
    if v_dd.id is null then raise exception 'hd_ncc_ghi: dòng % không thuộc đơn %', v_dong_id, v_dm.so_don; end if;
    if v_sl is null or v_sl <= 0 then raise exception 'hd_ncc_ghi: số lượng HĐ phải > 0 (dòng %)', v_dd.stt; end if;
    -- KHỚP: Σ SL HĐ (chưa xoá, gồm dòng đang ghi) ≤ SL đã nhận
    select coalesce(sum(hd.so_luong),0) into v_da_hd
      from kho.hoa_don_ncc_dong hd join kho.hoa_don_ncc h on h.id=hd.hoa_don_ncc_id
      where hd.don_mua_dong_id=v_dong_id and h.da_xoa_luc is null and h.id <> v_hd_id;
    if v_da_hd + v_sl > v_dd.so_luong_da_nhan then
      raise exception 'HD_VUOT_NHAN: mã % (dòng %) — HĐ % + đã HĐ % > đã nhận %',
        (select ma from kho.vat_tu where id=v_dd.vat_tu_id), v_dd.stt, v_sl, v_da_hd, v_dd.so_luong_da_nhan;
    end if;
    insert into kho.hoa_don_ncc_dong(hoa_don_ncc_id, don_mua_dong_id, so_luong, don_gia_hd, don_gia_don, lech_don_gia, thanh_tien)
      values(v_hd_id, v_dong_id, v_sl, v_dg_hd, v_dd.don_gia, v_dg_hd - v_dd.don_gia, v_sl * v_dg_hd);
    v_chua := v_chua + v_sl * v_dg_hd;
    if v_dg_hd <> v_dd.don_gia then v_lech_n := v_lech_n + 1; v_lech_sum := v_lech_sum + (v_dg_hd - v_dd.don_gia) * v_sl; end if;
    -- GIÁ LÔ SỐNG đổi theo HĐ (ERP 3.3.8). Lô ở CƠ SỞ (WP-25) → gia_von_lo = đơn giá HĐ ÷ hệ số áp dụng lúc nhận.
    update kho.lo_nhap l set gia_von_lo = v_dg_hd / coalesce(l.he_so_ap_dung, 1)
      where l.lo_da_huy=false and l.con_lai>0 and l.kho_id=v_kho and l.vat_tu_id=v_dd.vat_tu_id
        and exists(select 1 from kho.phieu_dong pd where pd.phieu_id=l.phieu_id and pd.vat_tu_id=l.vat_tu_id and pd.don_mua_dong_id=v_dong_id);
    get diagnostics v_upd = row_count;
    if v_upd = 0 then
      v_canh := v_canh || ('mã '||(select ma from kho.vat_tu where id=v_dd.vat_tu_id)||' đã hết lô sống — giá vốn không đổi');
    else
      perform kho.tinh_lai_gia_von_bq(v_dd.vat_tu_id, v_kho);
    end if;
  end loop;

  update kho.hoa_don_ncc set tong_chua_vat = v_chua, tong_vat = round(v_chua * v_vat / 100),
    tong_gom_vat = v_chua + round(v_chua * v_vat / 100) where id = v_hd_id;

  -- ĐƠN → da_khop_hd khi: mọi dòng nhận đủ đặt (da_nhan=so_luong) VÀ HĐ phủ hết đã nhận (Σhd=da_nhan)
  select exists(
    select 1 from kho.don_mua_dong dd
    where dd.don_mua_id=p_don_mua_id
      and (dd.so_luong_da_nhan < dd.so_luong
           or coalesce((select sum(hd.so_luong) from kho.hoa_don_ncc_dong hd join kho.hoa_don_ncc h on h.id=hd.hoa_don_ncc_id
                        where hd.don_mua_dong_id=dd.id and h.da_xoa_luc is null),0) < dd.so_luong_da_nhan)
  ) into v_chua_khop;
  if not v_chua_khop and v_dm.trang_thai = 'da_nhan' then
    perform set_config('kho.dm_he_thong','1',true);
    perform kho.dm_chuyen_trang_thai(p_don_mua_id, 'da_khop_hd');
    perform set_config('kho.dm_he_thong','',true);
  end if;

  insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
    values(p_don_mua_id, kho.current_ns(), v_vai, v_dm.trang_thai,
           (select trang_thai from kho.don_mua where id=p_don_mua_id),
           jsonb_build_object('khop_hd', btrim(p_so_hd), 'tong_gom_vat', v_chua + round(v_chua*v_vat/100),
             'lech_gia_so_dong', v_lech_n, 'lech_gia_tong', v_lech_sum));

  return jsonb_build_object('ok',true,'id',v_hd_id,'so_hd',btrim(p_so_hd),
    'tong_chua_vat',v_chua,'tong_vat',round(v_chua*v_vat/100),'tong_gom_vat',v_chua+round(v_chua*v_vat/100),
    'vat_pct',v_vat,'lech_gia_so_dong',v_lech_n,'lech_gia_tong',v_lech_sum,
    'trang_thai_don',(select trang_thai from kho.don_mua where id=p_don_mua_id),
    'canh_bao', case when array_length(v_canh,1) is null then '[]'::jsonb else to_jsonb(v_canh) end);
end $function$;

-- ═══ 5 · hd_ncc_xoa (đảo giá ÷ hệ số) ═══
CREATE OR REPLACE FUNCTION kho.hd_ncc_xoa(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_hd record; r record; v_kho uuid; v_upd int; v_canh text[] := '{}';
begin
  if v_vai not in ('kho','ke_toan','ceo') then raise exception 'hd_ncc_xoa: chỉ kho/ke_toan/ceo'; end if;
  select * into v_hd from kho.hoa_don_ncc where id=p_id and da_xoa_luc is null for update;
  if v_hd.id is null then raise exception 'hd_ncc_xoa: hoá đơn không tồn tại hoặc đã xoá'; end if;
  if exists(select 1 from kho.phieu_chi_ncc where hoa_don_ncc_id=p_id and da_xoa_luc is null) then
    raise exception 'HD_CO_PHIEU_CHI: hoá đơn đã có phiếu chi — xoá phiếu chi trước'; end if;
  select kho_id into v_kho from kho.don_mua where id=v_hd.don_mua_id;
  -- ĐẢO giá lô về don_gia_don nếu lô còn sống VÀ dòng đó không còn HĐ khác (chưa xoá)
  for r in select hd.don_mua_dong_id, hd.don_gia_don, dd.vat_tu_id
           from kho.hoa_don_ncc_dong hd join kho.don_mua_dong dd on dd.id=hd.don_mua_dong_id
           where hd.hoa_don_ncc_id=p_id loop
    if not exists(select 1 from kho.hoa_don_ncc_dong hd2 join kho.hoa_don_ncc h2 on h2.id=hd2.hoa_don_ncc_id
                  where hd2.don_mua_dong_id=r.don_mua_dong_id and h2.id<>p_id and h2.da_xoa_luc is null) then
      update kho.lo_nhap l set gia_von_lo = r.don_gia_don / coalesce(l.he_so_ap_dung, 1)
        where l.lo_da_huy=false and l.con_lai>0 and l.kho_id=v_kho and l.vat_tu_id=r.vat_tu_id
          and exists(select 1 from kho.phieu_dong pd where pd.phieu_id=l.phieu_id and pd.vat_tu_id=l.vat_tu_id and pd.don_mua_dong_id=r.don_mua_dong_id);
      get diagnostics v_upd = row_count;
      if v_upd > 0 then perform kho.tinh_lai_gia_von_bq(r.vat_tu_id, v_kho); end if;
    end if;
  end loop;
  update kho.hoa_don_ncc set da_xoa_luc = now() where id=p_id;
  -- đơn da_khop_hd → lùi da_nhan (không còn phủ đủ)
  if (select trang_thai from kho.don_mua where id=v_hd.don_mua_id) = 'da_khop_hd' then
    perform set_config('kho.dm_he_thong','1',true);
    perform kho.dm_chuyen_trang_thai(v_hd.don_mua_id, 'da_nhan', null, 'xoá HĐ '||v_hd.so_hd);
    perform set_config('kho.dm_he_thong','',true);
  end if;
  insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
    values(v_hd.don_mua_id, kho.current_ns(), v_vai, null, null, jsonb_build_object('xoa_hd', v_hd.so_hd));
  return jsonb_build_object('ok',true,'id',p_id,'trang_thai_don',(select trang_thai from kho.don_mua where id=v_hd.don_mua_id));
end $function$;

-- ═══ 6 · MIGRATE lô cũ về cơ sở + backfill snapshot + kiểm Σ ═══
do $mig$
declare r record; v_key text; v_hs numeric; n_doi int := 0; mad text[] := '{}';
begin
  -- backfill: mọi lô CHƯA có snapshot → coi ĐÃ cơ sở (he_so 1)
  update kho.lo_nhap set he_so_ap_dung = 1,
    don_vi_nguon = coalesce(don_vi_nguon, (select don_vi_co_so from kho.vat_tu where id = lo_nhap.vat_tu_id)),
    so_luong_nguon = coalesce(so_luong_nguon, so_luong_nhap)
  where he_so_ap_dung is null;

  -- lô nối đơn mua mà đơn vị dòng đơn (chuẩn hoá no-dấu) ≠ cơ sở VÀ có hệ số → quy về cơ sở
  for r in
    select l.id, v.ma, v.don_vi_co_so, l.vat_tu_id, l.con_lai, l.so_luong_nhap, l.gia_von_lo, dd.dvt
    from kho.lo_nhap l
    join kho.phieu_dong pd on pd.phieu_id = l.phieu_id and pd.vat_tu_id = l.vat_tu_id
    join kho.don_mua_dong dd on dd.id = pd.don_mua_dong_id
    join kho.vat_tu v on v.id = l.vat_tu_id
    where l.lo_da_huy = false and dd.dvt is not null
  loop
    v_key := coalesce((select ma from kho.don_vi where ma = r.dvt or ten = r.dvt limit 1), r.dvt);
    if v_key = r.don_vi_co_so then continue; end if;                 -- đã cơ sở (chỉ khác dấu)
    select he_so into v_hs from kho.vat_tu_don_vi where vat_tu_id = r.vat_tu_id and don_vi = v_key;
    if v_hs is null or v_hs = 1 then continue; end if;              -- không có hệ số → coi cơ sở (giữ nguyên, snapshot he_so 1)
    raise notice 'LÔ ĐỔI % (lô %): nguồn % hs % · con_lai % → % · gia_von_lo % → %',
      r.ma, r.id, v_key, v_hs, r.con_lai, r.con_lai * v_hs, r.gia_von_lo, round(r.gia_von_lo / v_hs, 4);
    update kho.lo_nhap set con_lai = con_lai * v_hs, so_luong_nhap = so_luong_nhap * v_hs,
      gia_von_lo = gia_von_lo / v_hs, he_so_ap_dung = v_hs, don_vi_nguon = v_key, so_luong_nguon = r.so_luong_nhap
    where id = r.id;
    n_doi := n_doi + 1; if not (r.ma = any(mad)) then mad := mad || r.ma; end if;
  end loop;
  raise notice 'WP-25 §3: % lô đổi đơn vị · % mã bị ảnh hưởng (%)', n_doi, coalesce(array_length(mad,1),0), array_to_string(mad, ', ');

  -- KIỂM: mã ĐÃ ĐỔI → Σ con_lai (lô sống) phải = ton.so_luong; lệch → RAISE (rollback)
  for r in
    select v.ma, coalesce(sum(l.con_lai) filter (where l.lo_da_huy = false), 0) lo_sum, coalesce(t.so_luong, 0) ton
    from kho.vat_tu v
    left join kho.lo_nhap l on l.vat_tu_id = v.id
    left join kho.ton t on t.vat_tu_id = v.id
    where v.ma = any(mad)
    group by v.ma, t.so_luong
  loop
    if round(r.lo_sum, 4) <> round(r.ton, 4) then
      raise exception 'WP-25 §3: mã % Σ lô sống % ≠ ton % — ROLLBACK cả migration', r.ma, r.lo_sum, r.ton;
    end if;
  end loop;
  if coalesce(array_length(mad,1),0) = 0 then raise notice 'WP-25 §3: prod không có lô nào lệch đơn vị (mọi lô đã ở cơ sở) — chỉ backfill snapshot.'; end if;
end $mig$;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='kho' and table_name='lo_nhap' and column_name='he_so_ap_dung')
    then raise exception 'THIẾU cột he_so_ap_dung'; end if;
  raise notice 'db/136 OK: lô về cơ sở + snapshot (he_so_ap_dung/don_vi_nguon/so_luong_nguon) + 4 hàm sửa tại chỗ.';
end $$;
commit;
