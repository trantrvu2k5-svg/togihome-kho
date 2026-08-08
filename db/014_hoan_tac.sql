-- HOÀN TÁC 014 — đưa ghi_so_phieu về ĐÚNG bản hiện tại (db/008): nhánh xuất chỉ trừ ton.so_luong, không trừ lô.
-- Phao cứu sinh. Chạy lại nhiều lần được (create or replace). Chỉ đổi ĐỊNH NGHĨA HÀM, không chạm dữ liệu.
--   node ops/run_sql.mjs ../db/014_hoan_tac.sql   (hoặc Supabase SQL Editor)
begin;

create or replace function kho.ghi_so_phieu(p_loai text, p_ncc uuid, p_ly_do text, p_ghi_chu text, p_dong jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare vt text; sp text; pid uuid; kid uuid; uid uuid; d jsonb;
        vid uuid; sl numeric; dg numeric; cur numeric; curgia numeric; moi numeric; am text[] := '{}';
begin
  vt := current_vai_tro();
  if vt is null or vt not in ('ceo','kho') then raise exception 'Chỉ CEO/kho được ghi sổ'; end if;
  if p_loai not in ('nhap','xuat') then raise exception 'loai phải nhap/xuat'; end if;
  select id into kid from kho where la_mac_dinh limit 1;
  select id into uid from nguoi_dung where auth_uid = auth.uid();
  sp := cap_so_phieu(case when p_loai='nhap' then 'NK' else 'XK' end);
  insert into phieu(so_phieu,loai,kho_id,trang_thai,ncc_id,ly_do,ghi_so_luc,ghi_so_boi,nguoi_thao_tac)
    values(sp,p_loai,kid,'ghi_so',p_ncc,p_ly_do,now(),uid,uid) returning id into pid;
  for d in select * from jsonb_array_elements(p_dong) loop
    vid := (d->>'vat_tu_id')::uuid; sl := (d->>'so_luong')::numeric; dg := nullif(d->>'don_gia','')::numeric;
    if sl is null or sl <= 0 then continue; end if;
    insert into phieu_dong(phieu_id,vat_tu_id,so_luong,don_gia,thanh_tien,ncc_id,ly_do)
      values(pid,vid,sl,dg, case when dg is not null then sl*dg end, p_ncc, p_ly_do);
    select so_luong,gia_von_bq into cur,curgia from ton where vat_tu_id=vid and kho_id=kid;
    if not found then insert into ton(vat_tu_id,kho_id,so_luong) values(vid,kid,0); cur:=0; curgia:=null; end if;
    if p_loai='nhap' then
      moi := cur + sl;
      insert into lo_nhap(vat_tu_id,kho_id,phieu_id,so_luong_nhap,gia_von_lo,con_lai,nguoi_thao_tac)
        values(vid,kid,pid,sl,dg,sl,uid);
      update ton set so_luong=moi, sua_luc=now(),
        gia_von_bq = case when dg is not null then round((coalesce(cur,0)*coalesce(curgia,0)+sl*dg)/nullif(moi,0)) else curgia end
        where vat_tu_id=vid and kho_id=kid;
    else
      moi := cur - sl;
      update ton set so_luong=moi, sua_luc=now() where vat_tu_id=vid and kho_id=kid;
      if moi < 0 then am := am || vid::text; end if;
    end if;
    insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,canh_bao,nguoi_thao_tac)
      values(vid,kid,p_loai, case when p_loai='nhap' then sl else -sl end, pid, moi, 'phieu',
             case when moi<0 then 'ton_am' end, uid);
  end loop;
  return jsonb_build_object('so_phieu', sp, 'ton_am', am);
end $$;

commit;
