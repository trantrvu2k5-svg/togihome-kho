-- 059 — Sửa brand + RPC tự phục vụ (CEO tự thêm/sửa/tắt brand, không nhờ chạy SQL).
--   CEO chốt: khanhconcept·Thago·Mulig ĐỀU là thương hiệu (không phải kênh bán). Chỉ showroom = kenh_ban.
--   Khoá ma_3chu sau khi đã sinh mã niêm yết (mã cũ đã in tem, đổi = mã chết).
--   node ops/run_sql.mjs ../db/059_quan_ly_thuong_hieu.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.tat_thuong_hieu(text); drop function if exists kho.doi_ma_3chu(text,text);
--   drop function if exists kho.sua_thuong_hieu(text,text,text,text); drop function if exists kho.them_thuong_hieu(text,text,text,text,text);
--   drop function if exists kho.ma_3chu_trong(text);
--   delete from kho.thuong_hieu where ma in ('thago','mulig');
--   update kho.thuong_hieu set loai='kenh_ban', ma_3chu=null where ma='khanhconcept';
--   -- tao_niem_yet: khôi phục bản db/058 (bỏ check ngung) — xem git.
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ SỬA DỮ LIỆU BRAND (CEO chốt) ════════
update kho.thuong_hieu set loai = 'thuong_hieu', ma_3chu = 'KHA' where ma = 'khanhconcept';
insert into kho.thuong_hieu(ma, ten, loai, ma_3chu, ngung) values
  ('thago','Thago','thuong_hieu','THA',false),
  ('mulig','Mulig','thuong_hieu','MUL',false)
  on conflict (ma) do update set loai = 'thuong_hieu', ma_3chu = excluded.ma_3chu;

-- ════════ Helper: gợi ý mã 3 chữ CÒN TRỐNG (khi trùng) ════════
create or replace function kho.ma_3chu_trong(p_goi text) returns text language plpgsql stable security definer set search_path = kho as $$
declare base text; cand text; i int := 0;
begin
  base := upper(left(regexp_replace(kho.bo_dau(p_goi), '[^a-z]', '', 'g'), 3));
  if length(base) < 3 then base := rpad(base, 3, 'X'); end if;
  cand := base;
  while exists (select 1 from kho.thuong_hieu where ma_3chu = cand) and i < 26 loop
    cand := left(base, 2) || chr(65 + i); i := i + 1;
  end loop;
  return cand;
end $$;

-- ════════ RPC THÊM brand — ceo (fail-đóng), ma_3chu UNIQUE + gợi ý ════════
create or replace function kho.them_thuong_hieu(p_ma text, p_ten text, p_ma_3chu text, p_loai text, p_mo_ta text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ma text; v_ma3 text;
begin
  if coalesce(kho.current_vai_tro(),'') <> 'ceo' then raise exception 'them_thuong_hieu: chỉ ceo'; end if;
  v_ma := lower(btrim(coalesce(p_ma,''))); v_ma3 := upper(btrim(coalesce(p_ma_3chu,'')));
  if v_ma = '' or coalesce(btrim(p_ten),'') = '' then raise exception 'them_thuong_hieu: thiếu mã hoặc tên'; end if;
  if exists (select 1 from kho.thuong_hieu where ma = v_ma) then raise exception 'them_thuong_hieu: brand "%" đã có', v_ma; end if;
  if coalesce(p_loai,'thuong_hieu') not in ('thuong_hieu','kenh_ban') then raise exception 'them_thuong_hieu: loai không hợp lệ'; end if;
  if v_ma3 <> '' then
    if length(v_ma3) <> 3 then raise exception 'them_thuong_hieu: mã 3 chữ phải đúng 3 ký tự'; end if;
    if exists (select 1 from kho.thuong_hieu where ma_3chu = v_ma3) then
      raise exception 'them_thuong_hieu: mã 3 chữ "%" đã dùng — thử "%"', v_ma3, kho.ma_3chu_trong(p_ten); end if;
  end if;
  insert into kho.thuong_hieu(ma, ten, ma_3chu, loai, mo_ta, ngung)
    values (v_ma, p_ten, nullif(v_ma3,''), coalesce(p_loai,'thuong_hieu'), p_mo_ta, false);
  return jsonb_build_object('ok', true, 'ma', v_ma, 'ma_3chu', nullif(v_ma3,''));
end $$;
grant execute on function kho.them_thuong_hieu(text,text,text,text,text) to authenticated;

-- ════════ RPC SỬA brand (KHÔNG đụng ma_3chu) — ceo ════════
create or replace function kho.sua_thuong_hieu(p_ma text, p_ten text, p_mo_ta text, p_loai text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') <> 'ceo' then raise exception 'sua_thuong_hieu: chỉ ceo'; end if;
  if coalesce(p_loai,'thuong_hieu') not in ('thuong_hieu','kenh_ban') then raise exception 'sua_thuong_hieu: loai không hợp lệ'; end if;
  update kho.thuong_hieu set ten = coalesce(nullif(btrim(p_ten),''), ten), mo_ta = p_mo_ta, loai = coalesce(p_loai, loai) where ma = p_ma;
  if not found then raise exception 'sua_thuong_hieu: không có brand "%"', p_ma; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function kho.sua_thuong_hieu(text,text,text,text) to authenticated;

-- ════════ RPC ĐỔI ma_3chu — KHOÁ khi đã có niêm yết (mã cũ đã in tem) — ceo ════════
create or replace function kho.doi_ma_3chu(p_ma text, p_ma_3chu_moi text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ma3 text;
begin
  if coalesce(kho.current_vai_tro(),'') <> 'ceo' then raise exception 'doi_ma_3chu: chỉ ceo'; end if;
  if not exists (select 1 from kho.thuong_hieu where ma = p_ma) then raise exception 'doi_ma_3chu: không có brand "%"', p_ma; end if;
  if exists (select 1 from kho.niem_yet where ma_thuong_hieu = p_ma) then
    raise exception 'doi_ma_3chu: brand "%" ĐÃ CÓ niêm yết — không đổi mã 3 chữ (mã cũ đã in tem, đã gửi khách)', p_ma; end if;
  v_ma3 := upper(btrim(coalesce(p_ma_3chu_moi,'')));
  if length(v_ma3) <> 3 then raise exception 'doi_ma_3chu: mã 3 chữ phải đúng 3 ký tự'; end if;
  if exists (select 1 from kho.thuong_hieu where ma_3chu = v_ma3 and ma <> p_ma) then
    raise exception 'doi_ma_3chu: mã "%" đã dùng — thử "%"', v_ma3, kho.ma_3chu_trong(v_ma3); end if;
  update kho.thuong_hieu set ma_3chu = v_ma3 where ma = p_ma;
  return jsonb_build_object('ok', true, 'ma_3chu', v_ma3);
end $$;
grant execute on function kho.doi_ma_3chu(text,text) to authenticated;

-- ════════ RPC TẮT brand — CHỈ TẮT, KHÔNG XOÁ (niêm yết cũ vẫn tra được) — ceo ════════
create or replace function kho.tat_thuong_hieu(p_ma text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') <> 'ceo' then raise exception 'tat_thuong_hieu: chỉ ceo'; end if;
  update kho.thuong_hieu set ngung = true where ma = p_ma;
  if not found then raise exception 'tat_thuong_hieu: không có brand "%"', p_ma; end if;
  return jsonb_build_object('ok', true, 'da_tat', p_ma);
end $$;
grant execute on function kho.tat_thuong_hieu(text) to authenticated;
-- (KHÔNG có hàm xoá brand — tắt là hết mức phá.)

-- ════════ tao_niem_yet: THÊM chốt "brand đã TẮT → không tạo niêm yết mới" (re-create bản db/058 + 1 dòng) ════════
create or replace function kho.tao_niem_yet(p_ma_bien_the text, p_ma_brand text, p_ten_ban_hang text, p_duong_dan text, p_ten_dai text, p_gia numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ma text; v_slug text; v_ma3 text; v_nhom text; v_seq int; v_yy text; v_san numeric; v_loai text; v_ngung boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'tao_niem_yet: chỉ ceo/ke_toan'; end if;
  if not exists (select 1 from kho.san_pham_mau where ma = p_ma_bien_the) then raise exception 'tao_niem_yet: không có biến thể "%"', p_ma_bien_the; end if;
  select ma_3chu, loai, ngung into v_ma3, v_loai, v_ngung from kho.thuong_hieu where ma = p_ma_brand;
  if v_ma3 is null then raise exception 'tao_niem_yet: brand "%" chưa gán mã 3 chữ (ma_3chu)', p_ma_brand; end if;
  if v_loai = 'kenh_ban' then raise exception 'tao_niem_yet: "%" là KÊNH BÁN, không phải thương hiệu sản phẩm', p_ma_brand; end if;
  if coalesce(v_ngung,false) then raise exception 'tao_niem_yet: brand "%" ĐÃ TẮT — không tạo niêm yết mới (niêm yết cũ vẫn tra được)', p_ma_brand; end if;
  if p_gia is null or p_gia < 0 then raise exception 'tao_niem_yet: giá không hợp lệ'; end if;
  v_slug := kho.bo_dau(coalesce(nullif(btrim(p_duong_dan),''), p_ten_ban_hang));
  if v_slug = '' then raise exception 'tao_niem_yet: tên/đường dẫn rỗng'; end if;
  if exists (select 1 from kho.niem_yet where duong_dan_chuan = v_slug) then
    raise exception 'tao_niem_yet: đường dẫn "%" đã tồn tại (trùng tên — kể cả khác brand)', v_slug; end if;
  select gia_le into v_san from kho.gia_niem_yet where sku_mau = p_ma_bien_the order by ma_ky desc limit 1;
  if v_san is not null and p_gia < v_san then
    raise exception 'tao_niem_yet: giá % dưới GIÁ SÀN % (gia_le kỳ đang chạy) — bán lỗ', p_gia, v_san; end if;
  v_yy := to_char(now(), 'YY');
  v_nhom := upper(left(kho.bo_dau(coalesce((select nhom_hang from kho.san_pham_loi l join kho.san_pham_mau s on s.ma_loi=l.ma_loi where s.ma=p_ma_bien_the), 'san-pham')), 3));
  select count(*) + 1 into v_seq from kho.niem_yet where ma_thuong_hieu = p_ma_brand and ma_ny like v_ma3 || '-%-' || v_yy || '-%';
  v_ma := v_ma3 || '-' || v_nhom || '-' || v_yy || '-' || lpad(v_seq::text, 3, '0');
  insert into kho.niem_yet(ma_ny, ma_bien_the, ma_thuong_hieu, ten_ban_hang, ten_dai, duong_dan, duong_dan_chuan, gia_niem_yet, ma_ns_tao)
    values (v_ma, p_ma_bien_the, p_ma_brand, p_ten_ban_hang, p_ten_dai, coalesce(nullif(btrim(p_duong_dan),''), v_slug), v_slug, p_gia, kho.current_ns());
  return jsonb_build_object('ok', true, 'ma_ny', v_ma, 'slug', v_slug);
end $$;
grant execute on function kho.tao_niem_yet(text,text,text,text,text,numeric) to authenticated;

commit;
