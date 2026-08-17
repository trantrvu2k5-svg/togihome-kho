-- db/106 — L-77c: BỘ SINH MÃ + đường ba tầng tạo SP (lõi→biến thể→niêm yết). Idempotent.
--   Mã lõi <ma_dong>-NNN từ chuoi_so (loai='SPL-'||dong). Nội bộ = ma_loi (một mã duy nhất — chỉnh có chủ đích vs skill).
--   Tier niêm yết DÙNG LẠI tao_niem_yet (đã kiểm brand + giá sàn). Trùng tên: chuẩn hoá như db/104.
-- ═════ HOÀN TÁC: drop các function sp_peek_ma_loi/sp_tao_loi_moi/sp_tao_bien_the/sp_kiem_ten_trung; xoá dòng TB nếu muốn. ═════
begin;

-- dòng TB "Tủ bếp" (PHẦN 0)
insert into kho.dong_san_pham(ma_dong, ten, thu_tu) values ('TB','Tủ bếp',11)
  on conflict (ma_dong) do update set ten = excluded.ten, thu_tu = excluded.thu_tu;

-- ── PEEK mã kế tiếp (KHÔNG tiêu — cho form hiện ngay) ──
create or replace function kho.sp_peek_ma_loi(p_dong text)
  returns text language sql stable security definer set search_path = kho as $$
  select p_dong || '-' || lpad((coalesce((select so_hien_tai from kho.chuoi_so where loai='SPL-'||p_dong and nam=0),0) + 1)::text, 3, '0');
$$;
grant execute on function kho.sp_peek_ma_loi(text) to authenticated;

-- ── TẦNG 1 · tạo LÕI (mã tự sinh, gắn dòng) ──
create or replace function kho.sp_tao_loi_moi(p_dong text, p_ten_ky_thuat text, p_nhom text default null, p_kich_thuoc text default null, p_ghi_chu text default null)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_so int; v_ma text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'sp_tao_loi_moi: chỉ ceo/ke_toan'; end if;
  if not exists (select 1 from kho.dong_san_pham where ma_dong = p_dong) then raise exception 'sp_tao_loi_moi: dòng "%" không hợp lệ', p_dong; end if;
  if coalesce(btrim(p_ten_ky_thuat),'') = '' then raise exception 'sp_tao_loi_moi: thiếu tên kỹ thuật'; end if;
  -- tiêu chuoi_so ATOMIC theo dòng
  insert into kho.chuoi_so(loai, nam, so_hien_tai) values ('SPL-'||p_dong, 0, 1)
    on conflict (loai, nam) do update set so_hien_tai = kho.chuoi_so.so_hien_tai + 1
    returning so_hien_tai into v_so;
  v_ma := p_dong || '-' || lpad(v_so::text, 3, '0');
  insert into kho.san_pham_loi(ma_loi, ten_ky_thuat, nhom_hang, kich_thuoc, nguon, ghi_chu, ma_ns_tao, dong_id)
    values (v_ma, p_ten_ky_thuat, p_nhom, p_kich_thuoc, 'xuong', p_ghi_chu, kho.current_ns(), p_dong);
  return jsonb_build_object('ok', true, 'ma_loi', v_ma);
end $$;
grant execute on function kho.sp_tao_loi_moi(text,text,text,text,text) to authenticated;

-- ── TẦNG 2 · tạo BIẾN THỂ (SKU <ma_loi>-NN atomic) ──
create or replace function kho.sp_tao_bien_the(p_ma_loi text, p_ten text, p_vat_lieu text default null, p_kich_thuoc text default null, p_dai int default null, p_rong int default null, p_cao int default null)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_so int; v_sku text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'sp_tao_bien_the: chỉ ceo/ke_toan'; end if;
  if not exists (select 1 from kho.san_pham_loi where ma_loi = p_ma_loi) then raise exception 'sp_tao_bien_the: không có lõi "%"', p_ma_loi; end if;
  if coalesce(btrim(p_ten),'') = '' then raise exception 'sp_tao_bien_the: thiếu tên biến thể'; end if;
  insert into kho.chuoi_so(loai, nam, so_hien_tai) values ('SPM-'||p_ma_loi, 0, 1)
    on conflict (loai, nam) do update set so_hien_tai = kho.chuoi_so.so_hien_tai + 1
    returning so_hien_tai into v_so;
  v_sku := p_ma_loi || '-' || lpad(v_so::text, 2, '0');
  insert into kho.san_pham_mau(ma, ten, ma_loi, vat_lieu, kich_thuoc, dai_mm, rong_mm, cao_mm, ngung, vl_chua_xac_nhan, da_soat_tay)
    values (v_sku, p_ten, p_ma_loi, p_vat_lieu, p_kich_thuoc, p_dai, p_rong, p_cao, false, false, false);
  return jsonb_build_object('ok', true, 'ma', v_sku);
end $$;
grant execute on function kho.sp_tao_bien_the(text,text,text,text,int,int,int) to authenticated;

-- ── KIỂM TRÙNG tên (chuẩn hoá thường + gộp dấu cách — như db/104) so với niêm yết + món tự do lặp ──
create or replace function kho.sp_kiem_ten_trung(p_ten text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_chuan text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'sp_kiem_ten_trung: chỉ ceo/ke_toan'; end if;
  v_chuan := lower(btrim(regexp_replace(coalesce(p_ten,''), '\s+', ' ', 'g')));
  return jsonb_build_object(
    'trung_niem_yet', exists(select 1 from kho.niem_yet where lower(btrim(regexp_replace(coalesce(ten_ban_hang,''),'\s+',' ','g')))=v_chuan
                               or lower(btrim(regexp_replace(coalesce(ten_dai,''),'\s+',' ','g')))=v_chuan),
    'trung_mon_tu_do', (select count(*)::int from kho.don_hang_mon m join kho.don_hang d on d.id=m.don_id
        where m.sp_id is null and coalesce(d.la_demo,false)=false
          and lower(btrim(regexp_replace(coalesce(m.ten,''),'\s+',' ','g')))=v_chuan));
end $$;
grant execute on function kho.sp_kiem_ten_trung(text) to authenticated;

-- ── map lõi→dòng (cho Cây nhóm theo dòng, không đổi chữ ký sp_danh_sach) ──
create or replace function kho.sp_loi_dong()
  returns jsonb language sql stable security definer set search_path = kho as $$
  select coalesce(jsonb_object_agg(l.ma_loi, jsonb_build_object('dong', l.dong_id,
           'ten', (select d.ten from kho.dong_san_pham d where d.ma_dong = l.dong_id), 'tt', coalesce((select thu_tu from kho.dong_san_pham d where d.ma_dong=l.dong_id),99))), '{}'::jsonb)
  from kho.san_pham_loi l;
$$;
grant execute on function kho.sp_loi_dong() to authenticated;

do $$ begin
  if to_regprocedure('kho.sp_tao_loi_moi(text,text,text,text,text)') is null then raise exception 'THIẾU sp_tao_loi_moi'; end if;
  raise notice 'db/106 OK: TB dòng + sp_peek_ma_loi + sp_tao_loi_moi + sp_tao_bien_the + sp_kiem_ten_trung (tier 3 dùng lại tao_niem_yet).';
end $$;
commit;
