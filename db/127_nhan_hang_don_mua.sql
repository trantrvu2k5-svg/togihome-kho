-- 127 — NHẬN HÀNG ĐƠN MUA → SỔ KHO (WP-21). MỘT ĐƯỜNG GHI: dm_nhan_hang gọi ghi_so_phieu (QD-03/QD-44).
--   CĂN CỨ: ERP Sagegg&Alfnes §4.4 (nhận hàng đối chiếu PO) + §3.3.5 (tồn suy từ sổ) + QD-44 (một đường ghi) + QD-48 (đơn mua).
--   Nhận một phần → đơn GIỮ xac_nhan; nhận đủ → tự chuyển da_nhan (GUC kho.dm_he_thong). Vượt số đặt → CHẶN, không ghi gì.
--   Giá lô = đơn giá dòng đơn (→ gia_von_lo) — TẠM tới WP-22/13. Huỷ phiếu nhận chỉ khi đơn CHƯA da_nhan (QD-48).
--   Điện thoại & máy tính DÙNG CHUNG dm_nhan_hang (không đường ghi thứ hai).
--
--   ⚠ IDEMPOTENT: add column/constraint if not exists · drop function đúng chữ ký rồi create · create or replace.
--   ⚠ KHÔNG viết đường ghi sổ thứ hai: ghi_so_phieu được MỞ RỘNG (thêm p_kho tuỳ chọn + ghi_chu/đơn-mua theo dòng
--     + trả phieu_id) — vắng tham số mới = HÀNH VI CŨ y nguyên. Mọi caller cũ (named + positional ≤6) vẫn khớp qua default.
-- HOÀN TÁC: drop function dm_nhan_hang; chạy lại db/119 (ghi_so_phieu 6 tham số + huy_phieu bản không-đụng-ton);
--   alter table phieu drop column don_mua_id; alter table phieu_dong drop column don_mua_dong_id;
--   alter table don_mua_dong drop constraint dmd_da_nhan_trong_khoang.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ 1a · CẤU TRÚC ═══════════
-- phiếu (nhập) gắn đơn mua nguồn (WP-21). NULL = phiếu nhập tay như cũ.
alter table kho.phieu add column if not exists don_mua_id uuid references kho.don_mua(id);
create index if not exists phieu_idx_don_mua on kho.phieu(don_mua_id) where don_mua_id is not null;
grant select (don_mua_id) on kho.phieu to authenticated;   -- app đọc/embed chip nguồn (cột mới không tự thừa quyền cột)

-- dòng phiếu ↔ dòng đơn (để HUỶ nhận trừ lại ĐÚNG dòng, không đoán theo vat_tu khi trùng mã).
alter table kho.phieu_dong add column if not exists don_mua_dong_id uuid references kho.don_mua_dong(id);
grant select (don_mua_dong_id) on kho.phieu_dong to authenticated;

-- đã nhận không âm, không vượt đặt (backstop DB; RPC chặn trước với thông điệp rõ).
do $$ begin
  if not exists (select 1 from pg_constraint where conname='dmd_da_nhan_trong_khoang' and conrelid='kho.don_mua_dong'::regclass) then
    alter table kho.don_mua_dong add constraint dmd_da_nhan_trong_khoang check (so_luong_da_nhan between 0 and so_luong);
  end if;
end $$;

-- ═══════════ 1b · ghi_so_phieu (MỞ RỘNG TẠI CHỖ — GIỮ chữ ký 6 tham số, KHÔNG overload) ═══════════
--   CHỈ đọc thêm THEO DÒNG trong p_dong: 'ghi_chu' (→ phieu_dong.ly_do, fallback ly_do chung) + 'don_mua_dong_id';
--   trả thêm 'phieu_id'. KHÔNG thêm tham số → byte-identical caller cũ; test_037 áp lại db/037 (cùng chữ ký) KHÔNG đụng.
--   (Kho vẫn MẶC ĐỊNH như cũ — xưởng 1 kho; dm_nhan_hang GUARD don_mua.kho_id = kho mặc định để không nhận nhầm kho.)
create or replace function kho.ghi_so_phieu(p_loai text, p_ncc uuid, p_ly_do text, p_ghi_chu text, p_dong jsonb, p_ma_to text default null)
  returns jsonb language plpgsql security definer set search_path to 'kho' as $function$
declare vt text; sp text; pid uuid; kid uuid; uid uuid; d jsonb;
        vid uuid; sl numeric; dg numeric; cur numeric; moi numeric; am text[] := '{}';
begin
  vt := current_vai_tro();
  if vt is null or vt not in ('ceo','kho') then raise exception 'Chỉ CEO/kho được ghi sổ'; end if;
  if p_loai not in ('nhap','xuat') then raise exception 'loai phải nhap/xuat'; end if;
  if p_loai = 'xuat' and p_ma_to is null then raise exception 'Phiếu xuất phải chọn TỔ nhận'; end if;
  select id into kid from kho where la_mac_dinh limit 1;
  select id into uid from nguoi_dung where auth_uid = auth.uid();
  sp := cap_so_phieu(case when p_loai='nhap' then 'NK' else 'XK' end);
  insert into phieu(so_phieu,loai,kho_id,trang_thai,ncc_id,ly_do,ma_to,ghi_so_luc,ghi_so_boi,nguoi_thao_tac)
    values(sp,p_loai,kid,'ghi_so',p_ncc,p_ly_do,p_ma_to,now(),uid,uid) returning id into pid;
  for d in select * from jsonb_array_elements(p_dong) loop
    vid := (d->>'vat_tu_id')::uuid; sl := (d->>'so_luong')::numeric; dg := nullif(d->>'don_gia','')::numeric;
    if sl is null or sl <= 0 then continue; end if;
    insert into phieu_dong(phieu_id,vat_tu_id,so_luong,don_gia,thanh_tien,ncc_id,ly_do,don_mua_dong_id)
      values(pid,vid,sl,dg, case when dg is not null then sl*dg end, p_ncc,
             coalesce(nullif(d->>'ghi_chu',''), p_ly_do), (d->>'don_mua_dong_id')::uuid);   -- ghi_chu theo dòng (fallback ly_do chung)
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
            values(vid,kid,'xuat', -tru, pid, lg.id, 0, 'phieu', uid);
        end loop;
        if con > 0 then
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
            values(vid,kid,'xuat', -con, pid, 0, 'phieu', uid);
        end if;
      end;
      if moi < 0 then am := am || vid::text; end if;
    end if;
  end loop;
  return jsonb_build_object('so_phieu', sp, 'phieu_id', pid, 'ton_am', am);   -- + phieu_id (WP-21); caller cũ đọc .so_phieu vẫn ổn
end $function$;
comment on function kho.ghi_so_phieu(text,uuid,text,text,jsonb,text) is 'QD-44+WP-21: 1 đường ghi (giao_dich+lo); dòng đọc ghi_chu/don_mua_dong_id tuỳ chọn; trả phieu_id';
grant execute on function kho.ghi_so_phieu(text,uuid,text,text,jsonb,text) to authenticated;

-- ═══════════ 1c · huy_phieu (dựa BẢN db/119 không-đụng-ton) + móc đơn mua ═══════════
create or replace function kho.huy_phieu(p_so_phieu text, p_ly_do text)
  returns text language plpgsql security definer set search_path to 'kho' as $function$
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
comment on function kho.huy_phieu(text,text) is 'QD-43+44+WP-21: huỷ = dòng đảo + đảo lô; phiếu nhận đơn mua trừ lại da_nhan (chặn khi đơn da_nhan)';

-- ═══════════ 1b(2) · dm_nhan_hang — RPC CHÍNH ═══════════
create or replace function kho.dm_nhan_hang(p_don_mua_id uuid, p_dong jsonb, p_ngay date default current_date)
  returns jsonb language plpgsql security definer set search_path = kho as $function$
declare
  v_vai text := coalesce(current_vai_tro(),'');
  v_dm record; d jsonb; v_dd record;
  v_dong_id uuid; v_sl numeric; v_ghi text;
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
    v_ghi_dong := v_ghi_dong || jsonb_build_object('vat_tu_id', v_dd.vat_tu_id, 'so_luong', v_sl,
      'don_gia', v_dd.don_gia, 'ghi_chu', v_ghi, 'don_mua_dong_id', v_dd.id);
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
comment on function kho.dm_nhan_hang(uuid,jsonb,date) is 'WP-21/QD-49: nhận hàng đơn mua = phiếu nhập tự sinh (ghi_so_phieu) gắn don_mua_id; một phần giữ xac_nhan, đủ→da_nhan; vượt→chặn';
revoke all on function kho.dm_nhan_hang(uuid,jsonb,date) from public, anon;
grant execute on function kho.dm_nhan_hang(uuid,jsonb,date) to authenticated;

-- ═══════════ 1e · dm_danh_sach + TIẾN ĐỘ NHẬN (thêm dong_da_nhan; giữ mọi field cũ) ═══════════
create or replace function kho.dm_danh_sach(p_trang_thai text default null, p_ncc uuid default null, p_tim text default null)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ds jsonb;
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'dm_danh_sach: chỉ kho/ceo/ke_toan'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'so_don',b.so_don,'ncc',b.ncc,'ncc_id',b.ncc_id,'kho',b.kho,
      'ngay_dat',b.ngay_dat,'ngay_can',b.ngay_can,'ngay_ncc_hen',b.ngay_ncc_hen,'trang_thai',b.trang_thai,
      'so_dong',b.so_dong,'dong_da_nhan',b.dong_du,'tam_tinh',b.tam,
      'co_qua_ngay_can', b.trang_thai in ('da_gui','xac_nhan') and coalesce(b.ngay_ncc_hen,b.ngay_can) < current_date)
      order by b.ngay_dat desc, b.so_don), '[]'::jsonb) into v_ds
  from (
    select d.id, d.so_don, n.ten ncc, d.ncc_id, k.ten kho, d.ngay_dat, d.ngay_can, d.ngay_ncc_hen, d.trang_thai,
           dg.so_dong, dg.dong_du, dg.tam
    from kho.don_mua d join kho.nha_cung_cap n on n.id=d.ncc_id join kho.kho k on k.id=d.kho_id
    left join lateral (select count(*) so_dong, count(*) filter (where so_luong_da_nhan >= so_luong) dong_du,
                       coalesce(sum(so_luong*don_gia),0) tam
                       from kho.don_mua_dong dd where dd.don_mua_id=d.id) dg on true
    where (p_trang_thai is null or d.trang_thai=p_trang_thai)
      and (p_ncc is null or d.ncc_id=p_ncc)
      and (nullif(btrim(coalesce(p_tim,'')),'') is null or d.so_don ilike '%'||p_tim||'%' or n.ten ilike '%'||p_tim||'%')
  ) b;
  return v_ds;
end $$;
grant execute on function kho.dm_danh_sach(text,uuid,text) to authenticated;

-- ═══════════ KIỂM SAU MIGRATION ═══════════
do $$ begin
  if to_regprocedure('kho.dm_nhan_hang(uuid,jsonb,date)') is null then raise exception 'dm_nhan_hang CHƯA tạo'; end if;
  if to_regprocedure('kho.ghi_so_phieu(text,uuid,text,text,jsonb,text)') is null then raise exception 'ghi_so_phieu 6-tham-số CHƯA còn'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kho' and p.proname='ghi_so_phieu') <> 1
    then raise exception 'ghi_so_phieu có >1 overload (đường ghi thứ hai)'; end if;
  raise notice 'db/127 OK: dm_nhan_hang · ghi_so_phieu(+ghi_chu-dòng/don_mua_dong_id/phieu_id) 1 thân · huy_phieu móc đơn mua · CHECK da_nhan.';
end $$;
commit;
