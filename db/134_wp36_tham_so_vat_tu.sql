-- 134 — WP-36 (QD-55): màn "Đơn vị & hao hụt" + đổi tên quy_doi→plugin_ma_map + thiếu hệ số KHÔNG chặn thợ.
--   QD-55 (nới QD-53 CHO CUTLIST): plugin (cutlist) đẩy BOM đơn vị chưa có hệ số → dòng CHỜ (so_luong_co_so NULL), KHÔNG raise;
--     go_tay/uoc (người nhập) VẪN strict (QD-53). Back-flush bỏ qua dòng chờ + báo thieu_he_so; nhập hệ số → xuất bù (chay_lai_back_flush).
--   Tham số đơn vị/khổ/hao hụt nhập QUA MÀN (luu_tham_so_vat_tu), có lịch sử. quy_doi = map MÃ plugin (đổi tên đúng nghĩa; view compat tạm).
--   ⚠ IDEMPOTENT. HOÀN TÁC: alter table plugin_ma_map rename to quy_doi; drop view/các RPC WP-36; chạy lại db/132 (ghi_bom_mon/xuat_back_flush/sq_ghi).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ B1 · RENAME quy_doi → plugin_ma_map (+ view compat + RPC export) ═══════════
do $$ begin
  if to_regclass('kho.plugin_ma_map') is null then
    execute 'alter table kho.quy_doi rename to plugin_ma_map';
  end if;
end $$;
drop view if exists kho.quy_doi;
create view kho.quy_doi with (security_invoker = true) as select * from kho.plugin_ma_map;  -- RLS của plugin_ma_map (ceo/kho) VẪN áp — không nới lộ giá
comment on view kho.quy_doi is 'DEPRECATED WP-36: chỉ đọc, đổi tên thành plugin_ma_map (map MÃ plugin, không phải quy đổi đơn vị). Gỡ ở WP-91.';
grant select on kho.quy_doi to authenticated;
grant select, insert, update, delete on kho.plugin_ma_map to authenticated;
grant select on kho.plugin_ma_map to anon;
CREATE OR REPLACE FUNCTION kho.quy_doi_export()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare vt text := kho.current_vai_tro();
begin
  -- CHO ĐỌC: đường anon/plugin (auth.uid() null) HOẶC vai trò trong danh sách trắng. Còn lại RAISE.
  if auth.uid() is null or vt in ('ceo','kho','ke_toan','tho') then
    return coalesce(
      (select jsonb_build_object(
         'thoi_gian_xuat', to_char(max(q.tao_luc), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         'so_dong', count(*),
         'quy_doi', coalesce(jsonb_agg(jsonb_build_object(
           'mo_ta_thiet_ke', q.mo_ta_thiet_ke, 'ma_plugin', q.ma_plugin, 'ma_kho', q.ma_kho,
           'he_so_quy_doi', q.he_so_quy_doi, 'gia_von_kho', t.gia_von_bq) order by q.mo_ta_thiet_ke), '[]'::jsonb))
       from kho.plugin_ma_map q
       left join kho.vat_tu v on v.ma = q.ma_kho
       left join kho.ton t on t.vat_tu_id = v.id
       where q.trang_thai = 'DA_DUYET' and q.la_mac_dinh = true),
      jsonb_build_object('thoi_gian_xuat','khong_co_du_lieu','so_dong',0,'quy_doi','[]'::jsonb));
  end if;
  raise exception 'Vai trò "%" không được đọc giá vốn (bảng quy đổi).', coalesce(vt, '(không vai trò)');
end $function$;
grant execute on function kho.quy_doi_export() to authenticated;

-- ═══════════ B2 · vat_tu khổ ván + hao_hut NULLABLE (NULL = dùng mặc định nhóm; giữ default 0 cho fixture cũ) ═══════════
alter table kho.vat_tu add column if not exists kho_dai_mm numeric;
alter table kho.vat_tu add column if not exists kho_rong_mm numeric;
alter table kho.vat_tu alter column hao_hut_pct drop not null;
-- hao hụt hiệu lực: raw ghi đè; NULL → mặc định nhóm (ván 10%, khác 0%). CHỈ hàng bị màn XOÁ ghi đè mới NULL → 202 hàng cũ (=0) KHÔNG đổi.
create or replace function kho.hao_hut_hieu_luc(p_vat_tu uuid) returns numeric language sql stable as $$
  select coalesce(v.hao_hut_pct, case when kho.la_nhom_van(v.nhom_id) then 10 else 0 end) from kho.vat_tu v where v.id=p_vat_tu $$;
grant execute on function kho.hao_hut_hieu_luc(uuid) to authenticated;

-- ═══════════ B3 · lịch sử tham số (append-only) ═══════════
create table if not exists kho.vat_tu_tham_so_lich_su (
  id bigserial primary key,
  vat_tu_id uuid not null references kho.vat_tu(id),
  truong text not null,
  gia_tri_cu jsonb, gia_tri_moi jsonb,
  nguoi uuid, luc timestamptz not null default now()
);
create index if not exists vttsls_idx on kho.vat_tu_tham_so_lich_su(vat_tu_id, luc desc);
create or replace function kho.vttsls_append_only() returns trigger language plpgsql as $$
begin raise exception 'vat_tu_tham_so_lich_su: append-only (WP-36)'; end $$;
drop trigger if exists trg_vttsls_ao on kho.vat_tu_tham_so_lich_su;
create trigger trg_vttsls_ao before update or delete on kho.vat_tu_tham_so_lich_su for each row execute function kho.vttsls_append_only();
alter table kho.vat_tu_tham_so_lich_su enable row level security; alter table kho.vat_tu_tham_so_lich_su force row level security;
drop policy if exists vttsls_doc on kho.vat_tu_tham_so_lich_su;
create policy vttsls_doc on kho.vat_tu_tham_so_lich_su for select using (kho.current_vai_tro() is not null);
revoke insert,update,delete on kho.vat_tu_tham_so_lich_su from anon, authenticated;
grant select on kho.vat_tu_tham_so_lich_su to authenticated;

-- ═══════════ B7a · so_luong_co_so NULLABLE + bom_fill_co_so biết cutlist-chờ ═══════════
alter table kho.don_hang_mon_bom alter column so_luong_co_so drop not null;
create or replace function kho.bom_fill_co_so() returns trigger language plpgsql security definer set search_path=kho as $fill$
begin
  if new.so_luong_co_so is null then
    begin
      new.so_luong_co_so := kho.quy_ve_co_so(new.vat_tu_id, coalesce(new.don_vi, (select don_vi_co_so from kho.vat_tu where id=new.vat_tu_id)), new.so_luong);
    exception when others then
      if new.nguon = 'cutlist' then new.so_luong_co_so := null;   -- WP-36/QD-55: cutlist CHỜ hệ số
      else new.so_luong_co_so := new.so_luong; end if;           -- go_tay/uoc: fixture/đường trực tiếp (ghi_bom_mon đã strict trước)
    end;
  end if;
  if new.he_so_ap_dung is null and new.so_luong_co_so is not null and coalesce(new.so_luong,0)<>0 then new.he_so_ap_dung := new.so_luong_co_so/new.so_luong; end if;
  return new;
end $fill$;

-- ═══════════ B7b · ghi_bom_mon: cutlist thiếu hệ số → dòng CHỜ (không raise); go_tay/uoc strict ═══════════
create or replace function kho.ghi_bom_mon(p_mon_id uuid, p_nguon text, p_dong jsonb)
  returns integer language plpgsql security definer set search_path = kho as $gbm$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns();
  d jsonb; i int := 0; v_vt uuid; v_sl numeric; v_dv text; v_hd text; v_cs text; v_ds text; v_sco numeric; v_hs numeric;
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom','kho','ceo') then
    raise exception 'ghi_bom_mon: chỉ thiet_ke/tk_ban_hang/truong_nhom/kho/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  if p_nguon not in ('cutlist','go_tay','uoc') then raise exception 'ghi_bom_mon: nguồn phải cutlist/go_tay/uoc'; end if;
  if not exists(select 1 from kho.don_hang_mon where id = p_mon_id) then raise exception 'ghi_bom_mon: món không tồn tại'; end if;
  if exists(select 1 from kho.don_hang_mon_bom where mon_id = p_mon_id and moc = 'chuan') then
    raise exception 'BOM_DA_CHOT: BOM của món đã chốt (mốc chuẩn) — không đẩy lại du_kien được'; end if;
  delete from kho.don_hang_mon_bom where mon_id = p_mon_id and nguon = p_nguon and moc = 'du_kien';
  for d in select * from jsonb_array_elements(coalesce(p_dong, '[]'::jsonb)) loop
    v_vt := (d->>'vat_tu_id')::uuid; v_sl := (d->>'so_luong')::numeric; v_dv := nullif(d->>'don_vi',''); v_hd := nullif(d->>'hoat_dong','');
    select don_vi_co_so into v_cs from kho.vat_tu where id = v_vt;
    if v_cs is null then raise exception 'ghi_bom_mon: vật tư % không tồn tại', coalesce(v_vt::text,'(null)'); end if;
    if v_sl is null or v_sl <= 0 then raise exception 'ghi_bom_mon: dòng % số lượng phải > 0', i+1; end if;
    if v_hd is not null and not exists(select 1 from kho.don_gia_baseline where hoat_dong = v_hd) then
      raise exception 'ghi_bom_mon: hoạt động "%" không có trong don_gia_baseline', v_hd; end if;
    v_ds := coalesce(v_dv, v_cs);
    if v_ds = v_cs then v_sco := v_sl;
    else
      select he_so into v_hs from kho.vat_tu_don_vi where vat_tu_id = v_vt and don_vi = v_ds;
      if v_hs is not null then v_sco := v_sl * v_hs;
      elsif p_nguon = 'cutlist' then v_sco := null;   -- QD-55: cutlist chờ hệ số (kho nhập sau → xuất bù)
      else raise exception 'ghi_bom_mon: vật tư % không có quy đổi cho đơn vị "%" (nguồn % — người nhập phải đúng đơn vị, QD-53)', v_vt, v_ds, p_nguon; end if;
    end if;
    insert into kho.don_hang_mon_bom(mon_id, vat_tu_id, so_luong, don_vi, so_luong_co_so, he_so_ap_dung, nguon, moc, hoat_dong, ghi_chu, tao_boi)
      values(p_mon_id, v_vt, v_sl, v_ds, v_sco, case when v_sco is null then null else v_sco/v_sl end, p_nguon, 'du_kien', v_hd, nullif(d->>'ghi_chu',''), v_ns);
    i := i + 1;
  end loop;
  return i;
end $gbm$;
revoke all on function kho.ghi_bom_mon(uuid,text,jsonb) from public, anon; grant execute on function kho.ghi_bom_mon(uuid,text,jsonb) to authenticated;

-- ═══════════ B7c · _bf_tinh: tính dòng back-flush + thiếu hệ số (DÙNG CHUNG cho xuat_back_flush + thu_quy_doi_bom) ═══════════
create or replace function kho._bf_tinh(p_mon_id uuid, p_nhom text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $bft$
declare d record; v_dong jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb; v_xuat numeric;
begin
  -- ket mỗi dòng: snapshot (so_luong_co_so đã chốt) ưu tiên; NULL (chờ) → quy đổi LIVE theo vat_tu_don_vi hiện tại.
  -- KHÔNG update BOM (test 11: snapshot cũ không đổi) — chỉ tính khi xuất/kiểm.
  for d in
    select x.vat_tu_id, x.ma, x.ten, x.don_vi_co_so, x.hao_hut_pct,
           sum(x.ket) chuan, bool_or(x.ket is null) co_chua, min(x.don_vi_bom) don_vi_bom
    from (
      select b.vat_tu_id, v.ma, v.ten, v.don_vi_co_so,
        coalesce(v.hao_hut_pct, case when kho.la_nhom_van(v.nhom_id) then 10 else 0 end) hao_hut_pct,
        b.don_vi don_vi_bom,
        case when b.so_luong_co_so is not null then b.so_luong_co_so
             when b.don_vi = v.don_vi_co_so then b.so_luong
             when uu.he_so is not null then b.so_luong * uu.he_so
             else null end ket
      from kho.don_hang_mon_bom b join kho.vat_tu v on v.id=b.vat_tu_id
      left join kho.vat_tu_don_vi uu on uu.vat_tu_id=b.vat_tu_id and uu.don_vi=b.don_vi
      where b.mon_id=p_mon_id and b.moc='chuan'
        and ((p_nhom='van' and kho.la_nhom_van(v.nhom_id)) or (p_nhom='phu_kien' and not kho.la_nhom_van(v.nhom_id)))
    ) x
    group by x.vat_tu_id, x.ma, x.ten, x.don_vi_co_so, x.hao_hut_pct
  loop
    if d.co_chua or d.chuan is null then
      v_thieu := v_thieu || jsonb_build_object('vat_tu_id',d.vat_tu_id,'ma',d.ma,'ten',d.ten,'don_vi_bom',d.don_vi_bom,'don_vi_co_so',d.don_vi_co_so);
    else
      v_xuat := kho.lam_tron_xuat(d.chuan * (1 + d.hao_hut_pct/100), d.don_vi_co_so);
      v_dong := v_dong || jsonb_build_object('vat_tu_id',d.vat_tu_id,'ma',d.ma,'ten',d.ten,'so_luong',v_xuat,'don_vi',d.don_vi_co_so,
        'so_luong_chuan',d.chuan,'hao_hut_pct_ap_dung',d.hao_hut_pct,'so_du_lam_tron', v_xuat - d.chuan*(1+d.hao_hut_pct/100));
    end if;
  end loop;
  return jsonb_build_object('dong', v_dong, 'thieu_he_so', v_thieu);
end $bft$;

-- ═══════════ B7d · xuat_back_flush: bỏ qua dòng chờ + báo thieu + tồn trước/sau ═══════════
create or replace function kho.xuat_back_flush(p_mon_id uuid, p_nhom text, p_su_kien_id uuid)
  returns jsonb language plpgsql security definer set search_path = kho as $bf$
declare v_don record; v_calc jsonb; v_dong jsonb; v_thieu jsonb; v_res jsonb; v_sp text; v_pid uuid; v_kid uuid;
  d record; v_dong2 jsonb := '[]'::jsonb; v_ton numeric;
begin
  if coalesce(current_setting('kho.back_flush_he_thong', true),'') <> '1' then
    raise exception 'xuat_back_flush: chỉ gọi nội bộ khi quét (GUC), không gọi trực tiếp'; end if;
  select m.id mon_id, dh.ma_don, coalesce(dh.la_demo,false) la_demo into v_don
    from kho.don_hang_mon m join kho.don_hang dh on dh.id=m.don_id where m.id=p_mon_id;
  if v_don.mon_id is null then return jsonb_build_object('ket_qua','bo_qua','dong','[]'::jsonb,'thieu_he_so','[]'::jsonb); end if;
  v_calc := kho._bf_tinh(p_mon_id, p_nhom); v_dong := v_calc->'dong'; v_thieu := v_calc->'thieu_he_so';
  if exists(select 1 from kho.phieu where mon_id=p_mon_id and nhom_back_flush=p_nhom and loai='xuat_sx' and trang_thai<>'da_huy') then
    return jsonb_build_object('ket_qua','da_xuat_truoc','dong','[]'::jsonb,'thieu_he_so',v_thieu); end if;
  if jsonb_array_length(v_dong) = 0 then
    return jsonb_build_object('ket_qua', case when jsonb_array_length(v_thieu)>0 then 'chi_thieu' else 'bo_qua' end, 'dong','[]'::jsonb, 'thieu_he_so', v_thieu); end if;
  v_res := kho.ghi_so_phieu('xuat_sx', null, 'Back-flush '||p_nhom||' (quét)', null, v_dong, null);
  v_sp := v_res->>'so_phieu'; v_pid := (v_res->>'phieu_id')::uuid;
  select id into v_kid from kho.kho where la_mac_dinh limit 1;
  update kho.phieu set ma_don=v_don.ma_don, mon_id=p_mon_id, su_kien_quet_id=p_su_kien_id, nhom_back_flush=p_nhom, la_demo=v_don.la_demo where id=v_pid;
  for d in select (x->>'vat_tu_id')::uuid vid, (x->>'so_luong')::numeric sl, x->>'ma' ma, x->>'ten' ten, x->>'don_vi' dv from jsonb_array_elements(v_dong) x loop
    update kho.giu_cho set so_luong_da_xuat = least(so_luong_giu, so_luong_da_xuat + d.sl) where don_hang_mon_id=p_mon_id and vat_tu_id=d.vid and trang_thai='mo';
    select so_luong into v_ton from kho.ton where vat_tu_id=d.vid and kho_id=v_kid;
    v_dong2 := v_dong2 || jsonb_build_object('vat_tu_id',d.vid,'ma',d.ma,'ten',d.ten,'so_luong',d.sl,'don_vi',d.dv,'phieu_so',v_sp,'ton_con',coalesce(v_ton,0),'ton_truoc',coalesce(v_ton,0)+d.sl);
  end loop;
  return jsonb_build_object('ket_qua','xuat', 'phieu_so', v_sp, 'dong', v_dong2, 'thieu_he_so', v_thieu);
end $bf$;
revoke all on function kho.xuat_back_flush(uuid,text,uuid) from public, anon; grant execute on function kho.xuat_back_flush(uuid,text,uuid) to authenticated;

-- ═══════════ B7e · sq_ghi (quet_tem trả back_flush mảng + thieu_he_so) ═══════════
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
  return jsonb_build_object('ok', true, 'loai', v_loai, 'ket_qua', 'nhan', 'nguoi_id', v_ns, 'buoc', v_buoc.thu_tu, 'nhanh', v_nhanh,
    'back_flush', coalesce(v_bf->'dong','[]'::jsonb), 'bf_phieu', v_bf->>'phieu_so', 'thieu_he_so', coalesce(v_bf->'thieu_he_so','[]'::jsonb));
end $function$;

-- ═══════════ B7f · ban_giao_xuong: giữ chỗ bỏ qua dòng chờ hệ số ═══════════
CREATE OR REPLACE FUNCTION kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; v_miss int; f jsonb; n int := 0; v_kho uuid; v_giu_moi int := 0; v_mon_thieu jsonb; v_vt_thieu jsonb;
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
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'so_file', n, 'tu', v_don.trang_thai, 'den', 'cho_cat',
    'mon_thieu_bom', coalesce(v_mon_thieu,'[]'::jsonb), 'vat_tu_thieu', coalesce(v_vt_thieu,'[]'::jsonb), 'giu_cho_moi', v_giu_moi);
end $function$;

-- ═══════════ B8 · chay_lai_back_flush(vat_tu_id): xuất bù tem đã CẮT có BOM dùng mã này mà chưa có phiếu ═══════════
create or replace function kho.chay_lai_back_flush(p_vat_tu_id uuid)
  returns int language plpgsql security definer set search_path = kho as $cl$
declare r record; n int := 0; v_sk uuid; v_r jsonb;
begin
  -- CHỈ ván. Tìm món có tem đã quét CẮT, dùng vật tư này ở BOM chuan (kể cả dòng CHỜ so_luong_co_so NULL),
  -- chưa có phiếu ván. _bf_tinh sẽ quy đổi LIVE bằng hệ số vừa nhập → xuất bù. n đếm ca THẬT xuất.
  if not kho.la_nhom_van((select nhom_id from kho.vat_tu where id = p_vat_tu_id)) then return 0; end if;
  for r in
    select distinct m.id mon_id
    from kho.don_hang_mon_bom b
    join kho.don_hang_mon m on m.id = b.mon_id
    join kho.tem_ban_ve t on t.mon_id = m.id
    join kho.su_kien_quet sq on sq.tem_ma = t.ma_tam and sq.ket_qua='nhan'
    join kho.tram tr on tr.ma_tram = sq.ma_tram and tr.hoat_dong = 'cat'
    where b.vat_tu_id = p_vat_tu_id and b.moc='chuan'
      and not exists (select 1 from kho.phieu p where p.mon_id=m.id and p.nhom_back_flush='van' and p.loai='xuat_sx' and p.trang_thai<>'da_huy')
  loop
    select id into v_sk from kho.su_kien_quet sq2 join kho.tem_ban_ve t2 on t2.ma_tam=sq2.tem_ma join kho.tram tr2 on tr2.ma_tram=sq2.ma_tram and tr2.hoat_dong='cat'
      where t2.mon_id=r.mon_id and sq2.ket_qua='nhan' order by sq2.luc limit 1;
    perform set_config('kho.back_flush_he_thong','1',true);
    v_r := kho.xuat_back_flush(r.mon_id, 'van', v_sk);
    perform set_config('kho.back_flush_he_thong','',true);
    if v_r->>'ket_qua' = 'xuat' then n := n + 1; end if;
  end loop;
  return n;
end $cl$;
revoke all on function kho.chay_lai_back_flush(uuid) from public, anon; grant execute on function kho.chay_lai_back_flush(uuid) to authenticated;

-- ═══════════ B4 · luu_tham_so_vat_tu ═══════════
create or replace function kho.luu_tham_so_vat_tu(p_vat_tu_id uuid, p_kho_dai_mm numeric, p_kho_rong_mm numeric, p_hao_hut_pct numeric, p_don_vi jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $lts$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns(); v_cs text; v_old record; dd jsonb; v_dv text; v_hs numeric; v_bu int := 0; v_m2 numeric;
begin
  if v_vai not in ('kho','ceo') then raise exception 'luu_tham_so_vat_tu: chỉ kho/ceo'; end if;
  select don_vi_co_so, kho_dai_mm, kho_rong_mm, hao_hut_pct into v_old from kho.vat_tu where id=p_vat_tu_id;
  if v_old is null then raise exception 'luu_tham_so_vat_tu: vật tư không tồn tại'; end if;
  v_cs := v_old.don_vi_co_so;
  if p_hao_hut_pct is not null and (p_hao_hut_pct < 0 or p_hao_hut_pct > 100) then raise exception 'luu_tham_so_vat_tu: hao hụt phải trong [0,100]'; end if;
  -- khổ + hao hụt
  if coalesce(p_kho_dai_mm,-1) is distinct from coalesce(v_old.kho_dai_mm,-1) then
    insert into kho.vat_tu_tham_so_lich_su(vat_tu_id,truong,gia_tri_cu,gia_tri_moi,nguoi) values(p_vat_tu_id,'kho_dai_mm',to_jsonb(v_old.kho_dai_mm),to_jsonb(p_kho_dai_mm),v_ns); end if;
  if coalesce(p_kho_rong_mm,-1) is distinct from coalesce(v_old.kho_rong_mm,-1) then
    insert into kho.vat_tu_tham_so_lich_su(vat_tu_id,truong,gia_tri_cu,gia_tri_moi,nguoi) values(p_vat_tu_id,'kho_rong_mm',to_jsonb(v_old.kho_rong_mm),to_jsonb(p_kho_rong_mm),v_ns); end if;
  if coalesce(p_hao_hut_pct,-1) is distinct from coalesce(v_old.hao_hut_pct,-1) then
    insert into kho.vat_tu_tham_so_lich_su(vat_tu_id,truong,gia_tri_cu,gia_tri_moi,nguoi) values(p_vat_tu_id,'hao_hut_pct',to_jsonb(v_old.hao_hut_pct),to_jsonb(p_hao_hut_pct),v_ns); end if;
  update kho.vat_tu set kho_dai_mm=p_kho_dai_mm, kho_rong_mm=p_kho_rong_mm,
    hao_hut_pct = p_hao_hut_pct   -- lưu NGUYÊN: NULL = xoá ghi đè → hao_hut_hieu_luc dùng mặc định nhóm
    where id=p_vat_tu_id;
  -- khổ → tự suy m2 (1 m² = 1/(dài*rộng/1e6) tấm)  [nguon='kho']
  if p_kho_dai_mm is not null and p_kho_rong_mm is not null and p_kho_dai_mm>0 and p_kho_rong_mm>0 and v_cs<>'m2' then
    v_m2 := 1.0 / (p_kho_dai_mm*p_kho_rong_mm/1e6);
    insert into kho.vat_tu_don_vi(vat_tu_id,don_vi,he_so) values(p_vat_tu_id,'m2',round(v_m2,6))
      on conflict (vat_tu_id,don_vi) do update set he_so=excluded.he_so;
  end if;
  -- đơn vị tay
  for dd in select * from jsonb_array_elements(coalesce(p_don_vi,'[]'::jsonb)) loop
    v_dv := dd->>'don_vi'; v_hs := (dd->>'he_so')::numeric;
    if v_hs is null or v_hs <= 0 then raise exception 'luu_tham_so_vat_tu: hệ số "%" phải > 0', v_dv; end if;
    if v_dv = v_cs then raise exception 'luu_tham_so_vat_tu: "%" là đơn vị cơ sở — không tự quy đổi', v_dv; end if;
    if not exists(select 1 from kho.don_vi where ma=v_dv) then raise exception 'luu_tham_so_vat_tu: đơn vị "%" chưa đăng ký', v_dv; end if;
    insert into kho.vat_tu_don_vi(vat_tu_id,don_vi,he_so) values(p_vat_tu_id,v_dv,v_hs)
      on conflict (vat_tu_id,don_vi) do update set he_so=excluded.he_so;
  end loop;
  -- có hệ số mới → xuất bù tem đã cắt còn chờ
  v_bu := kho.chay_lai_back_flush(p_vat_tu_id);
  return jsonb_build_object('ok',true,'tem_xuat_bu',v_bu);
end $lts$;
revoke all on function kho.luu_tham_so_vat_tu(uuid,numeric,numeric,numeric,jsonb) from public, anon; grant execute on function kho.luu_tham_so_vat_tu(uuid,numeric,numeric,numeric,jsonb) to authenticated;

-- ═══════════ B5 · tham_so_vat_tu_ds ═══════════
create or replace function kho.tham_so_vat_tu_ds()
  returns jsonb language plpgsql stable security definer set search_path = kho set jit='off' as $ds$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo') then raise exception 'tham_so_vat_tu_ds: chỉ kho/ceo'; end if;
  -- pre-aggregate BẰNG CTE (hash-agg 1 lần) thay 202 subquery tương quan → nhanh @100k đơn vị
  return coalesce((
    with dv as (select vat_tu_id, jsonb_agg(jsonb_build_object('don_vi',don_vi,'he_so',he_so) order by don_vi) arr from kho.vat_tu_don_vi group by vat_tu_id),
         -- thiếu hệ số = còn dòng BOM CHỜ mà đơn vị VẪN chưa quy được (nhập hệ số xong → nhãn tự tắt, dù snapshot vẫn NULL)
         thieu as (select distinct b.vat_tu_id from kho.don_hang_mon_bom b join kho.vat_tu vv on vv.id=b.vat_tu_id
                   where b.so_luong_co_so is null and b.don_vi <> vv.don_vi_co_so
                     and not exists(select 1 from kho.vat_tu_don_vi u where u.vat_tu_id=b.vat_tu_id and u.don_vi=b.don_vi)),
         lo as (select vat_tu_id, count(*) c from kho.lo_nhap group by vat_tu_id),
         giu as (select vat_tu_id, count(*) c from kho.giu_cho where trang_thai='mo' group by vat_tu_id),
         gd as (select distinct vat_tu_id from kho.giao_dich),
         demo as (select distinct on (bb.vat_tu_id) bb.vat_tu_id, jsonb_build_object('id',dh.id,'ma_don',dh.ma_don) obj
                  from kho.don_hang_mon_bom bb join kho.don_hang_mon mm on mm.id=bb.mon_id join kho.don_hang dh on dh.id=mm.don_id
                  where dh.la_demo order by bb.vat_tu_id, dh.tao_luc desc)
    select jsonb_agg(jsonb_build_object(
      'id',v.id,'ma',v.ma,'ten',v.ten,'nhom',n.ten,'la_van',kho.la_nhom_van(v.nhom_id),
      'don_vi_co_so',v.don_vi_co_so,'kho_dai_mm',v.kho_dai_mm,'kho_rong_mm',v.kho_rong_mm,
      'hao_hut_pct',v.hao_hut_pct, 'hao_hut_hieu_luc', coalesce(v.hao_hut_pct, case when kho.la_nhom_van(v.nhom_id) then 10 else 0 end),
      'hao_hut_nguon', case when v.hao_hut_pct is not null then 'tay' else 'mac_dinh_nhom' end,
      'don_vi', coalesce(dv.arr,'[]'::jsonb),
      'thieu_he_so', th.vat_tu_id is not null,
      'don_demo', demo.obj,
      'so_lo', coalesce(lo.c,0), 'so_giu_cho', coalesce(giu.c,0), 'co_giao_dich', gd.vat_tu_id is not null
      ) order by (th.vat_tu_id is not null) desc, v.ma)
    from kho.vat_tu v left join kho.nhom n on n.id=v.nhom_id
      left join dv on dv.vat_tu_id=v.id left join thieu th on th.vat_tu_id=v.id
      left join lo on lo.vat_tu_id=v.id left join giu on giu.vat_tu_id=v.id left join gd on gd.vat_tu_id=v.id
      left join demo on demo.vat_tu_id=v.id
    where v.ngung_dung=false), '[]'::jsonb);
end $ds$;
revoke all on function kho.tham_so_vat_tu_ds() from public, anon; grant execute on function kho.tham_so_vat_tu_ds() to authenticated;

-- ═══════════ B6 · thu_quy_doi_bom (chỉ TÍNH) ═══════════
create or replace function kho.thu_quy_doi_bom(p_vat_tu_id uuid, p_don_hang_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = kho as $tq$
declare v_vai text := coalesce(kho.current_vai_tro(),''); r record; v_giu numeric; v_xuat numeric; v_chua boolean;
begin
  if v_vai not in ('kho','ceo') then raise exception 'thu_quy_doi_bom: chỉ kho/ceo'; end if;
  -- so_co_so LIVE (giống _bf_tinh): snapshot ưu tiên, NULL → quy đổi theo vat_tu_don_vi hiện tại; chưa đủ → so_co_so NULL
  select x.don_vi, sum(x.so_luong) so_luong, bool_or(x.ket is null) chua,
         case when bool_or(x.ket is null) then null else sum(x.ket) end so_co_so, max(x.hao) hao, max(x.dvcs) dvcs
    into r
    from (
      select b.don_vi, b.so_luong,
        coalesce(v.hao_hut_pct, case when kho.la_nhom_van(v.nhom_id) then 10 else 0 end) hao, v.don_vi_co_so dvcs,
        case when b.so_luong_co_so is not null then b.so_luong_co_so
             when b.don_vi = v.don_vi_co_so then b.so_luong
             when uu.he_so is not null then b.so_luong * uu.he_so else null end ket
      from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id=b.mon_id join kho.vat_tu v on v.id=b.vat_tu_id
        left join kho.vat_tu_don_vi uu on uu.vat_tu_id=b.vat_tu_id and uu.don_vi=b.don_vi
      where b.vat_tu_id=p_vat_tu_id and m.don_id=p_don_hang_id and b.moc in ('chuan','du_kien')
    ) x group by x.don_vi limit 1;
  if r is null then return jsonb_build_object('co',false); end if;
  v_chua := r.chua;
  select coalesce(sum(g.so_luong_giu-g.so_luong_da_xuat),0) into v_giu from kho.giu_cho g join kho.don_hang_mon m on m.id=g.don_hang_mon_id where g.vat_tu_id=p_vat_tu_id and m.don_id=p_don_hang_id and g.trang_thai='mo';
  v_xuat := case when r.so_co_so is null then null else kho.lam_tron_xuat(r.so_co_so*(1+r.hao/100), r.dvcs) end;
  return jsonb_build_object('co',true,'thieu_he_so',v_chua,'bom_so_luong',r.so_luong,'bom_don_vi',r.don_vi,'so_co_so',r.so_co_so,'hao_hut_pct',r.hao,
    'so_xuat_ceil',v_xuat,'so_du_lam_tron', case when v_xuat is null then null else v_xuat - r.so_co_so*(1+r.hao/100) end,
    'giu_cho_hien_tai',v_giu,'giu_cho_sau_khi_luu', case when v_xuat is null then v_giu else greatest(0, v_giu - v_xuat) end);
end $tq$;
revoke all on function kho.thu_quy_doi_bom(uuid,uuid) from public, anon; grant execute on function kho.thu_quy_doi_bom(uuid,uuid) to authenticated;

do $$ begin
  if to_regclass('kho.plugin_ma_map') is null then raise exception 'rename FAIL'; end if;
  if to_regclass('kho.quy_doi') is null then raise exception 'view compat quy_doi FAIL'; end if;
  if to_regprocedure('kho.luu_tham_so_vat_tu(uuid,numeric,numeric,numeric,jsonb)') is null then raise exception 'luu_tham_so_vat_tu FAIL'; end if;
  raise notice 'db/134 OK: plugin_ma_map + view quy_doi + tham số vật tư (khổ/hao/đơn vị + lịch sử) + back-flush chờ-hệ-số + xuất bù.';
end $$;
commit;
