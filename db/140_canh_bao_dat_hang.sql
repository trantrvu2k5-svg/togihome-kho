-- 140 — WP-42 (QD-60) tầng RPC: cảnh báo đặt hàng min/max + BOM chờ hệ số ở bàn giao.
--   Nguồn: ERP Sagegg&Alfnes §7.3.2 (min/max: reorder point → order-up-to) + §7.3.7 (action message).
--   HAI việc, đều tầng DB. IDEMPOTENT (create or replace).
--   HOÀN TÁC: drop function kho.canh_bao_dat_hang(); + chạy lại db/134 để phục hồi ban_giao_xuong bản cũ.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- Index riêng cho tốc-độ-xuất 30 ngày (RPC đọc SỔ giao_dich): chỉ dòng xuất → nhỏ, quét nhanh.
create index if not exists giao_dich_xuat_vt_ngay on kho.giao_dich (vat_tu_id, tao_luc) where loai = 'xuat';

-- ═══════════ A · canh_bao_dat_hang() — RPC MỚI ═══════════
-- SECURITY DEFINER + kiểm vai TRONG hàm (KHÔNG grant SELECT cột lẻ — né bẫy allowlist cột db/131/138).
-- Q2 (CEO): mức theo MÃ, tồn GỘP MỌI KHO ở xưởng.
create or replace function kho.canh_bao_dat_hang()
  returns table(
    ma text, ten text, don_vi_co_so text,
    ton numeric, giu_cho numeric, po_dang_ve numeric, kha_dung numeric,
    ton_toi_thieu numeric, muc_dat_len_toi numeric, so_dat numeric,
    ngay_het date, ngay_dat date, lead_time int,
    ncc_id uuid, ncc_ten text, don_gia numeric,
    nhom text, thieu_muc_max boolean)
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo') then raise exception 'canh_bao_dat_hang: chỉ kho/ceo'; end if;
  return query
  with vt as (   -- chỉ vật tư dùng phương pháp tồn tối thiểu
    select v.id, v.ma, v.ten, v.don_vi_co_so, v.ton_toi_thieu, v.muc_dat_len_toi
    from kho.vat_tu v where v.pp_ke_hoach = 'ton_toi_thieu' and v.ngung_dung = false
  ),
  ton_g as (   -- Σ tồn MỌI KHO (Q2: gộp mọi tồn ở xưởng)
    select t.vat_tu_id, sum(t.so_luong) ton from kho.ton t group by t.vat_tu_id
  ),
  giu_g as (   -- Σ giữ chỗ SỐNG mọi kho (đơn vị cơ sở)
    select g.vat_tu_id, sum(g.so_luong_giu - g.so_luong_da_xuat) giu
    from kho.giu_cho g where g.trang_thai = 'mo' group by g.vat_tu_id
  ),
  po_g as (    -- Σ PO đang về (da_gui/xac_nhan) QUY VỀ ĐƠN VỊ CƠ SỞ theo hệ số DÒNG
    select dd.vat_tu_id, sum(
        (dd.so_luong - dd.so_luong_da_nhan) *
        case when nrm.k = v.don_vi_co_so then 1
             -- hệ số quy đổi dòng; dmd_kiem_dvt (db/137) đảm bảo dvt hợp lệ → coalesce 1 chỉ là lưới an toàn
             else coalesce((select vd.he_so from kho.vat_tu_don_vi vd where vd.vat_tu_id = dd.vat_tu_id and vd.don_vi = nrm.k), 1) end
      ) po
    from kho.don_mua_dong dd
    join kho.don_mua d on d.id = dd.don_mua_id
    join kho.vat_tu v on v.id = dd.vat_tu_id
    cross join lateral (select coalesce((select o.ma from kho.don_vi o where o.ma = dd.dvt or o.ten = dd.dvt), dd.dvt) k) nrm
    where d.trang_thai in ('da_gui','xac_nhan')
    group by dd.vat_tu_id
  ),
  toc as (     -- tốc độ xuất bình quân/ngày 30 ngày gần nhất (giao_dich loại xuất, đơn vị cơ sở)
    select gd.vat_tu_id, (-sum(gd.so_luong)) / 30.0 toc
    from kho.giao_dich gd
    where gd.loai = 'xuat' and gd.tao_luc >= now() - interval '30 days'
    group by gd.vat_tu_id
  ),
  gia as (     -- NCC có giá THẤP NHẤT còn hiệu lực (ap_dung_tu <= hôm nay)
    select distinct on (g.vat_tu_id) g.vat_tu_id, g.ncc_id, g.don_gia, g.lead_time_ngay, ncc.ten ncc_ten
    from kho.gia_ncc g join kho.nha_cung_cap ncc on ncc.id = g.ncc_id
    where g.ap_dung_tu <= current_date
    order by g.vat_tu_id, g.don_gia asc, g.ap_dung_tu desc
  ),
  calc as (
    select vt.id, vt.ma, vt.ten, vt.don_vi_co_so, vt.ton_toi_thieu, vt.muc_dat_len_toi,
      coalesce(tg.ton,0) ton, coalesce(gg.giu,0) giu_cho, coalesce(pg.po,0) po_dang_ve,
      coalesce(tg.ton,0) - coalesce(gg.giu,0) + coalesce(pg.po,0) kha_dung,
      coalesce(tc.toc,0) toc, ga.ncc_id, ga.ncc_ten, ga.don_gia, ga.lead_time_ngay
    from vt
    left join ton_g tg on tg.vat_tu_id = vt.id
    left join giu_g gg on gg.vat_tu_id = vt.id
    left join po_g  pg on pg.vat_tu_id = vt.id
    left join toc   tc on tc.vat_tu_id = vt.id
    left join gia   ga on ga.vat_tu_id = vt.id
  )
  select c.ma, c.ten, c.don_vi_co_so, c.ton, c.giu_cho, c.po_dang_ve, c.kha_dung,
    c.ton_toi_thieu, c.muc_dat_len_toi,
    case when c.ton_toi_thieu is null then null
         when c.muc_dat_len_toi is not null then c.muc_dat_len_toi - c.kha_dung
         else c.ton_toi_thieu - c.kha_dung end as so_dat,     -- muc_dat_len_toi NULL → dùng ton_toi_thieu + cờ thieu_muc_max
    h.ngay_het,
    case when c.ton_toi_thieu is null then null
         when c.toc = 0 or c.kha_dung <= 0 then current_date   -- hết/không xuất → đặt ngay
         else h.ngay_het - coalesce(c.lead_time_ngay, 0) end as ngay_dat,
    c.lead_time_ngay, c.ncc_id, c.ncc_ten, c.don_gia,
    case when c.ton_toi_thieu is null then 'chua_co_muc'       -- 54 mã vừa NULL hoá
         when c.lead_time_ngay is null then 'thieu_lead'       -- dưới mức nhưng gia_ncc không có lead
         else 'canh_bao' end as nhom,
    (c.ton_toi_thieu is not null and c.muc_dat_len_toi is null) as thieu_muc_max
  from calc c
  cross join lateral (
    select case when c.kha_dung <= 0 then current_date
                when c.toc > 0 then current_date + least(floor(c.kha_dung / c.toc), 3650)::int
                else null end as ngay_het
  ) h
  where c.ton_toi_thieu is null            -- chua_co_muc: mọi mã min NULL
     or c.kha_dung < c.ton_toi_thieu;      -- canh_bao / thieu_lead: dưới điểm đặt lại
end $$;
grant execute on function kho.canh_bao_dat_hang() to authenticated;

-- ═══════════ B · ban_giao_xuong: trả THÊM bom_cho_he_so (KHÔNG đổi hành vi ghi) ═══════════
-- Chép nguyên hàm hiện hành (db/130/134) + 3 thay đổi: khai v_bom_cho · tính trước return · thêm khoá trả về.
CREATE OR REPLACE FUNCTION kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; v_miss int; f jsonb; n int := 0; v_kho uuid; v_giu_moi int := 0; v_mon_thieu jsonb; v_vt_thieu jsonb;
  v_bom_cho jsonb;   -- WP-42: dòng BOM chuẩn CÒN CHỜ hệ số (so_luong_co_so NULL, QD-55) — chưa giữ chỗ
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','thiet_ke') then raise exception 'ban_giao_xuong: chỉ ceo/thiet_ke'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'DON_KHONG_TON_TAI: không có đơn "%"', p_ma_don; end if;
  v_ns := kho.current_ns();
  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then raise exception 'ban_giao_xuong: đơn "%" chưa ai nhận việc', p_ma_don; end if;
    if v_don.ma_ns_thiet_ke <> v_ns then raise exception 'ban_giao_xuong: đơn "%" không phải bạn cầm', p_ma_don; end if;
  end if;
  if v_don.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao') then
    raise exception 'DA_VAO_CHUYEN: đơn "%" đã ở "%" — không gửi lại', p_ma_don, v_don.trang_thai; end if;
  if v_don.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'DON_CHUA_CHOT: đơn "%" chưa chốt', p_ma_don; end if;
  if v_don.trang_thai not in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file') then
    raise exception 'TRANG_THAI_KHONG_DAY: đơn "%" ở "%" không gửi được', p_ma_don, v_don.trang_thai; end if;
  select string_agg(ten, ', ') into v_chua_gan from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id, 'chuan')->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH') z;
  if v_chua_gan is not null then raise exception 'CHUA_GAN_QUY_TRINH: món chưa gán quy trình: %', v_chua_gan; end if;
  select string_agg(ten, ', ') into v_thieu_so from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id, 'chuan')->>'ok')::boolean is not true) z;
  if v_thieu_so is not null then raise exception 'THIEU_SO_DON_VI: món còn thiếu số: %', v_thieu_so; end if;

  -- CHỐT-COMPLETE: mọi dòng chuan chép được ĐỦ phút + đơn giá? Thiếu → CHẶN cả bàn giao (KHÔNG chốt một phần)
  select count(*) into v_miss
    from kho.so_don_vi_mon s join kho.don_hang_mon m on m.id = s.mon_id
    where m.don_id = v_don.id and s.moc = 'chuan' and s.chot_luc is null
      and not exists (
        select 1 from kho.quy_trinh_buoc b, kho.don_gia_baseline d
        where b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
              (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))
          and b.hoat_dong = s.hoat_dong and b.gio_moi_don_vi is not null
          and d.hoat_dong = s.hoat_dong and d.don_gia is not null);
  if v_miss > 0 then raise exception 'CHOT_THIEU_SO: % dòng số chuẩn thiếu phút/đơn giá để đóng băng — không bàn giao được', v_miss; end if;

  if p_danh_sach is null or jsonb_typeof(p_danh_sach) <> 'array' or jsonb_array_length(p_danh_sach) = 0 then
    raise exception 'THIEU_FILE_CAT: chưa đính kèm file cắt nào'; end if;
  v_le_mau := (coalesce(v_don.dong,'') = 'le' and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'CHUA_KHACH_DUYET: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT', p_ma_don; end if;

  for f in select * from jsonb_array_elements(p_danh_sach) loop
    insert into kho.file_san_xuat(ma_don, loai_file, duong_dan, ten_goc, co_byte, ma_ns_gui, ghi_chu)
      values (p_ma_don, coalesce(f->>'loai_file','khac'), f->>'duong_dan', f->>'ten_goc', (f->>'co_byte')::bigint, v_ns, p_ghi_chu);
    n := n + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where id = v_don.id;
  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat' where id = v_don.id;
  perform set_config('chan.tu_mon','0',true);

  -- CHỐT: đóng băng SỐ + PHÚT + ĐƠN GIÁ (chép từ quy_trinh_buoc + don_gia_baseline HIỆN TẠI)
  --   dùng subquery tương quan theo s (UPDATE...FROM không cho tham chiếu s trong JOIN ON)
  update kho.so_don_vi_mon s
    set gio_moi_don_vi_chot = (select b.gio_moi_don_vi from kho.quy_trinh_buoc b, kho.don_hang_mon m
          where m.id = s.mon_id and b.hoat_dong = s.hoat_dong and b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))),
        gio_co_dinh_chot = (select b.gio_co_dinh from kho.quy_trinh_buoc b, kho.don_hang_mon m
          where m.id = s.mon_id and b.hoat_dong = s.hoat_dong and b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))),
        don_gia_chot = (select d.don_gia from kho.don_gia_baseline d where d.hoat_dong = s.hoat_dong),
        chot_luc = now(), chot_boi = v_ns
    where s.moc = 'chuan' and s.chot_luc is null
      and s.mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  -- ═══ WP-32 (ERP 3.3.7): đóng băng BOM du_kien→chuan + sinh GIỮ CHỖ mềm (KHÔNG trừ tồn, KHÔNG gắn lô) ═══
  select id into v_kho from kho.kho where la_mac_dinh limit 1;
  -- (i) BOM du_kien → chuan (đóng băng); trigger db/128 CHO PHÉP vì old.chot_luc còn NULL
  update kho.don_hang_mon_bom b set moc = 'chuan', chot_luc = now()
    where b.moc = 'du_kien' and b.chot_luc is null
      and b.mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  -- (ii) mỗi dòng BOM chuan → 1 giữ chỗ (kho xưởng mặc định); bàn giao lần 2 vô hại nhờ UNIQUE(bom_id) WHERE mo
  with ins as (
    insert into kho.giu_cho(don_hang_id, don_hang_mon_id, don_hang_mon_bom_id, vat_tu_id, kho_id, so_luong_giu, tao_boi)
    select v_don.id, b.mon_id, b.id, b.vat_tu_id, v_kho, b.so_luong_co_so, v_ns
    from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id = b.mon_id
    where m.don_id = v_don.id and b.moc = 'chuan' and b.so_luong_co_so is not null   -- WP-36: dòng chờ hệ số CHƯA giữ chỗ (giữ khi có số qua chay_lai)
    on conflict (don_hang_mon_bom_id) where trang_thai = 'mo' do nothing
    returning 1)
  select count(*) into v_giu_moi from ins;
  -- (iii) món KHÔNG có dòng BOM chuan → cảnh báo mon_thieu_bom (KHÔNG chặn bàn giao)
  select coalesce(jsonb_agg(jsonb_build_object('mon_id', m.id, 'ten', m.ten)), '[]'::jsonb) into v_mon_thieu
    from kho.don_hang_mon m
    where m.don_id = v_don.id and not exists (select 1 from kho.don_hang_mon_bom b where b.mon_id = m.id and b.moc = 'chuan');
  -- (iv) khả dụng âm sau giữ chỗ → báo vat_tu_thieu (KHÔNG chặn — chờ hàng về, ERP 3.3.7; chặn là việc WP-42)
  select coalesce(jsonb_agg(jsonb_build_object('vat_tu_id', x.vat_tu_id, 'thieu', round(-x.kd, 4), 'don_vi', (select don_vi_co_so from kho.vat_tu where id=x.vat_tu_id))), '[]'::jsonb) into v_vt_thieu
    from (
      select v.vat_tu_id, coalesce(t.so_luong,0) - coalesce(g.giu,0) kd
      from (select distinct vat_tu_id from kho.giu_cho where don_hang_id = v_don.id and trang_thai='mo') v
      left join kho.ton t on t.vat_tu_id = v.vat_tu_id and t.kho_id = v_kho
      left join (select vat_tu_id, sum(so_luong_giu - so_luong_da_xuat) giu from kho.giu_cho where kho_id = v_kho and trang_thai='mo' group by vat_tu_id) g on g.vat_tu_id = v.vat_tu_id
    ) x where x.kd < 0;
  -- (v) WP-42 (QD-55): dòng BOM chuẩn CÒN CHỜ hệ số (so_luong_co_so NULL) — chưa quy được cơ sở, chưa giữ chỗ
  select coalesce(jsonb_agg(jsonb_build_object('mon_id', b.mon_id, 'vat_tu_id', b.vat_tu_id,
           'ma', v.ma, 'ten', v.ten, 'don_vi', b.don_vi, 'so_luong', b.so_luong)), '[]'::jsonb) into v_bom_cho
    from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id = b.mon_id
    left join kho.vat_tu v on v.id = b.vat_tu_id
    where m.don_id = v_don.id and b.moc = 'chuan' and b.so_luong_co_so is null;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'so_file', n, 'tu', v_don.trang_thai, 'den', 'cho_cat',
    'mon_thieu_bom', coalesce(v_mon_thieu,'[]'::jsonb), 'vat_tu_thieu', coalesce(v_vt_thieu,'[]'::jsonb),
    'bom_cho_he_so', coalesce(v_bom_cho,'[]'::jsonb), 'giu_cho_moi', v_giu_moi);
end $function$;

commit;
