-- 133 — phieu.la_demo BỀN qua SET NULL (WP-33, QD-54/QD-46). Cờ demo ở PHIẾU (không suy từ mon_id — mon_id bị SET NULL lúc xoa_demo).
--   la_demo đã thêm ở db/132 (not null default false); xuat_back_flush set theo don_hang.la_demo. Ở đây: phiếu ĐẢO (HX) thừa kế
--   la_demo của phiếu gốc + backfill phiếu xuat_sx demo cũ. Danh sách phiếu lọc la_demo=false mặc định (app veDsPhieu).
--   ⚠ IDEMPOTENT. HOÀN TÁC: chạy lại db/132 (huy_phieu bản không la_demo trong đảo).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- Backfill: phiếu xuat_sx đang la_demo=false NHƯNG thuộc đơn demo (còn ma_don) → la_demo=true.
--   Phiếu mon_id null + ma_don null (đã tách hẳn) KHÔNG suy được → để nguyên (0 tác động; hiện KHÔNG có phiếu xuat_sx nào).
update kho.phieu p set la_demo = true
  where p.loai = 'xuat_sx' and p.la_demo = false
    and p.ma_don is not null and exists (select 1 from kho.don_hang d where d.ma_don = p.ma_don and d.la_demo);
do $$ declare n int; begin
  select count(*) into n from kho.phieu where loai='xuat_sx' and la_demo=false and mon_id is null and ma_don is null;
  if n > 0 then raise notice 'db/133: % phiếu xuat_sx mồ côi (mon_id+ma_don null) không suy được la_demo — CHỜ CEO nếu cần', n; end if;
end $$;

-- huy_phieu: phiếu ĐẢO thừa kế la_demo (HX của xuat_sx demo giữ cờ demo)
CREATE OR REPLACE FUNCTION kho.huy_phieu(p_so_phieu text, p_ly_do text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare vt text; uid uuid; kid uuid; g record; sp_ng text; pid_ng uuid; vid uuid; qty numeric; rec record;
        v_dm_tt text;
begin
  vt := current_vai_tro();
  if vt is null or vt not in ('ceo','kho') then raise exception 'Chỉ CEO/kho được huỷ phiếu'; end if;
  if p_ly_do is null or btrim(p_ly_do) = '' then raise exception 'Phải nhập lý do huỷ (sổ lệch mà không rõ vì sao thì vô dụng)'; end if;
  select * into g from phieu where so_phieu = p_so_phieu;
  if not found then raise exception 'Không có phiếu %', p_so_phieu; end if;
  if g.trang_thai = 'da_huy' then raise exception 'Phiếu % đã bị huỷ rồi — không huỷ hai lần', p_so_phieu; end if;
  if g.trang_thai <> 'ghi_so' then raise exception 'Chỉ huỷ được phiếu ĐÃ GHI SỔ — phiếu % đang ở trạng thái "%"', p_so_phieu, g.trang_thai; end if;
  kid := g.kho_id;
  select id into uid from nguoi_dung where auth_uid = auth.uid();
  -- WP-21: phiếu NHẬN của đơn mua — chặn huỷ khi đơn ĐÃ nhận đủ (QD-48). Kiểm TRƯỚC mọi ghi.
  if g.don_mua_id is not null then
    select trang_thai into v_dm_tt from kho.don_mua where id = g.don_mua_id for update;
    if v_dm_tt in ('da_nhan','da_khop_hd') then
      raise exception 'DM_DA_NHAN_KHONG_HUY: đơn mua đã nhận đủ ("%") — không huỷ phiếu nhận; dùng phiếu TRẢ HÀNG NCC (QD-48)', v_dm_tt;
    end if;
  end if;
  if g.loai = 'nhap' then
    for rec in select l.con_lai, l.so_luong_nhap, v.ma from lo_nhap l join vat_tu v on v.id=l.vat_tu_id where l.phieu_id=g.id loop
      if rec.con_lai < rec.so_luong_nhap then
        raise exception 'Không huỷ được: lô của mã % đã xuất % (còn %/% cái). Phải dùng phiếu ĐIỀU CHỈNH thay vì huỷ.',
          rec.ma, (rec.so_luong_nhap - rec.con_lai), rec.con_lai, rec.so_luong_nhap; end if;
    end loop;
  end if;
  sp_ng := cap_so_phieu(case when g.loai='nhap' then 'HN' else 'HX' end);
  insert into phieu(so_phieu,loai,kho_id,trang_thai,ncc_id,ly_do,phieu_goc_id,ghi_so_luc,ghi_so_boi,nguoi_thao_tac,la_demo)
    values(sp_ng,'dieu_chinh',kid,'ghi_so',g.ncc_id,p_ly_do,g.id,now(),uid,uid,coalesce(g.la_demo,false)) returning id into pid_ng;
  insert into phieu_dong(phieu_id,vat_tu_id,so_luong,don_gia,thanh_tien,ncc_id,ly_do)
    select pid_ng, pd.vat_tu_id, -pd.so_luong, pd.don_gia, case when pd.thanh_tien is not null then -pd.thanh_tien end, pd.ncc_id, p_ly_do
    from phieu_dong pd where pd.phieu_id = g.id;
  if g.loai = 'nhap' then
    for vid in select distinct l.vat_tu_id from lo_nhap l where l.phieu_id=g.id loop
      select coalesce(sum(so_luong_nhap),0) into qty from lo_nhap where phieu_id=g.id and vat_tu_id=vid;
      update lo_nhap set lo_da_huy=true, con_lai=0 where phieu_id=g.id and vat_tu_id=vid;
      insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
        values(vid,kid,'dieu_chinh', -qty, pid_ng, 0, 'phieu', uid);
    end loop;
  else
    for rec in select lo_nhap_id, so_luong from giao_dich where phieu_id=g.id and lo_nhap_id is not null loop
      update lo_nhap set con_lai = con_lai + (-rec.so_luong) where id = rec.lo_nhap_id;
    end loop;
    for rec in select vat_tu_id as vid, sum(-so_luong) as qty from giao_dich where phieu_id=g.id group by vat_tu_id loop
      insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
        values(rec.vid,kid,'dieu_chinh', rec.qty, pid_ng, 0, 'phieu', uid);
    end loop;
  end if;
  if g.loai = 'xuat_sx' and g.mon_id is not null then
    for rec in select vat_tu_id as vid, sum(-so_luong) qty from giao_dich where phieu_id=g.id group by vat_tu_id loop
      update kho.giu_cho set so_luong_da_xuat = greatest(0, so_luong_da_xuat - rec.qty) where don_hang_mon_id=g.mon_id and vat_tu_id=rec.vid and trang_thai='mo';
    end loop;
  end if;
  update phieu set trang_thai='da_huy', sua_luc=now() where id=g.id;
  -- WP-21: đơn còn xac_nhan → trừ lại so_luong_da_nhan theo TỪNG dòng phiếu (don_mua_dong_id), ghi lịch sử huy_nhan.
  if g.don_mua_id is not null then
    for rec in select don_mua_dong_id, so_luong from phieu_dong where phieu_id=g.id and don_mua_dong_id is not null loop
      update kho.don_mua_dong set so_luong_da_nhan = greatest(0, so_luong_da_nhan - rec.so_luong) where id = rec.don_mua_dong_id;
    end loop;
    insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
      values(g.don_mua_id, uid, vt, v_dm_tt, v_dm_tt, jsonb_build_object('huy_nhan', p_so_phieu, 'phieu_dao', sp_ng));
  end if;
  return sp_ng;
end $function$;

do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='kho' and table_name='phieu' and column_name='la_demo') then raise exception 'phieu.la_demo CHƯA có'; end if;
  raise notice 'db/133 OK: phieu.la_demo bền (đảo thừa kế) + backfill.';
end $$;
commit;
