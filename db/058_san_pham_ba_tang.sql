-- 058 — NỀN BA TẦNG SẢN PHẨM (chưa dựng app). BỌC NGOÀI: KHÔNG sửa cột cũ san_pham_mau; 5 app + plugin vẫn chạy.
--   Lõi (thiết kế) → Biến thể (vật liệu, = san_pham_mau) → Niêm yết (brand bán ra). + Bộ sản phẩm.
--   CEO chốt: 14 mã san_pham_mau là DEMO, KHÔNG cần bảo vệ mã cũ → BỎ anh_xa_ma_cu.
--   Brand: DÙNG LẠI bảng thuong_hieu (cụm ads), CHỈ THÊM cột. gia_niem_yet(db/028) SỐNG CHUNG + chốt giá sàn.
--   node ops/run_sql.mjs ../db/058_san_pham_ba_tang.sql   (⚠ CHỜ test DB xanh + 5 app không vỡ.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.lai_theo_niem_yet(text); drop function if exists kho.ban_chay_theo_bien_the(text);
--   drop function if exists kho.ban_chay_theo_loi(text); drop function if exists kho.san_pham_trung_brand();
--   drop function if exists kho.tra_cuu_san_pham(text); drop function if exists kho.kiem_trung_ten(text);
--   drop function if exists kho.gia_von_bo(text); drop function if exists kho.them_mon_bo(text,text,integer);
--   drop function if exists kho.tao_bo(text,text,numeric); drop function if exists kho.tao_niem_yet(text,text,text,text,text,numeric);
--   drop function if exists kho.tao_loi(text,text,text,text,text,text); drop function if exists kho.bo_dau(text);
--   drop table if exists kho.bo_san_pham_mon; drop table if exists kho.bo_san_pham; drop table if exists kho.niem_yet;
--   drop table if exists kho.san_pham_loi cascade; drop sequence if exists kho.san_pham_loi_seq;
--   alter table kho.san_pham_mau drop column if exists ma_loi; alter table kho.san_pham_mau drop column if exists ma_vat_tu_chinh;
--   alter table kho.thuong_hieu drop column if exists ma_3chu; alter table kho.thuong_hieu drop column if exists loai; alter table kho.thuong_hieu drop column if exists mo_ta;
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ Helper: bỏ dấu tiếng Việt → slug chuẩn (lowercase, gộp khoảng trắng thành '-') ════════
create or replace function kho.bo_dau(p text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(regexp_replace(
    translate(lower(coalesce(p,'')),
      'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
    '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g')) $$;

-- ════════ ① BRAND — DÙNG LẠI thuong_hieu (cụm ads), CHỈ THÊM cột ════════
alter table kho.thuong_hieu add column if not exists ma_3chu text;   -- sinh mã niêm yết (TGH, TGS…); CHỜ CEO duyệt bảng ánh xạ
alter table kho.thuong_hieu add column if not exists loai text not null default 'thuong_hieu'
  check (loai in ('thuong_hieu','kenh_ban'));
alter table kho.thuong_hieu add column if not exists mo_ta text;
create unique index if not exists thuong_hieu_ma3chu_uq on kho.thuong_hieu(ma_3chu) where ma_3chu is not null;
-- CEO chốt: khanhconcept + showroom là KÊNH BÁN (đánh dấu, KHÔNG xoá)
update kho.thuong_hieu set loai = 'kenh_ban' where ma in ('khanhconcept','showroom');
-- ma_3chu: seed 6 brand rõ ràng (khớp mẫu CEO). Thago/Mulig CHƯA có trong bảng ads → CHỜ CEO, không tự thêm.
update kho.thuong_hieu set ma_3chu = case ma
  when 'togihome' then 'TGH' when 'togismart' then 'TGS' when 'sconcept' then 'SCO'
  when 'vufurni' then 'VUF' when 'haigo' then 'HAI' when 'openliving' then 'OPL' else ma_3chu end
  where ma in ('togihome','togismart','sconcept','vufurni','haigo','openliving');

-- ════════ ② TẦNG LÕI — thiết kế (KHÔNG brand, KHÔNG giá bán) ════════
create sequence if not exists kho.san_pham_loi_seq;
create table if not exists kho.san_pham_loi (
  ma_loi text primary key,
  ten_ky_thuat text not null,
  nhom_hang text,
  kich_thuoc text,
  nguon text not null default 'xuong' check (nguon in ('xuong','nhap_khau','dropship')),
  ma_ban_ve text,                    -- nối tem_ban_ve nếu có; nhập khẩu/dropship → NULL
  ghi_chu text,
  tao_luc timestamptz not null default now(),
  ma_ns_tao uuid references kho.nguoi_dung(id)
);
alter table kho.san_pham_loi enable row level security;
drop policy if exists spl_doc on kho.san_pham_loi;   -- ai cũng đọc được LÕI (thiết kế, không giá vốn)
create policy spl_doc on kho.san_pham_loi for select using (
  kho.current_vai_tro() = any (array['ceo','ke_toan','sale','thiet_ke','tk_ban_hang','xuong','kho','truong_nhom_thiet_ke','truong_nhom_sale']));
drop policy if exists spl_ghi on kho.san_pham_loi;
create policy spl_ghi on kho.san_pham_loi for all using (kho.current_vai_tro() = any (array['ceo','ke_toan']))
  with check (kho.current_vai_tro() = any (array['ceo','ke_toan']));

-- ════════ ③ san_pham_mau = TẦNG BIẾN THỂ — CHỈ THÊM cột (CẤM đụng cột cũ) ════════
alter table kho.san_pham_mau add column if not exists ma_loi text references kho.san_pham_loi(ma_loi);   -- NULL cho dòng cũ chưa gán
alter table kho.san_pham_mau add column if not exists ma_vat_tu_chinh text references kho.vat_tu(ma);     -- vật liệu lấy THẲNG từ kho

-- ════════ ④ TẦNG NIÊM YẾT — bản bán ra theo brand ════════
create table if not exists kho.niem_yet (
  ma_ny text primary key,
  ma_bien_the text not null references kho.san_pham_mau(ma),
  ma_thuong_hieu text not null references kho.thuong_hieu(ma),
  ten_ban_hang text not null,
  ten_ngan text,
  ten_dai text,
  duong_dan text not null,
  duong_dan_chuan text not null,     -- bỏ dấu, UNIQUE toàn hệ (chống trùng tên kể cả khác brand)
  gia_niem_yet numeric not null check (gia_niem_yet >= 0),
  dang_ban boolean not null default true,
  tao_luc timestamptz not null default now(),
  ma_ns_tao uuid references kho.nguoi_dung(id)
);
create unique index if not exists niem_yet_slug_uq on kho.niem_yet(duong_dan_chuan);
alter table kho.niem_yet enable row level security;
drop policy if exists ny_doc on kho.niem_yet;   -- niêm yết = giá BÁN (không phải giá vốn) → nhiều vai đọc
create policy ny_doc on kho.niem_yet for select using (
  kho.current_vai_tro() = any (array['ceo','ke_toan','sale','thiet_ke','tk_ban_hang','xuong','kho','truong_nhom_thiet_ke','truong_nhom_sale']));
drop policy if exists ny_ghi on kho.niem_yet;
create policy ny_ghi on kho.niem_yet for all using (kho.current_vai_tro() = any (array['ceo','ke_toan']))
  with check (kho.current_vai_tro() = any (array['ceo','ke_toan']));

-- ════════ ⑥ BỘ SẢN PHẨM ════════
create table if not exists kho.bo_san_pham (
  ma_bo text primary key,
  ma_thuong_hieu text not null references kho.thuong_hieu(ma),
  ten text not null,
  gia_bo numeric not null default 0 check (gia_bo >= 0),
  dang_ban boolean not null default true,
  tao_luc timestamptz not null default now()
);
create table if not exists kho.bo_san_pham_mon (
  ma_bo text not null references kho.bo_san_pham(ma_bo) on delete cascade,
  ma_ny text not null references kho.niem_yet(ma_ny),
  so_luong integer not null default 1 check (so_luong > 0),
  primary key (ma_bo, ma_ny)
);
alter table kho.bo_san_pham enable row level security;
alter table kho.bo_san_pham_mon enable row level security;
drop policy if exists bo_doc on kho.bo_san_pham; drop policy if exists bom_doc on kho.bo_san_pham_mon;
create policy bo_doc on kho.bo_san_pham for select using (kho.current_vai_tro() = any (array['ceo','ke_toan','sale','thiet_ke','tk_ban_hang','xuong','kho','truong_nhom_sale']));
create policy bom_doc on kho.bo_san_pham_mon for select using (kho.current_vai_tro() = any (array['ceo','ke_toan','sale','thiet_ke','tk_ban_hang','xuong','kho','truong_nhom_sale']));
drop policy if exists bo_ghi on kho.bo_san_pham; drop policy if exists bom_ghi on kho.bo_san_pham_mon;
create policy bo_ghi on kho.bo_san_pham for all using (kho.current_vai_tro() = any (array['ceo','ke_toan'])) with check (kho.current_vai_tro() = any (array['ceo','ke_toan']));
create policy bom_ghi on kho.bo_san_pham_mon for all using (kho.current_vai_tro() = any (array['ceo','ke_toan'])) with check (kho.current_vai_tro() = any (array['ceo','ke_toan']));

-- ════════ RPC tạo LÕI (sinh SP-00001) ════════
create or replace function kho.tao_loi(p_ten text, p_nhom text, p_kich_thuoc text, p_nguon text, p_ma_ban_ve text, p_ghi_chu text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ma text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'tao_loi: chỉ ceo/ke_toan'; end if;
  if coalesce(btrim(p_ten),'') = '' then raise exception 'tao_loi: thiếu tên kỹ thuật'; end if;
  v_ma := 'SP-' || lpad(nextval('kho.san_pham_loi_seq')::text, 5, '0');
  insert into kho.san_pham_loi(ma_loi, ten_ky_thuat, nhom_hang, kich_thuoc, nguon, ma_ban_ve, ghi_chu, ma_ns_tao)
    values (v_ma, p_ten, p_nhom, p_kich_thuoc, coalesce(p_nguon,'xuong'), p_ma_ban_ve, p_ghi_chu, kho.current_ns());
  return jsonb_build_object('ok', true, 'ma_loi', v_ma);
end $$;
grant execute on function kho.tao_loi(text,text,text,text,text,text) to authenticated;

-- ════════ kiem_trung_ten — cảnh báo TRƯỚC khi lưu (so token, không cần pg_trgm) ════════
create or replace function kho.kiem_trung_ten(p_ten text)
  returns table(ma_ny text, ten_ban_hang text, ma_thuong_hieu text, do_giong numeric)
  language plpgsql stable security definer set search_path = kho as $$
declare v_tok text[];
begin
  v_tok := string_to_array(kho.bo_dau(p_ten), '-');
  return query
  select n.ma_ny, n.ten_ban_hang, n.ma_thuong_hieu,
    round((select count(*) from unnest(v_tok) t where t = any(string_to_array(n.duong_dan_chuan,'-')))::numeric
          / greatest(array_length(v_tok,1), array_length(string_to_array(n.duong_dan_chuan,'-'),1)), 2) dg
  from kho.niem_yet n
  where (select count(*) from unnest(v_tok) t where t = any(string_to_array(n.duong_dan_chuan,'-'))) >= 2
  order by dg desc limit 10;
end $$;
grant execute on function kho.kiem_trung_ten(text) to authenticated;

-- ════════ RPC tạo NIÊM YẾT (sinh mã · chống trùng slug · CHỐT GIÁ SÀN vs gia_niem_yet) ════════
create or replace function kho.tao_niem_yet(p_ma_bien_the text, p_ma_brand text, p_ten_ban_hang text, p_duong_dan text, p_ten_dai text, p_gia numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ma text; v_slug text; v_ma3 text; v_nhom text; v_seq int; v_yy text; v_san numeric; v_loai text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'tao_niem_yet: chỉ ceo/ke_toan'; end if;
  if not exists (select 1 from kho.san_pham_mau where ma = p_ma_bien_the) then raise exception 'tao_niem_yet: không có biến thể "%"', p_ma_bien_the; end if;
  select ma_3chu, loai into v_ma3, v_loai from kho.thuong_hieu where ma = p_ma_brand;
  if v_ma3 is null then raise exception 'tao_niem_yet: brand "%" chưa gán mã 3 chữ (ma_3chu)', p_ma_brand; end if;
  if v_loai = 'kenh_ban' then raise exception 'tao_niem_yet: "%" là KÊNH BÁN, không phải thương hiệu sản phẩm', p_ma_brand; end if;
  if p_gia is null or p_gia < 0 then raise exception 'tao_niem_yet: giá không hợp lệ'; end if;
  -- CHỐNG TRÙNG TÊN: slug chuẩn UNIQUE toàn hệ
  v_slug := kho.bo_dau(coalesce(nullif(btrim(p_duong_dan),''), p_ten_ban_hang));
  if v_slug = '' then raise exception 'tao_niem_yet: tên/đường dẫn rỗng'; end if;
  if exists (select 1 from kho.niem_yet where duong_dan_chuan = v_slug) then
    raise exception 'tao_niem_yet: đường dẫn "%" đã tồn tại (trùng tên — kể cả khác brand)', v_slug; end if;
  -- CHỐT GIÁ SÀN: không thấp hơn gia_le của kỳ mới nhất (gia_niem_yet db/028, nếu có)
  select gia_le into v_san from kho.gia_niem_yet where sku_mau = p_ma_bien_the order by ma_ky desc limit 1;
  if v_san is not null and p_gia < v_san then
    raise exception 'tao_niem_yet: giá % dưới GIÁ SÀN % (gia_le kỳ đang chạy) — bán lỗ', p_gia, v_san; end if;
  -- sinh mã: {ma3}-{NHOM3}-{yy}-{seq3}
  v_yy := to_char(now(), 'YY');
  v_nhom := upper(left(kho.bo_dau(coalesce((select nhom_hang from kho.san_pham_loi l join kho.san_pham_mau s on s.ma_loi=l.ma_loi where s.ma=p_ma_bien_the), 'san-pham')), 3));
  select count(*) + 1 into v_seq from kho.niem_yet where ma_thuong_hieu = p_ma_brand and ma_ny like v_ma3 || '-%-' || v_yy || '-%';
  v_ma := v_ma3 || '-' || v_nhom || '-' || v_yy || '-' || lpad(v_seq::text, 3, '0');
  insert into kho.niem_yet(ma_ny, ma_bien_the, ma_thuong_hieu, ten_ban_hang, ten_dai, duong_dan, duong_dan_chuan, gia_niem_yet, ma_ns_tao)
    values (v_ma, p_ma_bien_the, p_ma_brand, p_ten_ban_hang, p_ten_dai, coalesce(nullif(btrim(p_duong_dan),''), v_slug), v_slug, p_gia, kho.current_ns());
  return jsonb_build_object('ok', true, 'ma_ny', v_ma, 'slug', v_slug);
end $$;
grant execute on function kho.tao_niem_yet(text,text,text,text,text,numeric) to authenticated;

-- ════════ ⑥ RPC BỘ + giá vốn bộ TỰ CỘNG (CẤM nhập tay) ════════
create or replace function kho.tao_bo(p_ma_brand text, p_ten text, p_gia_bo numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ma text; v_ma3 text; v_yy text; v_seq int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'tao_bo: chỉ ceo/ke_toan'; end if;
  select ma_3chu into v_ma3 from kho.thuong_hieu where ma = p_ma_brand;
  if v_ma3 is null then raise exception 'tao_bo: brand "%" chưa gán mã 3 chữ', p_ma_brand; end if;
  v_yy := to_char(now(), 'YY');
  select count(*) + 1 into v_seq from kho.bo_san_pham where ma_bo like v_ma3 || '-BO-' || v_yy || '-%';
  v_ma := v_ma3 || '-BO-' || v_yy || '-' || lpad(v_seq::text, 3, '0');
  insert into kho.bo_san_pham(ma_bo, ma_thuong_hieu, ten, gia_bo) values (v_ma, p_ma_brand, p_ten, coalesce(p_gia_bo,0));
  return jsonb_build_object('ok', true, 'ma_bo', v_ma);
end $$;
grant execute on function kho.tao_bo(text,text,numeric) to authenticated;

create or replace function kho.them_mon_bo(p_ma_bo text, p_ma_ny text, p_so_luong integer)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'them_mon_bo: chỉ ceo/ke_toan'; end if;
  insert into kho.bo_san_pham_mon(ma_bo, ma_ny, so_luong) values (p_ma_bo, p_ma_ny, coalesce(p_so_luong,1))
    on conflict (ma_bo, ma_ny) do update set so_luong = excluded.so_luong;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function kho.them_mon_bo(text,text,integer) to authenticated;

-- giá vốn bộ = TỰ CỘNG giá vốn biến thể của từng món con (KHÔNG nhập tay). Chỉ ceo/ke_toan.
create or replace function kho.gia_von_bo(p_ma_bo text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'gia_von_bo: chỉ ceo/ke_toan (giá vốn)'; end if;
  select coalesce(sum(gv.gia_von * m.so_luong), 0) into v
  from kho.bo_san_pham_mon m
  join kho.niem_yet n on n.ma_ny = m.ma_ny
  left join kho.san_pham_mau_gia_von gv on gv.ma = n.ma_bien_the
  where m.ma_bo = p_ma_bo;
  return jsonb_build_object('ma_bo', p_ma_bo, 'gia_von', v);
end $$;
grant execute on function kho.gia_von_bo(text) to authenticated;

-- ════════ ⑧ TRA CỨU MỘT CỬA — tên/mã ba tầng/đường dẫn/QR → cả cây từ lõi xuống ════════
create or replace function kho.tra_cuu_san_pham(p_tu_khoa text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_slug text; v_loi text; v_kq jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','sale','thiet_ke','tk_ban_hang','xuong','kho','truong_nhom_thiet_ke','truong_nhom_sale') then
    raise exception 'tra_cuu_san_pham: không đủ quyền'; end if;
  v_slug := kho.bo_dau(regexp_replace(coalesce(p_tu_khoa,''), '^https?://[^/]+/', ''));  -- dán URL cũng ra
  -- xác định LÕI khớp: theo mã lõi · mã biến thể · mã niêm yết · slug · tên (không dấu)
  select l.ma_loi into v_loi from kho.san_pham_loi l where
       upper(l.ma_loi) = upper(btrim(p_tu_khoa))
    or exists (select 1 from kho.san_pham_mau s where s.ma_loi = l.ma_loi and upper(s.ma) = upper(btrim(p_tu_khoa)))
    or exists (select 1 from kho.niem_yet n join kho.san_pham_mau s on s.ma = n.ma_bien_the
               where s.ma_loi = l.ma_loi and (upper(n.ma_ny) = upper(btrim(p_tu_khoa)) or n.duong_dan_chuan = v_slug or kho.bo_dau(n.ten_ban_hang) like '%' || v_slug || '%'))
    or kho.bo_dau(l.ten_ky_thuat) like '%' || v_slug || '%'
  limit 1;
  if v_loi is null then return jsonb_build_object('tim_thay', false, 'tu_khoa', p_tu_khoa); end if;
  select jsonb_build_object('tim_thay', true, 'ma_loi', l.ma_loi, 'ten_ky_thuat', l.ten_ky_thuat, 'nhom_hang', l.nhom_hang, 'nguon', l.nguon,
    'bien_the', (select coalesce(jsonb_agg(jsonb_build_object('ma', s.ma, 'ten', s.ten, 'vat_lieu', s.vat_lieu,
        'niem_yet', (select coalesce(jsonb_agg(jsonb_build_object('ma_ny', n.ma_ny, 'brand', n.ma_thuong_hieu, 'ten', n.ten_ban_hang, 'gia', n.gia_niem_yet, 'duong_dan', n.duong_dan)), '[]'::jsonb)
                     from kho.niem_yet n where n.ma_bien_the = s.ma))), '[]'::jsonb)
      from kho.san_pham_mau s where s.ma_loi = l.ma_loi))
    into v_kq from kho.san_pham_loi l where l.ma_loi = v_loi;
  return v_kq;
end $$;
grant execute on function kho.tra_cuu_san_pham(text) to authenticated;

-- ════════ ⑨ LÕI BÁN DƯỚI >1 BRAND (tab Trùng nhau) — giá vốn·giá bán·chênh·số bán từng brand ════════
create or replace function kho.san_pham_trung_brand()
  returns table(ma_loi text, ten_ky_thuat text, ma_bien_the text, gia_von numeric,
                ma_thuong_hieu text, gia_ban numeric, chenh_pct numeric, so_ban integer)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'san_pham_trung_brand: chỉ ceo/ke_toan (giá vốn)'; end if;
  return query
  with loi_nhieu_brand as (   -- lõi có >1 brand niêm yết
    select s.ma_loi lb from kho.niem_yet n join kho.san_pham_mau s on s.ma = n.ma_bien_the
    where s.ma_loi is not null group by s.ma_loi having count(distinct n.ma_thuong_hieu) > 1
  )
  select l.ma_loi, l.ten_ky_thuat, n.ma_bien_the, gv.gia_von, n.ma_thuong_hieu, n.gia_niem_yet,
    case when gv.gia_von > 0 then round(100.0 * (n.gia_niem_yet - gv.gia_von) / gv.gia_von, 1) else null end,
    coalesce((select sum(dm.so_luong)::int from kho.don_hang_mon dm join kho.don_hang d on d.id = dm.don_id
              where dm.sp_id = n.ma_bien_the and d.thuong_hieu = n.ma_thuong_hieu and coalesce(d.la_demo,false) = false), 0)
  from kho.niem_yet n
  join kho.san_pham_mau s on s.ma = n.ma_bien_the
  join kho.san_pham_loi l on l.ma_loi = s.ma_loi
  left join kho.san_pham_mau_gia_von gv on gv.ma = n.ma_bien_the
  where s.ma_loi in (select lb from loi_nhieu_brand)
  order by l.ma_loi, n.ma_thuong_hieu;
end $$;
grant execute on function kho.san_pham_trung_brand() to authenticated;

-- ════════ ⑩ BA HÀM PHÂN TÍCH (mỗi tầng một hàm) — LOẠI demo ════════
create or replace function kho.ban_chay_theo_loi(p_ma_ky text)
  returns table(ma_loi text, ten_ky_thuat text, so_ban integer, so_brand integer)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','truong_nhom_sale') then raise exception 'ban_chay_theo_loi: chỉ ceo/ke_toan/trưởng nhóm sale'; end if;
  return query
  select l.ma_loi, l.ten_ky_thuat, sum(dm.so_luong)::int, count(distinct d.thuong_hieu)::int
  from kho.don_hang_mon dm join kho.don_hang d on d.id = dm.don_id
  join kho.san_pham_mau s on s.ma = dm.sp_id join kho.san_pham_loi l on l.ma_loi = s.ma_loi
  where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
  group by l.ma_loi, l.ten_ky_thuat order by sum(dm.so_luong) desc;
end $$;
grant execute on function kho.ban_chay_theo_loi(text) to authenticated;

create or replace function kho.ban_chay_theo_bien_the(p_ma_ky text)
  returns table(ma_bien_the text, ten text, vat_lieu text, so_ban integer)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','truong_nhom_sale') then raise exception 'ban_chay_theo_bien_the: chỉ ceo/ke_toan/trưởng nhóm sale'; end if;
  return query
  select s.ma, s.ten, s.vat_lieu, sum(dm.so_luong)::int
  from kho.don_hang_mon dm join kho.don_hang d on d.id = dm.don_id join kho.san_pham_mau s on s.ma = dm.sp_id
  where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
  group by s.ma, s.ten, s.vat_lieu order by sum(dm.so_luong) desc;
end $$;
grant execute on function kho.ban_chay_theo_bien_the(text) to authenticated;

create or replace function kho.lai_theo_niem_yet(p_ma_ky text)
  returns table(ma_thuong_hieu text, so_ban integer, doanh_thu numeric, gia_von numeric, lai numeric, lai_pct numeric)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'lai_theo_niem_yet: chỉ ceo/ke_toan (giá vốn)'; end if;
  return query
  select d.thuong_hieu, sum(dm.so_luong)::int,
    sum(dm.gia * dm.so_luong)::numeric,
    sum(coalesce(gv.gia_von,0) * dm.so_luong)::numeric,
    (sum(dm.gia * dm.so_luong) - sum(coalesce(gv.gia_von,0) * dm.so_luong))::numeric,
    case when sum(dm.gia * dm.so_luong) > 0 then round(100.0 * (sum(dm.gia * dm.so_luong) - sum(coalesce(gv.gia_von,0) * dm.so_luong)) / sum(dm.gia * dm.so_luong), 1) else null end
  from kho.don_hang_mon dm join kho.don_hang d on d.id = dm.don_id
  left join kho.san_pham_mau_gia_von gv on gv.ma = dm.sp_id
  where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false and d.thuong_hieu is not null
  group by d.thuong_hieu order by lai desc;
end $$;
grant execute on function kho.lai_theo_niem_yet(text) to authenticated;

-- ════════ ③ (db/053) NGỦ ĐÔNG — ghi rõ ba cột không dùng, đã thay bằng tầng lõi ════════
comment on column kho.don_hang_mon.ma_sp_goc is 'NGỦ ĐÔNG (db/058): cây "cùng thiết kế" nay dùng san_pham_loi + san_pham_mau.ma_loi. Cột này chưa ai ghi, không dùng.';
comment on column kho.don_hang_mon.mo_ta_sua is 'NGỦ ĐÔNG (db/058): thay bằng tầng lõi. Không dùng.';
comment on table kho.dung_lai_ban is 'NGỦ ĐÔNG (db/058): cây biến thể bản vẽ thay bằng san_pham_loi. Bảng rỗng, không dùng.';

commit;
