-- db/100 — L-69: tab ĐIỀU HÀNH (CEO nhìn, chỉ ĐỌC). KHÔNG bảng/trigger mới. Idempotent.
--   (a) NỚI guard sale_bao_gia_ds + sale_dai_so_bao_gia: +ke_toan (tab Điều hành ceo/ke_toan tái dùng cho phễu + dải).
--       BODY sao chép NGUYÊN từ bản đang chạy (pg_get_functiondef), chỉ đổi 1 dòng guard — không viết lại logic.
--   (b) MỚI dieu_hanh_bang: gom SX-tắc quét + giao-chưa-thu + giá trị tồn (v_ton_gia_von). Guard ceo/ke_toan, có limit.
--   Nguồn từng khối ghi ở tab. Block1 báo-giá-tắc + Block2 phễu = từ sale_bao_gia_ds (gd). Block3 = sale_dai_so_bao_gia.
--       Block4 tải tuần = tai_theo_to_tuan (đã cho ceo/ke_toan). Block5 tiền = dieu_hanh_bang + Sổ đơn.
-- ═════ HOÀN TÁC: chạy lại db/091 + db/099 (khôi phục guard cũ) + drop function dieu_hanh_bang(int). ═════
begin;

-- ── (a) nới guard (body nguyên bản, +ke_toan) ──
CREATE OR REPLACE FUNCTION kho.sale_bao_gia_ds(p_gioi_han integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ds jsonb; v_tong int;
begin
  if v_vai not in ('sale','truong_nhom_sale','ceo','ke_toan') then
    raise exception 'sale_bao_gia_ds: chỉ sale/truong_nhom_sale/ceo (vai "%")',
      coalesce(nullif(v_vai,''),'(chưa đăng nhập)');
  end if;

  with ban_moi as (   -- bản MỚI NHẤT mỗi đơn
    select distinct on (ma_don) ma_don, id ban_id, trang_thai bt_tt, phien_ban, luc_gui
    from kho.ban_thiet_ke order by ma_don, phien_ban desc
  ), lk as (          -- bản mới nhất ĐÃ gửi link chưa + ngày gửi link gần nhất
    select bm.ma_don, exists(select 1 from kho.link_ban_khach l where l.ban_id = bm.ban_id) co_link,
           (select max(l.tao_luc) from kho.link_ban_khach l where l.ban_id = bm.ban_id) gui_luc
    from ban_moi bm
  ), bg as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') ten_khach,
      d.trang_thai, d.buoc_thiet_ke, d.ma_ns_thiet_ke, d.loai, d.thuong_hieu,
      d.ngay_hen_khach, d.ly_do_thua, d.cap_thiet_ke, nullif(btrim(d.ghi_chu),'') ghi_chu,
      coalesce(d.doanh_thu, d.gia_goc) tien,                              -- GIÁ BÁN (không giá vốn)
      (d.ngay_hen_khach is null) chua_co_ngay,
      bm.ban_id, coalesce(bm.phien_ban,0) pb, bm.bt_tt, lk.co_link,
      (current_date - coalesce(d.ngay_tao_bao_gia::date, bm.luc_gui::date, current_date)) mo_ngay,
      (current_date - coalesce(lk.gui_luc::date, bm.luc_gui::date, current_date)) cho_khach,
      (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id) so_mon,
      (select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1) mon_ten,
      (select ho_ten from kho.nguoi_dung n where n.id = d.ma_ns_thiet_ke) ai_dung,
      (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = d.ma_don
         and b.trang_thai in ('khach_doi_y','chua_dung_yeu_cau')) vong_sua
    from kho.don_hang d
      left join ban_moi bm on bm.ma_don = d.ma_don
      left join lk on lk.ma_don = d.ma_don
    where d.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo')
  ), gd as (
    select *, case
      when trang_thai='bao_gia_thua'                       then 'thua'
      when trang_thai='bao_gia_treo'                       then 'treo'
      when bt_tt='khach_duyet'                             then 'du_len_don'
      when buoc_thiet_ke='sua_gop_y'                       then 'sua_gop_y'
      when bt_tt='cho_duyet' and co_link                   then 'da_gui'
      when bt_tt='cho_duyet' and not coalesce(co_link,false) then 'ban_moi'
      when ma_ns_thiet_ke is null                          then 'chua_nhan'
      else 'dang_dung'
    end gd
    from bg
  )
  select count(*)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'ten_khach',ten_khach,'gd',gd,'mo_ngay',mo_ngay,'so_mon',so_mon,'mon_ten',mon_ten,
      'pb',pb,'ai_dung',ai_dung,'vong_sua',vong_sua,'ngay_hen',ngay_hen_khach,'tien',tien,
      'cho_khach',cho_khach,'ban_id',ban_id,'loai',loai,'thuong_hieu',thuong_hieu,'ly_thua',ly_do_thua,
      'cap',cap_thiet_ke,'ghi_chu',ghi_chu,'chua_co_ngay',chua_co_ngay)
      order by mo_ngay desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)), '[]'::jsonb)
    into v_tong, v_ds
  from (select *, row_number() over (order by mo_ngay desc, ma_don) rn from gd) x;

  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'cat', (v_tong > p_gioi_han));
end $function$
;

CREATE OR REPLACE FUNCTION kho.sale_dai_so_bao_gia(p_gioi_han integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); r jsonb;
begin
  if v_vai not in ('sale','truong_nhom_sale','tk_ban_hang','ceo','ke_toan') then
    raise exception 'sale_dai_so_bao_gia: chỉ sale/truong_nhom_sale/tk_ban_hang/ceo (vai "%")',
      coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;

  with f as (   -- FUNNEL báo giá: đơn thật (không demo) đã có báo giá
    select d.ma_don, d.trang_thai, d.ly_do_thua, d.tao_luc, d.ngay_tao_bao_gia, d.ngay_chot,
           d.tu_dung, coalesce(d.doanh_thu, d.gia_goc) tien,          -- GIÁ BÁN, không giá vốn
           coalesce(d.ma_ns_tk_ban_hang, d.nguoi_tao) sale_id,
           (d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy','tam_ngung')) chot,
           (d.phong_cach is not null or d.ngan_sach_trieu is not null) co_nhu_cau,
           (select count(*) from kho.ban_thiet_ke b
              where b.ma_don = d.ma_don and b.trang_thai in ('khach_doi_y','chua_dung_yeu_cau')) vong_sua
    from kho.don_hang d
    where coalesce(d.la_demo,false) = false and d.ngay_tao_bao_gia is not null
  )
  select jsonb_build_object(
    -- ① thua vì giá / tổng thua
    'so1_thua_gia', (select jsonb_build_object(
        'ti_le', case when count(*) > 0 then round(count(*) filter (where ly_do_thua='gia_cao')::numeric / count(*), 3) end,
        'thua_gia', count(*) filter (where ly_do_thua='gia_cao'), 'tong_thua', count(*), 'n', count(*))
      from f where trang_thai='bao_gia_thua'),
    -- ② quãng hỏi (đơn mở) → khách thấy giá (báo giá tạo), TRUNG VỊ ngày
    'so2_hoi_den_gia', (select jsonb_build_object(
        'trung_vi_ngay', round(percentile_cont(0.5) within group (order by (ngay_tao_bao_gia::date - tao_luc::date))::numeric, 1),
        'n', count(*)) from f where tao_luc is not null),
    -- ③ tỉ lệ chốt trong 7/14/25 ngày kể từ báo giá (mẫu số = cả funnel)
    'so3_chot_theo_treo', (select jsonb_build_object(
        'd7',  round(avg((chot and ngay_chot is not null and (ngay_chot - ngay_tao_bao_gia::date) <= 7)::int)::numeric, 3),
        'd14', round(avg((chot and ngay_chot is not null and (ngay_chot - ngay_tao_bao_gia::date) <= 14)::int)::numeric, 3),
        'd25', round(avg((chot and ngay_chot is not null and (ngay_chot - ngay_tao_bao_gia::date) <= 25)::int)::numeric, 3),
        'n', count(*)) from f),
    -- ④ vòng sửa TB — tách có/không ghi nhu cầu (phong_cach/ngân sách)
    'so4_vong_sua', (select jsonb_build_object(
        'co_nhu_cau', jsonb_build_object('tb', round(avg(vong_sua) filter (where co_nhu_cau), 2), 'n', count(*) filter (where co_nhu_cau)),
        'khong',      jsonb_build_object('tb', round(avg(vong_sua) filter (where not co_nhu_cau), 2), 'n', count(*) filter (where not co_nhu_cau))) from f),
    -- ⑤ tỉ lệ chốt: tu_dung vs giao thiết kế
    'so5_chot_tu_dung', (select jsonb_build_object(
        'tu_dung', jsonb_build_object('ti_le', round(avg(chot::int) filter (where tu_dung), 3),                'n', count(*) filter (where tu_dung)),
        'giao_tk', jsonb_build_object('ti_le', round(avg(chot::int) filter (where not coalesce(tu_dung,false)), 3), 'n', count(*) filter (where not coalesce(tu_dung,false)))) from f),
    -- ⑥ tỉ lệ chốt + đơn TB theo sale (CÔNG KHAI) — LIST có limit
    'so6_theo_sale', (select coalesce(jsonb_agg(s.j order by (s.j->>'n')::int desc), '[]'::jsonb)
      from (
        select jsonb_build_object('sale', coalesce(nn.ho_ten,'(chưa gán)'),
                 'ti_le_chot', round(avg(f.chot::int), 3), 'don_tb', round(avg(f.tien)), 'n', count(*)) j
        from f left join kho.nguoi_dung nn on nn.id = f.sale_id
        group by coalesce(nn.ho_ten,'(chưa gán)')
        order by count(*) desc
        limit greatest(p_gioi_han, 0)
      ) s(j)),
    'tong_funnel', (select count(*) from f),
    'nguong_tam', 30                                   -- app dán [TẠM] khi n < ngưỡng này
  ) into r;
  return r;
end $function$
;


-- ── (b) MỚI · dieu_hanh_bang: SX-tắc quét + giao-chưa-thu + giá trị tồn (blocks 1-còn-lại · 4 · 5) ──
create or replace function kho.dieu_hanh_bang(p_gioi_han int default 100)
  returns jsonb language plpgsql stable security definer set search_path = kho as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); r jsonb;
  c_sx_lang int := 2;   -- ngưỡng "không quét gì" (ngày) — HẰNG SỐ mặc định (chưa có bảng cài đặt ngưỡng riêng)
begin
  if v_vai not in ('ceo','ke_toan') then
    raise exception 'dieu_hanh_bang: chỉ ceo/ke_toan (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  return (
  with sx as (   -- món đang chạy CHƯA XONG (theo tem), đo số ngày từ lần cập nhật (quét) gần nhất
    select t.ma_don, t.to_hien_tai, (current_date - t.cap_nhat_luc::date) lang
    from kho.tien_do_tem t
    where coalesce(t.so_buoc_xong,0) < coalesce(t.tong_so_buoc,0)
  ), sx_tac as (
    select s.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') ten_khach,
      max(s.lang) lang, count(*) so_tem,
      (array_agg(distinct s.to_hien_tai) filter (where s.to_hien_tai is not null))[1] to_cam
    from sx s join kho.don_hang d on d.ma_don = s.ma_don
    where s.lang > c_sx_lang and coalesce(d.la_demo,false)=false
    group by s.ma_don, d.ten_khach
  ), giao as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') ten_khach, d.ngay_giao,
      (coalesce(d.doanh_thu, d.gia_chot, d.gia_cong_thuc, 0) - coalesce(d.so_tien_thuc_thu,0)) con_thu
    from kho.don_hang d
    where d.ngay_giao is not null and coalesce(d.la_demo,false)=false
      and coalesce(d.so_tien_thuc_thu,0) < coalesce(d.doanh_thu, d.gia_chot, d.gia_cong_thuc, 0)
  )
  select jsonb_build_object(
    'nguong_sx_lang', c_sx_lang,
    'sx_dang', (select count(distinct ma_don) from sx),
    'sx_tac', (select coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'ten_khach',ten_khach,'lang',lang,'to',to_cam,'so_tem',so_tem) order by lang desc),'[]'::jsonb)
               from (select * from sx_tac order by lang desc limit greatest(p_gioi_han,0)) z),
    'so_don_sx_tac', (select count(*) from sx_tac),
    'giao_chua_thu', (select coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'ten_khach',ten_khach,'ngay_giao',ngay_giao,'con_thu',con_thu) order by con_thu desc),'[]'::jsonb)
               from (select * from giao order by con_thu desc limit greatest(p_gioi_han,0)) z),
    'so_don_giao_no', (select count(*) from giao),
    'phai_thu_tong', (select coalesce(sum(con_thu),0) from giao),
    'ton_gia_tri', (select coalesce(sum(so_luong * gia_von_bq),0) from kho.ton)   -- đọc THẲNG kho.ton: v_ton_gia_von gate ceo/kho, ke_toan sẽ ra 0; RPC này đã guard ceo/ke_toan nên xem tổng giá trị tồn hợp lệ
  ));
end $fn$;
grant execute on function kho.dieu_hanh_bang(int) to authenticated;

do $$ begin
  if to_regprocedure('kho.dieu_hanh_bang(int)') is null then raise exception 'THIẾU dieu_hanh_bang'; end if;
  raise notice 'db/100 OK: +ke_toan (sale_bao_gia_ds, sale_dai_so_bao_gia) + dieu_hanh_bang (SX-tắc/giao-nợ/tồn). Ngưỡng SX-lãng=2 ngày (mặc định).';
end $$;
commit;
