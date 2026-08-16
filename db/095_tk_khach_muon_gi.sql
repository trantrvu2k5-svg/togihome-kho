-- db/095 — tk_chi_tiet_don TRẢ THÊM "Khách muốn gì" cho app Thiết kế (L-58 PHẦN 2).
--   Thêm phong_cach · ngan_sach_trieu · link (db/092) vào return — vế còn lại của khung xanh
--   "Thiết kế đọc đúng những gì ghi ở đây". ghi_chu (=yêu cầu riêng) đã có sẵn. Re-define nguyên hàm
--   (lấy từ pg_get_functiondef, chỉ chèn 3 khoá). Chạy: cd web && node ops/run_sql.mjs ../db/095_tk_khach_muon_gi.sql
-- ══════════ HOÀN TÁC ══════════  chạy lại db/057 (bản không có 3 trường).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

CREATE OR REPLACE FUNCTION kho.tk_chi_tiet_don(p_ma_don text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_don kho.don_hang; v_mon jsonb; v_lich jsonb; v_ban_kd jsonb; v_ns uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_chi_tiet_don: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'tk_chi_tiet_don: không có đơn "%"', p_ma_don; end if;
  v_ns := kho.current_ns();
  select coalesce(jsonb_agg(jsonb_build_object(
      'ten', m.ten, 'kt', m.kt, 'vl', m.vl, 'mau', (select s.ten from kho.mau_sac s where s.ma = m.ma_mau),
      'chi_tiet', m.chi_tiet, 'so_luong', m.so_luong, 'dung_moi', m.dung_moi) order by m.id), '[]'::jsonb)
    into v_mon from kho.don_hang_mon m where m.don_id = v_don.id;
  select coalesce(jsonb_agg(e order by (e->>'luc')), '[]'::jsonb) into v_lich from (
    select jsonb_build_object('luc', x.luc, 'viec', x.viec) e from (
      select v_don.luc_nhan_thiet_ke luc, 'Nhận việc'::text viec where v_don.luc_nhan_thiet_ke is not null
      union all select b.luc_gui, 'Gửi bản 3D cho sale · phiên ' || b.phien_ban from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_gui is not null
      union all select b.luc_phan_hoi, 'Sale: ' || case b.trang_thai when 'khach_duyet' then 'Khách duyệt' when 'khach_doi_y' then 'Khách đổi ý'
             when 'chua_dung_yeu_cau' then 'Trả về — chưa đúng yêu cầu' else b.trang_thai end
        from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_phan_hoi is not null
      union all select f.luc_gui, 'Gửi file sản xuất cho xưởng (' || f.loai_file || ')' from kho.file_san_xuat f where f.ma_don = p_ma_don
      union all select min(t.ghi_luc), 'Đẩy tem file cắt · phiên ' || t.phien_ban from kho.tem_ban_ve t where t.ma_don = p_ma_don group by t.phien_ban
    ) x where x.luc is not null
  ) y;
  select jsonb_build_object('phien_ban', b.phien_ban, 'luc_duyet', b.luc_phan_hoi,
      'nguoi_ban_hang', (select ho_ten from kho.nguoi_dung where id = coalesce(v_don.ma_ns_tk_ban_hang, b.ma_ns_gui)),
      'file_nguon', case when b.file_3d_path is not null then jsonb_build_object('duong_dan', b.file_3d_path, 'byte', b.file_3d_byte) else null end,
      'anh', (select coalesce(jsonb_agg(a.duong_dan_to order by a.thu_tu), '[]'::jsonb) from kho.anh_ban_thiet_ke a where a.ban_id = b.id))
    into v_ban_kd from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet' order by b.phien_ban desc limit 1;
  return jsonb_build_object(
    'ma_don', v_don.ma_don,
    'ten', coalesce((select m.ten from kho.don_hang_mon m where m.don_id = v_don.id order by m.id limit 1), 'Đơn ' || v_don.ma_don),
    'loai', v_don.loai, 'cap_thiet_ke', v_don.cap_thiet_ke, 'buoc_thiet_ke', coalesce(v_don.buoc_thiet_ke,'cho_nhan'),
    'trang_thai', v_don.trang_thai, 'ghi_chu', v_don.ghi_chu, 'phong_cach', v_don.phong_cach, 'ngan_sach_trieu', v_don.ngan_sach_trieu, 'link', v_don.link,
    'viec', case when v_don.loai = 'mau_moi' then 'mau' when v_don.trang_thai in ('bao_gia','bao_gia_treo') then 'tk_ban_hang' else 'thiet_ke' end,
    'la_bao_gia', v_don.trang_thai in ('bao_gia','bao_gia_treo'),
    'gio_uoc', kho.gio_uoc_cap(v_don.cap_thiet_ke),
    'gio_thuc', coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_don = p_ma_don), 0),
    'vong_sua', (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')),
    'ai_cam', (select n.ho_ten from kho.nguoi_dung n where n.id = v_don.ma_ns_thiet_ke),
    'vai_cam', (select n.vai_tro from kho.nguoi_dung n where n.id = v_don.ma_ns_thiet_ke),
    'la_toi_cam', v_don.ma_ns_thiet_ke = v_ns,
    'sale_ghi_chu', (select b.ghi_chu_phan_hoi from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y') order by b.luc_phan_hoi desc nulls last limit 1),
    'da_gui_xuong', exists (select 1 from kho.file_san_xuat f where f.ma_don = p_ma_don),
    'ngay_hen_khach', v_don.ngay_hen_khach,
    'ban_khach_duyet', v_ban_kd,
    'mon', v_mon, 'lich_su', v_lich);
end $function$
;

do $$ begin raise notice 'db/095 OK: tk_chi_tiet_don +phong_cach +ngan_sach_trieu +link (Khách muốn gì)'; end $$;
commit;
