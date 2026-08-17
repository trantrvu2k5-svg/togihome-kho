-- db/104 — L-74: RPC cho 3 khối MỚI (chỉ đọc, gom nguồn sẵn). Idempotent.
--   B · xuong_nhin_lai (Quản đốc): giờ chạm-tay chuẩn-vs-thực theo tổ · lỗi&làm-lại · tắc quét. Guard xuong/ceo. KHÔNG tiền.
--   C · sp_so_ban (Sản phẩm): số bán theo dòng/thương hiệu · món tự do lặp. Guard ceo/ke_toan.
--   D · dieu_hanh_cong_no_khach (Tài chính): công nợ đã-giao-chưa-thu GOM theo khách. Guard ceo/ke_toan.
-- ═════ HOÀN TÁC: drop 3 function ở dưới. ═════
begin;

-- ── B · Quản đốc "Nhìn lại" ── (giờ = CHẠM TAY, khác thời-gian-trôi ở khối tắc quét — app dán nhãn rõ, QD-18)
create or replace function kho.xuong_nhin_lai(p_ngay int default 30, p_gioi_han int default 50)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); c_lang int := 2;
begin
  if v_vai not in ('xuong','ceo') then
    raise exception 'xuong_nhin_lai: chỉ xuong/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  return jsonb_build_object('nguong_tam', 30, 'so_ngay', p_ngay, 'nguong_lang', c_lang,
    -- KHỐI 1 · GIỜ CHẠM TAY chuẩn vs thực theo tổ (đơn vị: giờ LÀM, KHÔNG phải thời gian trôi)
    'gio_to', (select coalesce(jsonb_agg(jsonb_build_object(
        'to', coalesce(kho.tl_ten_to(z.ma_to), z.ma_to), 'ma_to', z.ma_to,
        'chuan', round(z.chuan,1), 'thuc', round(z.thuc,1),
        'chenh_pct', case when z.chuan>0 then round((z.thuc-z.chuan)/z.chuan*100,1) end, 'n', z.n) order by z.chuan desc), '[]'::jsonb)
      from (select ma_to, coalesce(sum(gio) filter (where moc='chuan'),0) chuan,
              coalesce(sum(gio) filter (where moc='thuc_te'),0) thuc, count(*) n
            from kho.gio_don_da_tinh where tinh_luc >= now()-(p_ngay||' days')::interval and ma_to is not null
            group by ma_to order by 2 desc limit greatest(p_gioi_han,0)) z),
    -- KHỐI 2 · LỖI & LÀM LẠI theo loại-lỗi × tổ (đếm + xu hướng tuần) — đầu vào DMAIC
    'loi', (select coalesce(jsonb_agg(jsonb_build_object(
        'loai_loi', z.loai_loi, 'to', coalesce(kho.tl_ten_to(z.ma_to), z.ma_to),
        'so_luong', z.sl, 'tuan_nay', z.tn, 'tuan_truoc', z.tt,
        'xu_huong', case when z.tn>z.tt then 'tăng' when z.tn<z.tt then 'giảm' else 'đứng' end) order by z.sl desc), '[]'::jsonb)
      from (select loai_loi, ma_to, sum(so_luong) sl,
              sum(so_luong) filter (where ngay >= current_date-7) tn,
              sum(so_luong) filter (where ngay >= current_date-14 and ngay < current_date-7) tt
            from kho.loi_lam_lai where ngay >= current_date-(p_ngay) group by loai_loi, ma_to order by 3 desc limit greatest(p_gioi_han,0)) z),
    -- KHỐI 3 · TẮC QUÉT: món chưa xong không quét > c_lang ngày (thời gian TRÔI) + tổ đang cầm
    'tac_quet', (select coalesce(jsonb_agg(jsonb_build_object(
        'ma_don', z.ma_don, 'ten_khach', z.ten_khach, 'lang', z.lang, 'so_tem', z.so_tem, 'to', z.to_cam) order by z.lang desc), '[]'::jsonb)
      from (select t.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') ten_khach,
              max(current_date - t.cap_nhat_luc::date) lang, count(*) so_tem,
              (array_agg(distinct t.to_hien_tai) filter (where t.to_hien_tai is not null))[1] to_cam
            from kho.tien_do_tem t join kho.don_hang d on d.ma_don=t.ma_don
            where coalesce(t.so_buoc_xong,0) < coalesce(t.tong_so_buoc,0) and coalesce(d.la_demo,false)=false
              and (current_date - t.cap_nhat_luc::date) > c_lang
            group by t.ma_don, d.ten_khach order by 3 desc limit greatest(p_gioi_han,0)) z));
end $$;
grant execute on function kho.xuong_nhin_lai(int,int) to authenticated;

-- ── C · Sản phẩm "Số bán theo dòng" ──
create or replace function kho.sp_so_ban(p_ngay int default 90, p_gioi_han int default 50)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('ceo','ke_toan') then
    raise exception 'sp_so_ban: chỉ ceo/ke_toan (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  return jsonb_build_object('nguong_tam', 30, 'so_ngay', p_ngay,
    -- KHỐI 1 · theo dòng × thương hiệu (90 ngày)
    'theo_dong', (select coalesce(jsonb_agg(jsonb_build_object(
        'dong', z.dong, 'thuong_hieu', z.th, 'bao_gia', z.bg, 'chot', z.chot,
        'ti_le', case when z.bg>0 then round(z.chot::numeric/z.bg,3) end, 'gia_tri_tb', round(z.gtb), 'n', z.bg) order by z.bg desc), '[]'::jsonb)
      from (select coalesce(d.dong,'(?)') dong, coalesce(nullif(d.thuong_hieu,''),'(chưa rõ)') th,
              count(*) bg, count(*) filter (where d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy','tam_ngung')) chot,
              avg(coalesce(d.doanh_thu, d.gia_goc)) gtb
            from kho.don_hang d
            where coalesce(d.la_demo,false)=false and d.ngay_tao_bao_gia is not null
              and d.ngay_tao_bao_gia >= now()-(p_ngay||' days')::interval
            group by 1,2 order by 3 desc limit greatest(p_gioi_han,0)) z),
    -- KHỐI 2 · món TỰ DO (sp_id null) tên chuẩn-hoá (thường + gộp dấu cách thừa) lặp >=2 lần → ứng viên catalog
    'mon_lap', (select coalesce(jsonb_agg(jsonb_build_object(
        'ten', z.ten_chuan, 'so_lan', z.so_lan, 'gan_nhat', z.gan_nhat) order by z.so_lan desc, z.gan_nhat desc), '[]'::jsonb)
      from (select lower(btrim(regexp_replace(m.ten, '\s+', ' ', 'g'))) ten_chuan,
              count(*) so_lan, max(m.tao_luc) gan_nhat
            from kho.don_hang_mon m join kho.don_hang d on d.id=m.don_id
            where m.sp_id is null and coalesce(d.la_demo,false)=false and btrim(coalesce(m.ten,''))<>''
            group by 1 having count(*) >= 2 order by 2 desc limit greatest(p_gioi_han,0)) z));
end $$;
grant execute on function kho.sp_so_ban(int,int) to authenticated;

-- ── D · Công nợ đã-giao-chưa-thu GOM theo khách ──
create or replace function kho.dieu_hanh_cong_no_khach(p_gioi_han int default 100)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('ceo','ke_toan') then
    raise exception 'dieu_hanh_cong_no_khach: chỉ ceo/ke_toan (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'khach', z.khach, 'sdt', z.sdt, 'tong_phai_thu', z.tong, 'so_don', z.so_don, 'lau_nhat', z.lau) order by z.tong desc), '[]'::jsonb)
    from (
      select coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, max(d.khach_sdt) sdt,
        sum(coalesce(d.doanh_thu, d.gia_chot, d.gia_cong_thuc, 0) - coalesce(d.so_tien_thuc_thu,0)) tong,
        count(*) so_don, max(current_date - d.ngay_giao) lau
      from kho.don_hang d
      where d.ngay_giao is not null and coalesce(d.la_demo,false)=false
        and coalesce(d.so_tien_thuc_thu,0) < coalesce(d.doanh_thu, d.gia_chot, d.gia_cong_thuc, 0)
      group by 1 order by 3 desc limit greatest(p_gioi_han,0)) z);
end $$;
grant execute on function kho.dieu_hanh_cong_no_khach(int) to authenticated;

do $$ begin
  if to_regprocedure('kho.xuong_nhin_lai(int,int)') is null then raise exception 'THIẾU xuong_nhin_lai'; end if;
  if to_regprocedure('kho.sp_so_ban(int,int)') is null then raise exception 'THIẾU sp_so_ban'; end if;
  if to_regprocedure('kho.dieu_hanh_cong_no_khach(int)') is null then raise exception 'THIẾU dieu_hanh_cong_no_khach'; end if;
  raise notice 'db/104 OK: xuong_nhin_lai (xuong/ceo, không tiền) + sp_so_ban (ceo/ke_toan) + dieu_hanh_cong_no_khach (ceo/ke_toan).';
end $$;
commit;
