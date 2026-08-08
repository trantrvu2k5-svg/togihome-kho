-- SIẾT 014 — XUẤT KHO TRỪ THEO LÔ (nhập trước xuất trước, theo lo_nhap.tao_luc tăng dần).
--   CHỈ đổi nhánh XUẤT của ghi_so_phieu. Nhánh NHẬP + công thức giá vốn BQ: GIỮ NGUYÊN byte-identical.
--   Xuất: trừ dần con_lai từng lô cũ nhất trước; mỗi lô một dòng giao_dich (lo_nhap_id). Phần vượt tổng lô
--   -> một dòng giao_dich KHÔNG lô + cờ ton_am (chan_ton_am tắt nên vẫn ghi). Vẫn cập nhật ton.so_luong như cũ.
--   Chỉ đổi ĐỊNH NGHĨA HÀM — KHÔNG chạm dữ liệu. Chạy lại nhiều lần được.
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
      -- ── NHẬP: GIỮ NGUYÊN (byte-identical với db/008) ──
      moi := cur + sl;
      insert into lo_nhap(vat_tu_id,kho_id,phieu_id,so_luong_nhap,gia_von_lo,con_lai,nguoi_thao_tac)
        values(vid,kid,pid,sl,dg,sl,uid);
      update ton set so_luong=moi, sua_luc=now(),
        gia_von_bq = case when dg is not null then round((coalesce(cur,0)*coalesce(curgia,0)+sl*dg)/nullif(moi,0)) else curgia end
        where vat_tu_id=vid and kho_id=kid;
      -- dòng thẻ kho cho NHẬP (giữ nguyên như bản cũ)
      insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,canh_bao,nguoi_thao_tac)
        values(vid,kid,'nhap', sl, pid, moi, 'phieu', case when moi<0 then 'ton_am' end, uid);
    else
      -- ── XUẤT: TRỪ THEO LÔ FIFO (mới) ──
      moi := cur - sl;
      update ton set so_luong=moi, sua_luc=now() where vat_tu_id=vid and kho_id=kid;
      declare con numeric := sl; dsau numeric := cur; tru numeric; lg record;
      begin
        for lg in select id, con_lai from lo_nhap
                    where vat_tu_id=vid and kho_id=kid and con_lai > 0
                    order by tao_luc asc, id asc
        loop
          exit when con <= 0;
          tru := least(lg.con_lai, con);
          update lo_nhap set con_lai = con_lai - tru where id = lg.id;
          con  := con - tru;
          dsau := dsau - tru;
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,lo_nhap_id,so_du_sau,nguon,nguoi_thao_tac)
            values(vid,kid,'xuat', -tru, pid, lg.id, dsau, 'phieu', uid);
        end loop;
        if con > 0 then
          -- vượt tổng lô: phần dư không thuộc lô nào, gắn cờ ton_am (không chặn vì chan_ton_am tắt)
          dsau := dsau - con;
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,canh_bao,nguoi_thao_tac)
            values(vid,kid,'xuat', -con, pid, dsau, 'phieu', 'ton_am', uid);
          am := am || vid::text;
        end if;
      end;
    end if;
  end loop;
  return jsonb_build_object('so_phieu', sp, 'ton_am', am);
end $$;

commit;
