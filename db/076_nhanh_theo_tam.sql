-- db/076 — TẤM TỰ BIẾT NHÁNH, KHÔNG CẦN BIẾT MÓN (L-18 Việc 2)
-- Căn cứ sách: MES ch.4.2.3 BẢNG 4.1 — work plan theo MÓN, bộ phận đi nhánh riêng rồi gộp ở bước cuối.
--   Tem có ĐỊNH DANH ĐỘC LẬP (MES 4.4) — quét KHÔNG cần biết món; tấm chỉ cần biết NHÁNH.
-- Sửa nút thắt "tem chưa gán món chặn quét" (do TÔI đặt sai, không phải sách).
-- THUẦN DB, không màn. Idempotent (create or replace).
begin;

-- ─────────── nhanh_cua_tem: vai_tro → nhom → NHÁNH (không raise, tấm lạ đi 'chung') ───────────
--   nhom 'thung'→'thùng' · 'canh'→'cánh' · 'keo'→'kéo' · 'khac'/không tra được → 'chung' + cờ.
create or replace function kho.nhanh_cua_tem(p_tem text)
  returns jsonb language sql stable security definer set search_path = kho as $$
  select coalesce(
    (select case
       when nvt.nhom is null then jsonb_build_object('nhanh','chung','khong_tra_duoc',true)
       else jsonb_build_object(
         'nhanh', case nvt.nhom when 'thung' then 'thùng' when 'canh' then 'cánh'
                                when 'keo' then 'kéo' else 'chung' end,
         'khong_tra_duoc', false)
     end
     from (select vai_tro from kho.tem_ban_ve where ma_tam = p_tem order by phien_ban desc limit 1) t
     left join kho.nhan_vai_tro_tam nvt on nvt.ma = t.vai_tro),
    jsonb_build_object('nhanh','chung','khong_tra_duoc',true));
$$;
grant execute on function kho.nhanh_cua_tem(text) to authenticated;

-- ─────────── sq_qt_cua_tem: quy trình của tem KHÔNG cần mon_id ───────────
--   thứ tự: mon_id nếu có → nếu không, quy trình DUY NHẤT dùng trong ĐƠN → nhiều quy trình thì cờ nhieu.
create or replace function kho.sq_qt_cua_tem(p_tem text)
  returns table(qt text, nhieu boolean)
  language plpgsql stable security definer set search_path = kho as $$
declare v_mon uuid; v_list text[];
begin
  v_mon := kho.sq_tem_mon(p_tem);
  if v_mon is not null then
    qt := kho.qt_hieu_luc(v_mon); nhieu := false; return next; return;
  end if;
  select array_agg(distinct z.qt) into v_list from (
    select kho.qt_hieu_luc(m.id) qt
    from kho.tem_ban_ve tv
    join kho.don_hang d on d.ma_don = tv.ma_don
    join kho.don_hang_mon m on m.don_id = d.id
    where tv.ma_tam = p_tem
  ) z where z.qt is not null;
  if v_list is null or array_length(v_list,1) is null then qt := null; nhieu := false;
  elsif array_length(v_list,1) = 1 then qt := v_list[1]; nhieu := false;
  else qt := null; nhieu := true; end if;
  return next;
end $$;
grant execute on function kho.sq_qt_cua_tem(text) to authenticated;

-- ─────────── sq_ghi: gác e (quy trình không cần món) + gác f (chỉ xét bước CÙNG NHÁNH + 'chung') ───────────
--   NHÁNH: tấm 'chung' (assembly/tấm lạ) → gác f xét MỌI buoc_truoc (bước gộp chờ đủ hai nhánh).
--          tấm có nhánh riêng → chỉ xét bước nhánh mình + 'chung' → nhánh khác KHÔNG chặn.
create or replace function kho.sq_ghi(p_tem text, p_tram text, p_loai_ep text, p_nguon text,
                                      p_ghi_bu_cho timestamptz, p_ly_do text, p_so_hong numeric, p_so_lam_lai numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_qt text; v_nhieu boolean; v_ns uuid; v_tt text; v_loai text; v_buoc record; v_thieu text;
        p int; v_pre_hd text; v_pre_nhanh text; v_nhanh text;
begin
  select nguoi_id into v_ns from kho.ca_lam where ma_tram = p_tram and ket_thuc is null order by bat_dau limit 1;
  v_loai := coalesce(p_loai_ep, 'vao');
  -- a. tem tồn tại?
  if not exists (select 1 from kho.tem_ban_ve where ma_tam = p_tem) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TEM_LA', 'tem không có trong hệ thống'); end if;
  -- b. trạm đang dùng?
  if not exists (select 1 from kho.tram where ma_tram = p_tram and dang_dung) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_TAT', 'trạm không dùng được'); end if;
  -- xác định loai (tem+trạm hợp lệ): đã 'vao' chưa 'ra' ở trạm này → lần này là 'ra'
  v_loai := coalesce(p_loai_ep,
    case when (select count(*) filter (where loai='vao') - count(*) filter (where loai='ra')
               from kho.su_kien_quet where tem_ma=p_tem and ma_tram=p_tram and ket_qua='nhan') > 0 then 'ra' else 'vao' end);
  -- c. có ai trực?
  if v_ns is null then
    return kho.sq_chan(p_tem, p_tram, null, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_CO_CA', 'chưa ai mở ca ở trạm này'); end if;
  -- d. trạm đang 'chay'?
  v_tt := coalesce(kho.sq_tram_trang_thai(p_tram), 'chay');
  if v_tt <> 'chay' then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_KHONG_CHAY', 'trạm đang "'||v_tt||'", không chạy'); end if;
  -- e. quy trình — KHÔNG cần mon_id (MES 4.4: tem định danh độc lập).
  --    mon_id có → dùng; không → quy trình DUY NHẤT của đơn; đơn nhiều quy trình → CHẶN.
  select qt, nhieu into v_qt, v_nhieu from kho.sq_qt_cua_tem(p_tem);
  if v_nhieu then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho,
                       'NHIEU_QUY_TRINH', 'đơn này có nhiều quy trình, cần gán tấm vào món trước'); end if;
  if v_qt is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_QUY_TRINH', 'sản phẩm này chưa có quy trình sản xuất'); end if;
  -- bước hiện tại = bước của quy trình có hoạt động = hoạt động của trạm
  select b.thu_tu, b.buoc_truoc into v_buoc
    from kho.quy_trinh_buoc b join kho.tram t on t.ma_tram = p_tram
    where b.ma_quy_trinh = v_qt and b.hoat_dong = t.hoat_dong limit 1;
  if v_buoc.thu_tu is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'SAI_TRAM', 'quy trình không có bước cho trạm này'); end if;
  -- f. buoc_truoc đã 'ra' chưa — CHỈ xét bước CÙNG NHÁNH tấm + nhánh 'chung' (ĐỌC buoc_truoc, QD-01).
  --    tấm 'chung' → xét mọi nhánh (bước gộp chờ đủ hai nhánh).
  v_nhanh := kho.nhanh_cua_tem(p_tem) ->> 'nhanh';
  v_thieu := null;
  foreach p in array coalesce(v_buoc.buoc_truoc, array[]::int[]) loop
    select b.hoat_dong, b.nhanh into v_pre_hd, v_pre_nhanh
      from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt and b.thu_tu = p;
    -- chỉ chặn nếu bước trước NẰM TRÊN đường của tấm này
    if v_nhanh = 'chung' or v_pre_nhanh = 'chung' or v_pre_nhanh = v_nhanh then
      if not exists (
        select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
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
            coalesce(p_so_hong,0), coalesce(p_so_lam_lai,0));
  return jsonb_build_object('ok', true, 'loai', v_loai, 'ket_qua', 'nhan', 'nguoi_id', v_ns, 'buoc', v_buoc.thu_tu, 'nhanh', v_nhanh);
end $$;

commit;
