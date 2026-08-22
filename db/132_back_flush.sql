-- 132 — BACK-FLUSH (WP-33, QD-54). ERP §6.5.2: vật tư tự ghi XUẤT khi công đoạn sau báo xong (cắt→ván, lắp→phụ kiện).
--   Định mức lượng = BOM chuẩn × (1 + hao hụt) làm tròn (Garrison ch.9). MỘT ĐƯỜNG qua ghi_so_phieu (loai 'xuat_sx', nguon 'quet_tem').
--   Tồn âm KHÔNG chặn (tín hiệu đếm sai — WP-14/42). BOM 'thuc_te' = TỪ SỔ (không ghi dòng — QD-50). REVOKE gd_tho_quet (hẹn QD-44).
--   ⚠ IDEMPOTENT. HOÀN TÁC: chạy lại db/119(ghi_so_phieu/huy_phieu)+db/074(sq_ghi)+db/125(xoa_demo)+db/131(bom_don_ds);
--     drop function xuat_back_flush,lam_tron_xuat,la_nhom_van; drop view v_bom_thuc_te;
--     alter table phieu drop column mon_id,su_kien_quet_id,nhom_back_flush,la_demo; phieu_dong drop 3 cột; vat_tu drop hao_hut_pct;
--     alter table phieu drop constraint phieu_loai_check, add ... (nhap,xuat,dieu_chinh); create policy gd_tho_quet ...
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ §1a · phieu/phieu_dong cột mới + loai 'xuat_sx' ═══════════
alter table kho.phieu drop constraint if exists phieu_loai_check;
alter table kho.phieu add constraint phieu_loai_check check (loai in ('nhap','xuat','dieu_chinh','xuat_sx'));
alter table kho.phieu add column if not exists mon_id uuid references kho.don_hang_mon(id);
alter table kho.phieu drop constraint if exists phieu_mon_id_fkey;
alter table kho.phieu add constraint phieu_mon_id_fkey foreign key (mon_id) references kho.don_hang_mon(id) on delete set null;
alter table kho.phieu add column if not exists su_kien_quet_id uuid;
alter table kho.phieu add column if not exists nhom_back_flush text;
alter table kho.phieu add column if not exists la_demo boolean not null default false;
grant select (mon_id,su_kien_quet_id,nhom_back_flush,la_demo) on kho.phieu to authenticated;
create unique index if not exists phieu_uq_backflush on kho.phieu(mon_id, nhom_back_flush) where loai='xuat_sx' and trang_thai<>'da_huy';
create index if not exists phieu_idx_mon on kho.phieu(mon_id) where mon_id is not null;
alter table kho.phieu_dong add column if not exists so_luong_chuan numeric;
alter table kho.phieu_dong add column if not exists hao_hut_pct_ap_dung numeric;
alter table kho.phieu_dong add column if not exists so_du_lam_tron numeric;

-- ═══════════ §1b · hao_hut_pct + predicate nhóm ván + làm tròn ═══════════
alter table kho.vat_tu add column if not exists hao_hut_pct numeric(5,2) not null default 0 check (hao_hut_pct between 0 and 100);
create or replace function kho.la_nhom_van(p_nhom uuid) returns boolean language sql stable as $lnv$
  select exists(select 1 from kho.nhom where id = p_nhom and ten ~* '(gỗ|mdf|plywood|ván)')
$lnv$;
update kho.vat_tu set hao_hut_pct = 10 where kho.la_nhom_van(nhom_id) and hao_hut_pct = 0;   -- [GĐ] ván 10%
create or replace function kho.lam_tron_xuat(p_so numeric, p_don_vi text) returns numeric language sql immutable as $ltx$
  select case when p_don_vi in ('tam','cai','cay','bo','chiec','thanh','cuon') then ceil(p_so) else round(p_so, 3) end
$ltx$;

-- ═══════════ §2 · xuat_back_flush (chỉ nội bộ qua GUC) ═══════════
create or replace function kho.xuat_back_flush(p_mon_id uuid, p_nhom text, p_su_kien_id uuid)
  returns jsonb language plpgsql security definer set search_path = kho as $bf$
declare v_don record; v_dong jsonb := '[]'::jsonb; d record; v_res jsonb; v_sp text; v_pid uuid; v_xuat numeric;
begin
  if coalesce(current_setting('kho.back_flush_he_thong', true),'') <> '1' then
    raise exception 'xuat_back_flush: chỉ gọi nội bộ khi quét (GUC), không gọi trực tiếp'; end if;
  select m.id mon_id, dh.id don_id, dh.ma_don, coalesce(dh.la_demo,false) la_demo into v_don
    from kho.don_hang_mon m join kho.don_hang dh on dh.id=m.don_id where m.id=p_mon_id;
  if v_don.mon_id is null then return jsonb_build_object('ket_qua','bo_qua','ly_do','món không tồn tại'); end if;
  if exists(select 1 from kho.phieu where mon_id=p_mon_id and nhom_back_flush=p_nhom and loai='xuat_sx' and trang_thai<>'da_huy') then
    return jsonb_build_object('ket_qua','da_xuat_truoc'); end if;
  for d in
    select b.vat_tu_id, v.don_vi_co_so, v.hao_hut_pct, sum(b.so_luong_co_so) chuan
    from kho.don_hang_mon_bom b join kho.vat_tu v on v.id=b.vat_tu_id
    where b.mon_id=p_mon_id and b.moc='chuan'
      and ((p_nhom='van' and kho.la_nhom_van(v.nhom_id)) or (p_nhom='phu_kien' and not kho.la_nhom_van(v.nhom_id)))
    group by b.vat_tu_id, v.don_vi_co_so, v.hao_hut_pct
  loop
    v_xuat := kho.lam_tron_xuat(d.chuan * (1 + d.hao_hut_pct/100), d.don_vi_co_so);
    v_dong := v_dong || jsonb_build_object('vat_tu_id', d.vat_tu_id, 'so_luong', v_xuat,
      'so_luong_chuan', d.chuan, 'hao_hut_pct_ap_dung', d.hao_hut_pct,
      'so_du_lam_tron', v_xuat - d.chuan*(1 + d.hao_hut_pct/100));
  end loop;
  if jsonb_array_length(v_dong) = 0 then return jsonb_build_object('ket_qua','bo_qua','ly_do','món không có dòng BOM nhóm '||p_nhom); end if;
  v_res := kho.ghi_so_phieu('xuat_sx', null, 'Back-flush '||p_nhom||' (quét)', null, v_dong, null);
  v_sp := v_res->>'so_phieu'; v_pid := (v_res->>'phieu_id')::uuid;
  update kho.phieu set ma_don=v_don.ma_don, mon_id=p_mon_id, su_kien_quet_id=p_su_kien_id, nhom_back_flush=p_nhom, la_demo=v_don.la_demo where id=v_pid;
  for d in select (x->>'vat_tu_id')::uuid vid, (x->>'so_luong')::numeric sl from jsonb_array_elements(v_dong) x loop
    update kho.giu_cho set so_luong_da_xuat = least(so_luong_giu, so_luong_da_xuat + d.sl)
      where don_hang_mon_id=p_mon_id and vat_tu_id=d.vid and trang_thai='mo';
  end loop;
  return jsonb_build_object('ket_qua','xuat', 'phieu_so', v_sp, 'dong', v_dong);
end $bf$;
revoke all on function kho.xuat_back_flush(uuid,text,uuid) from public, anon;
grant execute on function kho.xuat_back_flush(uuid,text,uuid) to authenticated;

-- ═══════════ §1c · ghi_so_phieu (mở rộng xuat_sx) ═══════════
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
      insert into lo_nhap(vat_tu_id,kho_id,phieu_id,so_luong_nhap,gia_von_lo,con_lai,nguoi_thao_tac)
        values(vid,kid,pid,sl,dg,sl,uid);
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
grant execute on function kho.ghi_so_phieu(text,uuid,text,text,jsonb,text) to authenticated;

-- ═══════════ §2b · huy_phieu (hoàn giữ chỗ xuat_sx) ═══════════
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
  insert into phieu(so_phieu,loai,kho_id,trang_thai,ncc_id,ly_do,phieu_goc_id,ghi_so_luc,ghi_so_boi,nguoi_thao_tac)
    values(sp_ng,'dieu_chinh',kid,'ghi_so',g.ncc_id,p_ly_do,g.id,now(),uid,uid) returning id into pid_ng;
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

-- ═══════════ §3 · sq_ghi (nối back-flush) ═══════════
CREATE OR REPLACE FUNCTION kho.sq_ghi(p_tem text, p_tram text, p_loai_ep text, p_nguon text, p_ghi_bu_cho timestamp with time zone, p_ly_do text, p_so_hong numeric, p_so_lam_lai numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_qt text; v_nhieu boolean; v_ns uuid; v_tt text; v_loai text; v_buoc record; v_thieu text;
        p int; v_pre_hd text; v_pre_nhanh text; v_nhanh text; v_sk uuid; v_bf jsonb := null; v_hd text; v_mon uuid;
begin
  select nguoi_id into v_ns from kho.ca_lam where ma_tram = p_tram and ket_thuc is null order by bat_dau limit 1;
  v_loai := coalesce(p_loai_ep, 'vao');
  if not exists (select 1 from kho.tem_ban_ve where ma_tam = p_tem) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TEM_LA', 'tem không có trong hệ thống'); end if;
  if not exists (select 1 from kho.tram where ma_tram = p_tram and dang_dung) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_TAT', 'trạm không dùng được'); end if;
  v_loai := coalesce(p_loai_ep,
    case when (select count(*) filter (where loai='vao') - count(*) filter (where loai='ra')
               from kho.su_kien_quet where tem_ma=p_tem and ma_tram=p_tram and ket_qua='nhan') > 0 then 'ra' else 'vao' end);
  if v_ns is null then
    return kho.sq_chan(p_tem, p_tram, null, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_CO_CA', 'chưa ai mở ca ở trạm này'); end if;
  v_tt := coalesce(kho.sq_tram_trang_thai(p_tram), 'chay');
  if v_tt <> 'chay' then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_KHONG_CHAY', 'trạm đang "'||v_tt||'", không chạy'); end if;
  select qt, nhieu into v_qt, v_nhieu from kho.sq_qt_cua_tem(p_tem);
  if v_nhieu then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'NHIEU_QUY_TRINH', 'đơn này có nhiều quy trình, cần gán tấm vào món trước'); end if;
  if v_qt is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_QUY_TRINH', 'sản phẩm này chưa có quy trình sản xuất'); end if;
  select b.thu_tu, b.buoc_truoc into v_buoc
    from kho.quy_trinh_buoc b join kho.tram t on t.ma_tram = p_tram
    where b.ma_quy_trinh = v_qt and b.hoat_dong = t.hoat_dong limit 1;
  if v_buoc.thu_tu is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'SAI_TRAM', 'quy trình không có bước cho trạm này'); end if;
  v_nhanh := kho.nhanh_cua_tem(p_tem) ->> 'nhanh';
  v_thieu := null;
  foreach p in array coalesce(v_buoc.buoc_truoc, array[]::int[]) loop
    select b.hoat_dong, b.nhanh into v_pre_hd, v_pre_nhanh
      from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt and b.thu_tu = p;
    if v_nhanh = 'chung' or v_pre_nhanh = 'chung' or v_pre_nhanh = v_nhanh then
      if not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
        where sq.tem_ma = p_tem and sq.loai = 'ra' and sq.ket_qua = 'nhan' and t.hoat_dong = v_pre_hd) then
        v_thieu := concat_ws(', ', v_thieu, (select ten from kho.don_gia_baseline where hoat_dong = v_pre_hd));
      end if;
    end if;
  end loop;
  if v_thieu is not null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'NHAY_BUOC', 'tấm này chưa qua ' || v_thieu); end if;

  -- ĐỦ guard → ghi NHẬN
  insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,nguon,ghi_bu_cho,ly_do_chan,so_hong,so_lam_lai)
    values (p_tem, p_tram, v_ns, v_loai, 'nhan', p_nguon, p_ghi_bu_cho, case when p_nguon='tay' then p_ly_do else null end,
            coalesce(p_so_hong,0), coalesce(p_so_lam_lai,0)) returning id into v_sk;
  perform kho.capnhat_tien_do_tem(p_tem);
  -- WP-33: back-flush ván (cắt) / phụ kiện (lắp) — lần đầu tem qua trạm; idempotent qua unique index. QD-18: lỗi KHÔNG hỏng ghi sổ quét.
  select t.hoat_dong into v_hd from kho.tram t where t.ma_tram = p_tram;
  select mon_id into v_mon from kho.tem_ban_ve where ma_tam = p_tem;
  if v_mon is not null and v_hd in ('cat','thung','canh','ray','cup','cam','giuong_lap') then
    begin
      perform set_config('kho.back_flush_he_thong','1',true);
      v_bf := kho.xuat_back_flush(v_mon, case when v_hd='cat' then 'van' else 'phu_kien' end, v_sk);
      perform set_config('kho.back_flush_he_thong','',true);
    exception when others then v_bf := jsonb_build_object('ket_qua','loi','loi',left(SQLERRM,120)); end;
  end if;
  return jsonb_build_object('ok', true, 'loai', v_loai, 'ket_qua', 'nhan', 'nguoi_id', v_ns, 'buoc', v_buoc.thu_tu, 'nhanh', v_nhanh, 'back_flush', v_bf);
end $function$;

-- ═══════════ §4 · bom_don_ds + thuc_te · view v_bom_thuc_te ═══════════
drop function if exists kho.bom_don_ds(uuid,text);
CREATE OR REPLACE FUNCTION kho.bom_don_ds(p_don_id uuid, p_moc text DEFAULT 'du_kien'::text)
 RETURNS TABLE(mon_id uuid, ten_mon text, vat_tu_id uuid, ma text, ten text, don_vi text, so_luong numeric, so_luong_co_so numeric, don_vi_co_so text, nguon text, hoat_dong text, chot_luc timestamp with time zone, nguon_bom text, co_bom boolean, thuc_te numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
 SET jit TO 'off'
AS $function$
begin
  if kho.current_vai_tro() is null then raise exception 'bom_don_ds: chưa đăng nhập'; end if;
  if p_moc not in ('du_kien','chuan') then raise exception 'bom_don_ds: mốc phải du_kien/chuan'; end if;
  return query
  select m.id, m.ten, b.vat_tu_id, v.ma, v.ten, b.don_vi, b.so_luong, b.so_luong_co_so, v.don_vi_co_so, b.nguon, b.hoat_dong, b.chot_luc,
         (select case when bool_or(bb.nguon='cutlist') then 'cutlist' when bool_or(bb.nguon='go_tay') then 'go_tay' when bool_or(bb.nguon='uoc') then 'uoc' end
          from kho.don_hang_mon_bom bb where bb.mon_id = m.id and bb.moc = p_moc) as nguon_bom,
         (b.id is not null) as co_bom,
         (select coalesce(sum(-gd.so_luong),0) from kho.giao_dich gd join kho.phieu p on p.id=gd.phieu_id
           where p.mon_id=m.id and gd.vat_tu_id=b.vat_tu_id and gd.nguon='quet_tem' and p.loai='xuat_sx' and p.trang_thai<>'da_huy') as thuc_te
  from kho.don_hang_mon m
  left join kho.don_hang_mon_bom b on b.mon_id = m.id and b.moc = p_moc
  left join kho.vat_tu v on v.id = b.vat_tu_id
  where m.don_id = p_don_id
  order by m.tao_luc, m.id, case b.nguon when 'cutlist' then 1 when 'go_tay' then 2 else 3 end nulls last, v.ma nulls last;
end $function$;
revoke all on function kho.bom_don_ds(uuid,text) from public, anon; grant execute on function kho.bom_don_ds(uuid,text) to authenticated;
create or replace view kho.v_bom_thuc_te as
  select p.mon_id, gd.vat_tu_id, sum(-gd.so_luong) thuc_te
  from kho.giao_dich gd join kho.phieu p on p.id=gd.phieu_id
  where gd.nguon='quet_tem' and p.loai='xuat_sx' and p.trang_thai<>'da_huy' and p.mon_id is not null
  group by p.mon_id, gd.vat_tu_id;
grant select on kho.v_bom_thuc_te to authenticated;

-- ═══════════ §6 · xoa_demo (huỷ xuat_sx demo bằng đảo) ═══════════
CREATE OR REPLACE FUNCTION kho.xoa_demo(p_ma_don text DEFAULT NULL::text, p_xac_nhan text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho', 'public'
AS $function$
declare v_targets text[]; v_ids uuid[]; r jsonb := '{}'::jsonb; n int;
  v_global boolean := (p_ma_don is null); v_sp_huy text;
begin
  if coalesce(kho.current_vai_tro(),'') <> 'ceo' then raise exception 'xoa_demo: chỉ CEO'; end if;
  if v_global then
    if coalesce(p_xac_nhan,'') <> 'XOA_HET' then
      raise exception 'xoa_demo TOÀN BỘ demo cần p_xac_nhan=''XOA_HET'' (xoá cả seed cũ)'; end if;
    select array_agg(ma_don) into v_targets from kho.don_hang where la_demo = true;
  else
    if not exists(select 1 from kho.don_hang where ma_don = p_ma_don and la_demo = true) then
      raise exception 'xoa_demo: đơn % không tồn tại hoặc KHÔNG phải demo (la_demo=false)', p_ma_don; end if;
    v_targets := array[p_ma_don];
  end if;
  v_targets := coalesce(v_targets, '{}');
  select array_agg(id) into v_ids from kho.don_hang where ma_don = any(v_targets);

  perform set_config('kho.xoa_demo','1',true);   -- D8: mở cổng bypass MOC_CHUAN_DA_CHOT cho đơn demo (local tx)

  delete from kho.su_kien_quet where tem_ma in (select tem_ma from kho.tien_do_tem where ma_don = any(v_targets)); get diagnostics n = row_count; r := r || jsonb_build_object('su_kien_quet', n);
  delete from kho.tien_do_tem where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tien_do_tem', n);
  delete from kho.tem_da_in where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tem_da_in', n);
  delete from kho.lan_in_tem where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('lan_in_tem', n);
  delete from kho.don_hang_mon_nhat_ky where don_id = any(v_ids); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang_mon_nhat_ky', n);
  for v_sp_huy in select so_phieu from kho.phieu where ma_don = any(v_targets) and loai='xuat_sx' and trang_thai='ghi_so' loop
    perform kho.huy_phieu(v_sp_huy, 'xoa demo (WP-33 đảo sổ)'); end loop;
  update kho.phieu set ma_don = null where ma_don = any(v_targets);
  -- D8: xoá SỐ CHỐT của món demo TRƯỚC khi xoá don_hang — lúc này don_hang/don_hang_mon CÒN → trigger tra la_demo=true
  --   → bypass. Nếu để CASCADE (don_hang→don_hang_mon→so_don_vi_mon) thì khi trigger chạy parent đã bị xoá,
  --   join la_demo=NULL → CHẶN. Bypass CHỈ áp cho món của đơn demo (GUC đã bật ở trên).
  delete from kho.so_don_vi_mon where mon_id in (select id from kho.don_hang_mon where don_id = any(v_ids)); get diagnostics n = row_count; r := r || jsonb_build_object('so_don_vi_mon', n);
  delete from kho.don_hang where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang', n);
  delete from kho.khach where la_demo = true and sdt not in (select sdt_khach from kho.don_hang where sdt_khach is not null); get diagnostics n = row_count; r := r || jsonb_build_object('khach', n);
  if v_global then
    delete from kho.phieu_dem_ngay where la_demo = true; get diagnostics n = row_count; r := r || jsonb_build_object('phieu_dem_ngay', n);
  end if;
  return jsonb_build_object('ok', true, 'pham_vi', case when v_global then 'TOAN_BO' else p_ma_don end, 'xoa', r);
end $function$;
grant execute on function kho.xoa_demo(text,text) to authenticated;

-- ═══════════ §5 · REVOKE gd_tho_quet (không code nào dùng — QD-44) ═══════════
drop policy if exists gd_tho_quet on kho.giao_dich;

do $$ begin
  if to_regprocedure('kho.xuat_back_flush(uuid,text,uuid)') is null then raise exception 'xuat_back_flush CHƯA tạo'; end if;
  if exists(select 1 from pg_policy where polname='gd_tho_quet') then raise exception 'gd_tho_quet CHƯA revoke'; end if;
  raise notice 'db/132 OK: back-flush (xuat_sx) + hao_hut_pct + lam_tron_xuat + bom thuc_te + revoke gd_tho_quet.';
end $$;
commit;
