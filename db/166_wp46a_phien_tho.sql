-- db/166 (WP-46a L-34) — PHIÊN THỢ thay CA làm nguồn "AI LÀM".
--   Gốc bệnh (L-32/L-33 đo): sq_ghi gán quét theo `ca_lam ... order by bat_dau limit 1` = ca CŨ NHẤT →
--   ai quên đóng ca thì ôm hết việc người khác (ca treo 313 giờ). Nay gốc "ai làm" = PHIÊN THỢ HÔM NAY tại trạm.
--   CEO chốt (L-34): thợ = nguoi_dung (giữ FK su_kien_quet.nguoi_id) · mở phiên bằng BẤM CHỌN TÊN (như mo_ca),
--   KHÔNG tem/badge (nguoi_dung/tho đều chưa có cột mã quét — không tự đẻ mã).
--   ca_lam GIỮ NGUYÊN cho chấm công/có mặt (MES 4.5.2 tách hai loại) — chỉ thôi quyết định "ai làm".
--   ⚠ HỆ QUẢ (báo CEO): sau db/166 prod chưa có phiên nào + CHƯA có UI mở phiên (KHÔNG sửa UI lần này)
--   → trạm quét (bản L-33 đã deploy) sẽ báo "chưa có thợ nhận trạm" tới khi lô UI sau nối mo_phien.
begin;

-- ■1a · bảng phiên: một trạm chỉ MỘT phiên mở
create table if not exists kho.phien_tram(
  id       uuid primary key default gen_random_uuid(),
  ma_tram  text not null,
  nguoi_id uuid not null references kho.nguoi_dung(id),
  bat_dau  timestamptz not null default now(),
  ket_thuc timestamptz,
  nguon    text not null default 'chon'
);
create unique index if not exists uq_phien_tram_mo on kho.phien_tram(ma_tram) where ket_thuc is null;
comment on table kho.phien_tram is 'WP-46a: phiên thợ nhận trạm — nguồn "ai làm" cho sq_ghi (thay ca_lam order-by-bat_dau)';

-- ■1c · phiên chỉ tính trong NGÀY: bat_dau khác hôm nay → coi như không có phiên (không cron, chỉ thôi công nhận)
create or replace function kho.phien_nguoi(p_tram text)
 returns uuid language sql stable security definer set search_path to 'kho' as $$
  select nguoi_id from kho.phien_tram
  where ma_tram = p_tram and ket_thuc is null and bat_dau::date = current_date
  limit 1
$$;
grant execute on function kho.phien_nguoi(text) to authenticated;

-- ■1b · mở phiên (bấm chọn tên): trạm đang có phiên người khác → ĐÓNG phiên cũ, mở phiên mới (không RAISE, không bắt nhớ đóng)
create or replace function kho.mo_phien(p_nguoi uuid, p_tram text)
 returns jsonb language plpgsql security definer set search_path to 'kho' as $$
declare v_ten text; v_cur record; v_nhuong text := null; v_nhuong_id uuid := null;
begin
  perform kho.tram_gac_vai();   -- người vận hành trạm: tho/xuong/ceo
  select ho_ten into v_ten from kho.nguoi_dung where id = p_nguoi and dang_hoat_dong;
  if v_ten is null then raise exception 'không nhận ra thợ này (không có trong hệ hoặc đã khoá)'; end if;
  if not exists (select 1 from kho.tram where ma_tram = p_tram) then raise exception 'trạm "%" không có trong hệ', p_tram; end if;

  select id, nguoi_id, bat_dau into v_cur from kho.phien_tram where ma_tram = p_tram and ket_thuc is null limit 1;
  -- đã là phiên của chính người này TRONG NGÀY → không mở lại
  if v_cur.id is not null and v_cur.nguoi_id = p_nguoi and v_cur.bat_dau::date = current_date then
    return jsonb_build_object('da_mo', true, 'nguoi_nhan', v_ten, 'nguoi_nhan_id', p_nguoi, 'nguoi_nhuong', null, 'nguoi_nhuong_id', null);
  end if;
  -- phiên người khác (hoặc phiên cũ qua ngày) → ĐÓNG, ghi ai vừa nhường
  if v_cur.id is not null then
    update kho.phien_tram set ket_thuc = now() where id = v_cur.id;
    select ho_ten into v_nhuong from kho.nguoi_dung where id = v_cur.nguoi_id; v_nhuong_id := v_cur.nguoi_id;
  end if;
  insert into kho.phien_tram(ma_tram, nguoi_id, nguon) values (p_tram, p_nguoi, 'chon');
  return jsonb_build_object('da_mo', false, 'nguoi_nhan', v_ten, 'nguoi_nhan_id', p_nguoi, 'nguoi_nhuong', v_nhuong, 'nguoi_nhuong_id', v_nhuong_id);
end $$;
grant execute on function kho.mo_phien(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ■2 · sq_ghi ĐỔI NGUỒN "ai làm": phien_tram HÔM NAY, KHÔNG ca_lam, KHÔNG người đăng nhập. Không phiên → RAISE.
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
  -- WP-46a L-34: gốc "ai làm" = PHIÊN THỢ HÔM NAY tại trạm (một gốc, không hai). ca_lam thôi quyết định công.
  v_ns := kho.phien_nguoi(p_tram);

  -- ■1 (db/165): loai do NGƯỜI khai. Không default, không đoán.
  if p_loai_ep is null or p_loai_ep not in ('vao','ra') then
    raise exception 'sq_ghi: loai phải là "vao" hoặc "ra", nhận "%"', coalesce(p_loai_ep, '(null)');
  end if;
  v_loai := p_loai_ep;

  if not exists (select 1 from kho.tem_ban_ve where ma_tam = p_tem) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TEM_LA', 'tem không có trong hệ thống'); end if;
  if not exists (select 1 from kho.tram where ma_tram = p_tram and dang_dung) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_TAT', 'trạm không dùng được'); end if;
  -- ■2 · không có phiên thợ hôm nay → RAISE (KHÔNG fallback ca_lam / người đăng nhập)
  if v_ns is null then
    raise exception 'chưa có thợ nhận trạm — chọn thợ nhận trạm trước'; end if;
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

  -- ■2 HAI NÚT (db/165) — trạng thái giữ việc tại CHÍNH trạm này
  select count(*) filter (where loai='vao') - count(*) filter (where loai='ra')
    into v_dang from kho.su_kien_quet where tem_ma = p_tem and ma_tram = p_tram and ket_qua = 'nhan';
  if v_loai = 'vao' and v_dang > 0 then raise exception 'đang giữ việc này rồi'; end if;
  if v_loai = 'ra' and v_dang <= 0 then raise exception 'chưa nhận việc'; end if;

  -- ■2d cảnh báo giữ việc trạm khác (QD-69) — KHÔNG chặn
  if v_loai = 'vao' then
    select count(*) into v_giu from (
      select sq.tem_ma, sq.ma_tram, count(*) filter (where sq.loai='vao') - count(*) filter (where sq.loai='ra') d
      from kho.su_kien_quet sq
      where sq.nguoi_id = v_ns and sq.ket_qua = 'nhan' and not (sq.tem_ma = p_tem and sq.ma_tram = p_tram)
      group by sq.tem_ma, sq.ma_tram) s where s.d > 0;
    if v_giu > 0 then v_canh_bao := 'Bạn đang giữ ' || v_giu || ' việc chưa xong ở trạm khác'; end if;
  end if;

  -- ■4 giờ thật (db/165)
  if v_loai = 'ra' then
    select round(extract(epoch from (coalesce(p_ghi_bu_cho, now()) - max(kho.sq_luc(sq.*)))) / 60)::int
      into v_so_phut from kho.su_kien_quet sq
      where sq.tem_ma = p_tem and sq.ma_tram = p_tram and sq.loai = 'vao' and sq.ket_qua = 'nhan';
  end if;

  insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,nguon,ghi_bu_cho,ly_do_chan,so_hong,so_lam_lai,so_phut)
    values (p_tem, p_tram, v_ns, v_loai, 'nhan', p_nguon, p_ghi_bu_cho, case when p_nguon='tay' then p_ly_do else null end,
            coalesce(p_so_hong,0), coalesce(p_so_lam_lai,0), v_so_phut) returning id into v_sk;
  perform kho.capnhat_tien_do_tem(p_tem);
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

-- ■3 · viec_dang_giu ĐÃ tra theo su_kien_quet.nguoi_id (mo.nguoi = array_agg nguoi_id lúc 'vao') —
--   không đổi gì thêm: sq_ghi nay ghi nguoi_id = PHIÊN → thợ quét xong tra viec_dang_giu(mình) thấy đúng.
--   (Test 14.5 chứng minh không nhầm sang người tiếp quản.)

commit;
