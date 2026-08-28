-- db/168 (WP-46 · L-37) — BƯỚC KẾ NHÁNH SONG SONG. tien_do_tam trả MẢNG mọi bước sẵn sàng,
--   không còn `order by thu_tu limit 1` giấu mất nhánh cụp. Sửa TRONG CHÍNH tien_do_tam (không đẻ hàm hai).
--   ■2 THỨ TỰ (CEO chốt L-37): thu_tu tăng dần, KHÔNG mở lô ranker riêng. rank_uu_tien xếp hạng ĐƠN
--     (hạn/gấp/trạng thái toàn xưởng), KHÔNG áp cho hai BƯỚC cùng một món (cùng đơn = cùng rank).
--     thu_tu bội-trăm = số định danh chừa chỗ nhánh song song (MES ch.4), KHÔNG mang nghĩa ưu tiên;
--     300 (thùng) và 310 (cụp) là hai bước CÙNG món ở hai tổ khác nhau, không tranh nguồn lực nên không
--     có gì điều độ (MES 5.4.5 chỉ đặt vấn đề khi nhiều SẢN PHẨM tranh cùng một máy). Sổ nút thắt đang 0 dòng.
--   THAY ranker: cờ cua_tram_nay — bước của TRẠM ĐANG QUÉT lên đầu mảng (đưa việc của người đang đứng
--     đó ra trước mắt họ, KHÔNG phải ưu tiên điều độ). Không suy được trạm→tổ → cua_tram_nay=false, KHÔNG đoán.
--   ■3 LỊCH (QD-69): tien_do_tam KHÔNG đọc xep_lich — bước kế suy từ ĐỒ THỊ THUẦN. Lịch trống/hỏng
--     vẫn trả đủ bước kế. (Không gắn thông tin lịch lần này — giữ thuần đồ thị.)
--   ■4 mọi bước 'ra' → mảng rỗng + xong_mon=true. GIỮ NGUYÊN mọi trường cũ; thêm buoc_ke_ds + xong_mon;
--     buoc_ke (cũ) trỏ phần tử ĐẦU mảng đã sắp → UI L-33 (đọc buoc_ke) không chết.
begin;

drop function if exists kho.tien_do_tam(text);
CREATE OR REPLACE FUNCTION kho.tien_do_tam(p_tem text, p_tram text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_mon uuid; v_qt text; v_tong int; v_xong int; v_ke int; v_ke_ten text; v_cur int; v_cur_ten text;
  v_cham numeric := 0; v_first timestamptz; v_last timestamptz;
  v_ds jsonb; v_tram_hd text; v_xong_mon boolean;
begin
  if coalesce(kho.current_vai_tro(),'') = '' then raise exception 'tien_do: chưa đăng nhập'; end if;
  v_mon := kho.sq_tem_mon(p_tem);
  v_qt  := case when v_mon is null then null else kho.qt_hieu_luc(v_mon) end;
  if v_qt is null then raise exception 'tien_do: tem "%" chưa gắn quy trình', p_tem; end if;
  select count(*) into v_tong from kho.quy_trinh_buoc where ma_quy_trinh = v_qt and coalesce(loai_buoc,'nguoi') <> 'tu_chay';
  select count(*) into v_xong from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt and coalesce(b.loai_buoc,'nguoi')<>'tu_chay'
    and exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
                where sq.tem_ma=p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=b.hoat_dong);
  select coalesce(sum(case when loai='ra' then extract(epoch from coalesce(ghi_bu_cho,luc)) else -extract(epoch from coalesce(ghi_bu_cho,luc)) end),0)/3600.0,
         min(coalesce(ghi_bu_cho,luc)), max(coalesce(ghi_bu_cho,luc))
    into v_cham, v_first, v_last from kho.su_kien_quet where tem_ma=p_tem and ket_qua='nhan';
  -- bước hiện tại = bước đang 'vao' chưa 'ra' (giữ nguyên)
  select b.thu_tu, d.ten into v_cur, v_cur_ten from kho.quy_trinh_buoc b join kho.tram t on t.hoat_dong=b.hoat_dong
    join kho.su_kien_quet sq on sq.ma_tram=t.ma_tram and sq.tem_ma=p_tem and sq.ket_qua='nhan'
    left join kho.don_gia_baseline d on d.hoat_dong=b.hoat_dong
    where b.ma_quy_trinh=v_qt group by b.thu_tu, d.ten
    having count(*) filter (where sq.loai='vao') > count(*) filter (where sq.loai='ra') order by b.thu_tu desc limit 1;

  -- trạm đang quét → hoạt động của nó (đánh cờ cua_tram_nay)
  if p_tram is not null then select hoat_dong into v_tram_hd from kho.tram where ma_tram = p_tram; end if;

  -- MẢNG mọi bước SẴN SÀNG: chưa 'ra' + MỌI buoc_truoc đã 'ra'. Sắp: cua_tram_nay trước, rồi thu_tu tăng.
  with san_sang as (
    select b.thu_tu, coalesce(d.ten, b.hoat_dong) as ten_buoc, b.nhanh, b.to_phu_trach,
           (select ma_tram from kho.tram t where t.hoat_dong = b.hoat_dong limit 1) as ma_tram,
           (v_tram_hd is not null and b.hoat_dong = v_tram_hd) as cua_tram_nay
    from kho.quy_trinh_buoc b left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
    where b.ma_quy_trinh = v_qt and coalesce(b.loai_buoc,'nguoi') <> 'tu_chay'
      and not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
                      where sq.tem_ma=p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=b.hoat_dong)
      -- bool_and(∅)=NULL → bước KHÔNG có buoc_truoc (bước đầu) phải coi là SẴN SÀNG → coalesce true
      and coalesce((select bool_and(exists (select 1 from kho.su_kien_quet sq2 join kho.tram t2 on t2.ma_tram=sq2.ma_tram
             join kho.quy_trinh_buoc pb on pb.ma_quy_trinh=v_qt and pb.thu_tu=pr
             where sq2.tem_ma=p_tem and sq2.loai='ra' and sq2.ket_qua='nhan' and t2.hoat_dong=pb.hoat_dong))
           from unnest(coalesce(b.buoc_truoc,array[]::int[])) pr), true)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'thu_tu', thu_tu, 'ten_buoc', ten_buoc, 'nhanh', nhanh, 'to', to_phu_trach,
           'tram', ma_tram, 'cua_tram_nay', cua_tram_nay)
           order by cua_tram_nay desc, thu_tu asc), '[]'::jsonb)
    into v_ds from san_sang;

  v_ke     := (v_ds->0->>'thu_tu')::int;        -- trường cũ = phần tử ĐẦU mảng đã sắp (giữ UI L-33)
  v_ke_ten := v_ds->0->>'ten_buoc';
  v_xong_mon := (v_tong > 0 and v_xong >= v_tong);

  return jsonb_build_object(
    'tem', p_tem, 'buoc_hien_tai', v_cur, 'ten_buoc_hien_tai', v_cur_ten,
    'buoc_ke_tiep', v_ke, 'ten_buoc_ke_tiep', v_ke_ten,
    'buoc_ke_ds', v_ds, 'xong_mon', v_xong_mon,
    'xong', v_xong, 'tong_buoc', v_tong,
    'dung_yen_phut', case when v_last is null then null else round((extract(epoch from now()-v_last)/60)::numeric,1) end,
    'gio_cham_tay', round(v_cham::numeric, 4),
    'gio_troi_qua', case when v_first is null then 0 else round((extract(epoch from coalesce(v_last,v_first)-v_first)/3600)::numeric, 4) end);
end $function$;
grant execute on function kho.tien_do_tam(text, text) to authenticated;

-- tram_quet: TRUYỀN p_tram xuống tien_do_tam (để cua_tram_nay đúng ở UI) + lộ buoc_ke_ds. Giữ buoc_ke cũ.
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
    v_tien := kho.tien_do_tam(p_tem, p_tram);
    v_phut := (g->>'so_phut')::int;
    return g || jsonb_build_object('tam', v_tam, 'mon', v_mon, 'don', v_don, 'hoat_dong_ten', v_hd_ten,
      'mat_phut', v_phut, 'buoc_ke', v_tien->>'ten_buoc_ke_tiep', 'buoc_ke_ds', v_tien->'buoc_ke_ds',
      'xong', v_tien->'xong', 'tong_buoc', v_tien->'tong_buoc', 'xong_mon', v_tien->'xong_mon');
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

commit;
