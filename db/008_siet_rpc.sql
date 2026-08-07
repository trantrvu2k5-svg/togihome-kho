-- KHO-1 sửa — SIẾT hàm RPC: Postgres mặc định cấp EXECUTE cho PUBLIC -> anon gọi được mọi hàm.
--   ghi_so_phieu còn thiếu guard NULL (anon vai_tro=null, `null not in (...)`=null -> không raise).
--   Vá cả hai bệnh cho MỌI hàm trong schema kho.
begin;

-- 1) VÁ guard NULL trong ghi_so_phieu (recreate; thêm `vt is null or`).
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

-- 2) Chặn PUBLIC gọi MỌI hàm; grant lại tối thiểu.
revoke execute on all functions in schema kho from public, anon, authenticated;
grant execute on function kho.current_vai_tro() to anon, authenticated;          -- RLS policy gọi (cả 2 role)
grant execute on function kho.quet_giao_dich(text,text,numeric) to authenticated;
grant execute on function kho.ghi_so_phieu(text,uuid,text,text,jsonb) to authenticated;
-- cap_so_phieu: KHÔNG cấp cho ai (chỉ ghi_so_phieu security-definer gọi, chạy dưới owner).
alter default privileges in schema kho revoke execute on functions from public;   -- hàm mới không tự cấp public

-- 3) KIỂM tự RAISE.
do $$
begin
  -- (a) PUBLIC không gọi được hàm nào
  if has_function_privilege('public','kho.quet_giao_dich(text,text,numeric)','EXECUTE')            then raise exception 'HỎNG: PUBLIC gọi được quet_giao_dich'; end if;
  if has_function_privilege('public','kho.ghi_so_phieu(text,uuid,text,text,jsonb)','EXECUTE')      then raise exception 'HỎNG: PUBLIC gọi được ghi_so_phieu'; end if;
  if has_function_privilege('public','kho.cap_so_phieu(text)','EXECUTE')                           then raise exception 'HỎNG: PUBLIC gọi được cap_so_phieu'; end if;
  if has_function_privilege('public','kho.current_vai_tro()','EXECUTE')                            then raise exception 'HỎNG: PUBLIC gọi được current_vai_tro'; end if;
  -- (b) anon KHÔNG gọi được 2 hàm ghi + cap_so_phieu (== anon gọi RA LỖI permission)
  if has_function_privilege('anon','kho.quet_giao_dich(text,text,numeric)','EXECUTE')              then raise exception 'HỎNG: anon gọi được quet_giao_dich'; end if;
  if has_function_privilege('anon','kho.ghi_so_phieu(text,uuid,text,text,jsonb)','EXECUTE')        then raise exception 'HỎNG: anon gọi được ghi_so_phieu'; end if;
  if has_function_privilege('anon','kho.cap_so_phieu(text)','EXECUTE')                             then raise exception 'HỎNG: anon gọi được cap_so_phieu'; end if;
  -- (c) authenticated GIỮ quet/ghi; anon+auth GIỮ current_vai_tro (không thì RLS vỡ)
  if not has_function_privilege('authenticated','kho.quet_giao_dich(text,text,numeric)','EXECUTE')       then raise exception 'HỎNG: authenticated mất quet_giao_dich'; end if;
  if not has_function_privilege('authenticated','kho.ghi_so_phieu(text,uuid,text,text,jsonb)','EXECUTE') then raise exception 'HỎNG: authenticated mất ghi_so_phieu'; end if;
  if not has_function_privilege('authenticated','kho.current_vai_tro()','EXECUTE')                 then raise exception 'HỎNG: authenticated mất current_vai_tro'; end if;
  if not has_function_privilege('anon','kho.current_vai_tro()','EXECUTE')                          then raise exception 'HỎNG: anon mất current_vai_tro (RLS vỡ)'; end if;
  raise notice 'OK 008: PUBLIC/anon KHÔNG gọi hàm ghi + cap_so_phieu; authenticated giữ quet/ghi; anon+auth giữ current_vai_tro; ghi_so_phieu đã vá guard NULL';
end $$;

commit;
