-- db/165 (WP-46a · phát sinh từ L-31) — HAI NÚT: loai do NGƯỜI khai, KHÔNG đoán chẵn/lẻ.
--   L-31 đo được: cú quét thứ 2 cùng trạm ÂM THẦM thành 'ra' (case (vao−ra)>0). Thợ tưởng nhận lại,
--   máy lại đánh dấu xong. WP-46a bỏ hẳn đoán đó: loai phải KHAI ('vao'|'ra'); sai/thiếu → NỔ.
--   ■1 sq_ghi nhận loai bắt buộc (p_loai_ep) · ■2 hai nút (nhận chồng / xong-chưa-nhận → RAISE; giữ
--   việc trạm khác → cảnh báo, KHÔNG chặn, QD-69) · ■3 viec_dang_giu (hiện, KHÔNG tự đóng) · ■4 so_phut
--   (giờ thật cặp vào-ra, CHỈ lưu). Tiền-đề buoc_truoc (QD-01) GIỮ NGUYÊN.
--   Callers sq_ghi: quet_tem (đổi: truyền loai) · ghi_bu (đã truyền p_loai) · do_gio_that (không gọi).
--   tram_quet/quet_tem THÊM tham số p_loai → phải DROP+CREATE (đổi chữ ký) + cấp lại execute.
--   Web (KHÔNG deploy lần này) gọi tram_quet 4 tham số → p_loai mặc định 'vao' (nút "Nhận việc");
--   nút "Xong việc" ('ra') chờ UI WP-46. Nghĩa là: sau db/165, nút quét đơn hiện CHỈ ghi 'vao',
--   quét lần 2 cùng trạm → "đang giữ việc này rồi" (đúng ý CEO, không còn âm thầm 'ra').
begin;

-- ■4 · cột giờ thật (chưa có → thêm)
alter table kho.su_kien_quet add column if not exists so_phut int;
comment on column kho.su_kien_quet.so_phut is 'WP-46a: phút cặp vào→ra tại trạm (chỉ lưu, MES 5.4.2 dùng sau)';

-- ─────────────────────────────────────────────────────────────────────────────
-- ■1+■2+■4 · sq_ghi — loai BẮT BUỘC, hai nút, giờ thật. (giữ 8 tham số cũ; p_loai_ep = loai khai)
CREATE OR REPLACE FUNCTION kho.sq_ghi(p_tem text, p_tram text, p_loai_ep text, p_nguon text, p_ghi_bu_cho timestamp with time zone, p_ly_do text, p_so_hong numeric, p_so_lam_lai numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_qt text; v_nhieu boolean; v_ns uuid; v_tt text; v_loai text; v_buoc record; v_thieu text;
        p int; v_pre_hd text; v_pre_nhanh text; v_nhanh text; v_sk uuid; v_bf jsonb := null; v_hd text; v_mon uuid;
        v_dang int; v_giu int; v_so_phut int; v_canh_bao text := null;
begin
  select nguoi_id into v_ns from kho.ca_lam where ma_tram = p_tram and ket_thuc is null order by bat_dau limit 1;

  -- ■1: loai do NGƯỜI khai. Không default, không đoán — sai/thiếu = lỗi lập trình, nổ ngay.
  if p_loai_ep is null or p_loai_ep not in ('vao','ra') then
    raise exception 'sq_ghi: loai phải là "vao" hoặc "ra", nhận "%"', coalesce(p_loai_ep, '(null)');
  end if;
  v_loai := p_loai_ep;

  if not exists (select 1 from kho.tem_ban_ve where ma_tam = p_tem) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TEM_LA', 'tem không có trong hệ thống'); end if;
  if not exists (select 1 from kho.tram where ma_tram = p_tram and dang_dung) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_TAT', 'trạm không dùng được'); end if;
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

  -- Cổng tiền đề theo buoc_truoc (QD-01) — GIỮ NGUYÊN.
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

  -- ■2 HAI NÚT — trạng thái giữ việc tại CHÍNH trạm này (chỉ đếm sự kiện NHẬN)
  select count(*) filter (where loai='vao') - count(*) filter (where loai='ra')
    into v_dang from kho.su_kien_quet where tem_ma = p_tem and ma_tram = p_tram and ket_qua = 'nhan';
  if v_loai = 'vao' and v_dang > 0 then
    raise exception 'đang giữ việc này rồi';   -- (a) nhận chồng
  end if;
  if v_loai = 'ra' and v_dang <= 0 then
    raise exception 'chưa nhận việc';           -- (b) báo xong việc chưa nhận
  end if;

  -- ■2d · thợ đang giữ việc dở ở trạm KHÁC → CẢNH BÁO, không chặn (QD-69, việc thật thắng)
  if v_loai = 'vao' then
    select count(*) into v_giu from (
      select sq.tem_ma, sq.ma_tram, count(*) filter (where sq.loai='vao') - count(*) filter (where sq.loai='ra') d
      from kho.su_kien_quet sq
      where sq.nguoi_id = v_ns and sq.ket_qua = 'nhan' and not (sq.tem_ma = p_tem and sq.ma_tram = p_tram)
      group by sq.tem_ma, sq.ma_tram) s where s.d > 0;
    if v_giu > 0 then v_canh_bao := 'Bạn đang giữ ' || v_giu || ' việc chưa xong ở trạm khác'; end if;
  end if;

  -- ■4 · GIỜ THẬT: khi 'ra', tính phút từ 'vao' gần nhất tại trạm này (chỉ LƯU)
  if v_loai = 'ra' then
    select round(extract(epoch from (coalesce(p_ghi_bu_cho, now()) - max(kho.sq_luc(sq.*)))) / 60)::int
      into v_so_phut from kho.su_kien_quet sq
      where sq.tem_ma = p_tem and sq.ma_tram = p_tram and sq.loai = 'vao' and sq.ket_qua = 'nhan';
  end if;

  -- ĐỦ guard → ghi NHẬN
  insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,nguon,ghi_bu_cho,ly_do_chan,so_hong,so_lam_lai,so_phut)
    values (p_tem, p_tram, v_ns, v_loai, 'nhan', p_nguon, p_ghi_bu_cho, case when p_nguon='tay' then p_ly_do else null end,
            coalesce(p_so_hong,0), coalesce(p_so_lam_lai,0), v_so_phut) returning id into v_sk;
  perform kho.capnhat_tien_do_tem(p_tem);
  -- WP-33: back-flush ván (cắt) / phụ kiện (lắp) — idempotent; QD-18: lỗi KHÔNG hỏng ghi sổ quét.
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
    'so_phut', v_so_phut, 'canh_bao', v_canh_bao,
    'back_flush', coalesce(v_bf->'dong','[]'::jsonb), 'bf_phieu', v_bf->>'phieu_so', 'thieu_he_so', coalesce(v_bf->'thieu_he_so','[]'::jsonb));
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ■1 · quet_tem — THÊM p_loai, truyền xuống sq_ghi (đổi chữ ký → drop+create+grant)
drop function if exists kho.quet_tem(text, text, numeric, numeric);
CREATE OR REPLACE FUNCTION kho.quet_tem(p_tem text, p_tram text, p_so_hong numeric DEFAULT 0, p_so_lam_lai numeric DEFAULT 0, p_loai text DEFAULT 'vao')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
begin
  return kho.sq_ghi(p_tem, p_tram, p_loai, 'quet', null, null, p_so_hong, p_so_lam_lai);
end $function$;
grant execute on function kho.quet_tem(text, text, numeric, numeric, text) to authenticated;

-- ■1 · tram_quet — THÊM p_loai (mặc định 'vao' = nút Nhận việc), lấy mat_phut từ so_phut đã lưu
drop function if exists kho.tram_quet(text, text, numeric, numeric);
CREATE OR REPLACE FUNCTION kho.tram_quet(p_tem text, p_tram text, p_so_hong numeric DEFAULT 0, p_so_lam_lai numeric DEFAULT 0, p_loai text DEFAULT 'vao')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare g jsonb; v_tam text; v_don text; v_mon text; v_hd_ten text; v_thoat text;
        v_mon_id uuid; v_vaitro text; v_tien jsonb; v_phut int;
begin
  perform kho.tram_gac_vai();
  g := kho.quet_tem(p_tem, p_tram, p_so_hong, p_so_lam_lai, p_loai);
  select vai_tro, mon_id, ma_don into v_vaitro, v_mon_id, v_don
    from kho.tem_ban_ve where ma_tam = p_tem order by phien_ban desc limit 1;
  v_tam := kho.ten_vai_tro_tam(v_vaitro);
  if v_mon_id is not null then select ten into v_mon from kho.don_hang_mon where id = v_mon_id; end if;

  if (g->>'ok')::boolean then
    select coalesce(d.ten, t.hoat_dong) into v_hd_ten
      from kho.tram t left join kho.don_gia_baseline d on d.hoat_dong = t.hoat_dong where t.ma_tram = p_tram;
    v_tien := kho.tien_do_tam(p_tem);
    v_phut := (g->>'so_phut')::int;   -- WP-46a: giờ thật đã lưu trong su_kien_quet
    return g || jsonb_build_object('tam', v_tam, 'mon', v_mon, 'don', v_don, 'hoat_dong_ten', v_hd_ten,
      'mat_phut', v_phut, 'buoc_ke', v_tien->>'ten_buoc_ke_tiep', 'xong', v_tien->'xong', 'tong_buoc', v_tien->'tong_buoc');
  end if;

  v_thoat := case g->>'loi'
    when 'NHAY_BUOC' then 'Mang tấm sang tổ '
        || nullif(regexp_replace(coalesce(g->>'ly_do',''), '^tấm này chưa qua ', ''), '')
        || ' trước. Nếu tấm đã làm rồi mà quên quét, báo tổ trưởng ghi bù.'
    when 'TRAM_KHONG_CHAY' then 'Đổi trạng thái trạm về "Đang chạy" rồi quét lại. Nếu máy vừa xong, báo tổ trưởng.'
    when 'CHUA_CO_CA' then 'Mở ca ở trạm này trước khi quét.'
    when 'NHIEU_QUY_TRINH' then 'Đơn có nhiều quy trình — nhờ tổ trưởng gán tấm vào đúng món trước.'
    when 'CHUA_QUY_TRINH' then 'Sản phẩm chưa có quy trình — báo tổ trưởng / kỹ thuật.'
    when 'TEM_LA' then 'Tem không đọc được trong hệ — kiểm lại tem hoặc báo tổ trưởng.'
    when 'TRAM_TAT' then 'Trạm này chưa được bật — báo tổ trưởng.'
    when 'SAI_TRAM' then 'Tấm này không có bước ở trạm này — mang sang đúng trạm.'
    else 'Báo tổ trưởng để xử lý.'
  end;
  return g || jsonb_build_object('tam', v_tam, 'mon', v_mon, 'don', v_don, 'duong_thoat', v_thoat);
end $function$;
grant execute on function kho.tram_quet(text, text, numeric, numeric, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ■3 · viec_dang_giu — HIỆN việc đang giữ (vao chưa ra). KHÔNG tự đóng. p_ma_ns null = cả xưởng.
CREATE OR REPLACE FUNCTION kho.viec_dang_giu(p_ma_ns uuid DEFAULT NULL)
 RETURNS TABLE(tem text, mon text, buoc int, tram text, tram_ten text, nguoi_id uuid, nguoi_ten text, giu_tu timestamptz, giu_gio numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
  with mo as (
    select sq.tem_ma, sq.ma_tram,
           count(*) filter (where sq.loai='vao') - count(*) filter (where sq.loai='ra') as d,
           max(kho.sq_luc(sq.*)) filter (where sq.loai='vao') as vao_luc,
           (array_agg(sq.nguoi_id order by kho.sq_luc(sq.*) desc) filter (where sq.loai='vao'))[1] as nguoi
    from kho.su_kien_quet sq
    where sq.ket_qua='nhan'
    group by sq.tem_ma, sq.ma_tram
    having count(*) filter (where sq.loai='vao') - count(*) filter (where sq.loai='ra') > 0
  )
  select mo.tem_ma, dm.ten, qb.thu_tu, mo.ma_tram, tr.ten, mo.nguoi, nd.ho_ten, mo.vao_luc,
         round(extract(epoch from (now() - mo.vao_luc))/3600.0, 2)
  from mo
  join kho.tram tr on tr.ma_tram = mo.ma_tram
  left join lateral (select mon_id from kho.tem_ban_ve where ma_tam = mo.tem_ma order by phien_ban desc limit 1) tbv on true
  left join kho.don_hang_mon dm on dm.id = tbv.mon_id
  left join lateral (select thu_tu from kho.quy_trinh_buoc where ma_quy_trinh = kho.qt_hieu_luc(tbv.mon_id) and hoat_dong = tr.hoat_dong limit 1) qb on true
  left join kho.nguoi_dung nd on nd.id = mo.nguoi
  where p_ma_ns is null or mo.nguoi = p_ma_ns
  order by mo.vao_luc;
$function$;
grant execute on function kho.viec_dang_giu(uuid) to authenticated;

commit;
