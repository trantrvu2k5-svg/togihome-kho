-- 062 — A1b: quy trình DÙNG CHUNG nhiều lõi + giờ hai phần + bước tự chạy + 3 nguồn số + RPC giờ dự kiến.
--   THUẦN DB, không màn. quy_trinh_buoc 0 dòng → đổi khoá lúc này rẻ nhất (dựng lại bảng).
--   node ops/run_sql.mjs ../db/062_quy_trinh_dung_chung.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.gio_du_kien_cua_mon(text); drop function if exists kho.kiem_quy_trinh(text); drop function if exists kho.quy_trinh_cua_loi(text);
--   drop table if exists kho.so_don_vi_mon; drop table if exists kho.quy_trinh_buoc; alter table kho.san_pham_loi drop column if exists ma_quy_trinh; drop table if exists kho.quy_trinh;
--   delete from kho.don_gia_baseline where hoat_dong='cho_kho'; alter table kho.don_gia_baseline drop column if exists ten;
--   -- (quy_trinh_buoc cũ theo ma_loi KHÔNG khôi phục tự động — dựng lại từ db/061 nếu cần)
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ ① don_gia_baseline: tên thật 12 mã + dòng cho_kho (KHÔNG đẻ bảng thứ hai) ════════
alter table kho.don_gia_baseline add column if not exists ten text;
update kho.don_gia_baseline set ten = case hoat_dong
  when 'cat' then 'Cắt CNC'                 when 'dan' then 'Dán cạnh'
  when 'cam' then 'Khoan cam/chốt'          when 'lot' then 'Chà nhám+sơn lót'
  when 'pu'  then 'Sơn PU (màu+bóng)'       when 'son_canh' then 'Sơn cạnh'
  when 'cup' then 'Khoan cup bản lề'        when 'thung' then 'Lắp ráp thùng'
  when 'ray' then 'Ghép+lắp ray ngăn kéo'   when 'canh' then 'Lắp+căn chỉnh cánh'
  when 'goi' then 'Đóng gói'                when 'giuong_lap' then 'Lắp ráp giường (gỗ TN)'
  else ten end
  where hoat_dong in ('cat','dan','cam','lot','pu','son_canh','cup','thung','ray','canh','goi','giuong_lap');
-- Chờ khô = hoạt động tự chạy (đơn giá công 0, mẫu số theo mẻ). Vẫn CÙNG bảng don_gia_baseline.
insert into kho.don_gia_baseline(hoat_dong, ten, ma_to, mau_so, don_gia, nguon)
  values('cho_kho','Chờ khô','son_pu',1,0,'[TẠM] chờ khô theo mẻ')
  on conflict (hoat_dong) do update set ten=excluded.ten, ma_to=excluded.ma_to, don_gia=excluded.don_gia;

-- ════════ ② quy_trinh (bảng mới — dùng chung nhiều lõi) ════════
create table if not exists kho.quy_trinh (
  ma_quy_trinh text primary key,
  ten text not null,
  mo_ta text,
  dang_dung boolean not null default true
);

-- ════════ ③ quy_trinh_buoc: DỰNG LẠI theo khoá QUY TRÌNH + giờ hai phần + loại bước ════════
drop table if exists kho.quy_trinh_buoc;
create table kho.quy_trinh_buoc (
  id            bigint generated always as identity primary key,
  ma_quy_trinh  text not null references kho.quy_trinh(ma_quy_trinh) on delete cascade,   -- (CEO: bỏ ma_loi)
  thu_tu        int  not null,                          -- bội 100
  buoc_truoc    int[] not null default '{}',            -- đồ thị có nhánh, đọc buoc_truoc (QD-01)
  nhanh         text,
  hoat_dong     text not null references kho.don_gia_baseline(hoat_dong),
  to_phu_trach  text,
  loai_buoc     text not null default 'nguoi' check (loai_buoc in ('nguoi','tu_chay')),   -- QD-05
  gio_co_dinh   numeric,   -- gá đặt/chuẩn bị — KHÔNG theo kích thước
  gio_moi_don_vi numeric,  -- × số đơn vị thật của món (đơn vị suy từ mẫu số công suất của hoat_dong)
  la_tam        boolean not null default true,
  ghi_chu       text,
  unique (ma_quy_trinh, thu_tu),
  -- bước tự chạy (chờ khô) KHÔNG theo đơn vị: 12 tiếng bất kể tấm to nhỏ
  constraint tu_chay_khong_don_vi check (loai_buoc <> 'tu_chay' or coalesce(gio_moi_don_vi,0) = 0)
);

-- ════════ ④ san_pham_loi: gán quy trình (NULL = lõi chưa gán) ════════
alter table kho.san_pham_loi add column if not exists ma_quy_trinh text references kho.quy_trinh(ma_quy_trinh);

-- ════════ ⑤ so_don_vi_mon: BA nguồn số đơn vị (QD-06) ════════
create table if not exists kho.so_don_vi_mon (
  ma_bien_the text not null references kho.san_pham_mau(ma) on delete cascade,
  hoat_dong   text not null references kho.don_gia_baseline(hoat_dong),
  so_don_vi   numeric not null,
  nguon       text not null check (nguon in ('cutlist','go_tay','uoc')),
  nguoi_nhap  uuid,
  luc         timestamptz default now(),
  primary key (ma_bien_the, hoat_dong)
);

-- ════════ GRANT + RLS ════════
grant select, insert, update, delete on kho.quy_trinh       to authenticated;
grant select, insert, update, delete on kho.quy_trinh_buoc  to authenticated;
grant select, insert, update, delete on kho.so_don_vi_mon   to authenticated;

alter table kho.quy_trinh enable row level security;
drop policy if exists qt_doc on kho.quy_trinh;
create policy qt_doc on kho.quy_trinh for select to public using (kho.current_vai_tro() = any (array['ceo','ke_toan','thiet_ke','xuong']));
drop policy if exists qt_ghi on kho.quy_trinh;
create policy qt_ghi on kho.quy_trinh for all to public using (kho.current_vai_tro() = any (array['ceo','thiet_ke'])) with check (kho.current_vai_tro() = any (array['ceo','thiet_ke']));

alter table kho.quy_trinh_buoc enable row level security;
drop policy if exists qtb_doc on kho.quy_trinh_buoc;
create policy qtb_doc on kho.quy_trinh_buoc for select to public using (kho.current_vai_tro() = any (array['ceo','ke_toan','thiet_ke','xuong']));
drop policy if exists qtb_ghi on kho.quy_trinh_buoc;
create policy qtb_ghi on kho.quy_trinh_buoc for all to public using (kho.current_vai_tro() = any (array['ceo','thiet_ke'])) with check (kho.current_vai_tro() = any (array['ceo','thiet_ke']));

alter table kho.so_don_vi_mon enable row level security;
drop policy if exists sdv_doc on kho.so_don_vi_mon;
create policy sdv_doc on kho.so_don_vi_mon for select to public using (kho.current_vai_tro() = any (array['ceo','ke_toan','thiet_ke','xuong']));
drop policy if exists sdv_ghi on kho.so_don_vi_mon;
create policy sdv_ghi on kho.so_don_vi_mon for all to public using (kho.current_vai_tro() = any (array['ceo','thiet_ke'])) with check (kho.current_vai_tro() = any (array['ceo','thiet_ke']));

-- ════════ RPC quy_trinh_cua_loi(ma_loi) — qua san_pham_loi.ma_quy_trinh ════════
create or replace function kho.quy_trinh_cua_loi(p_loi text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_qt text; v_buoc jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'quy_trinh_cua_loi: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  if not exists (select 1 from kho.san_pham_loi where ma_loi = p_loi) then
    raise exception 'quy_trinh_cua_loi: không có lõi "%"', p_loi; end if;
  select ma_quy_trinh into v_qt from kho.san_pham_loi where ma_loi = p_loi;
  if v_qt is null then   -- fail-đóng: chưa gán quy trình → cờ, KHÔNG rỗng im lặng
    return jsonb_build_object('chua_co_quy_trinh', true, 'ma_quy_trinh', null, 'buoc', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'thu_tu', b.thu_tu, 'buoc_truoc', b.buoc_truoc, 'nhanh', b.nhanh,
      'hoat_dong', b.hoat_dong, 'ten_hoat_dong', (select d.ten from kho.don_gia_baseline d where d.hoat_dong = b.hoat_dong),
      'to_gia_von', (select d.ma_to from kho.don_gia_baseline d where d.hoat_dong = b.hoat_dong),
      'loai_buoc', b.loai_buoc, 'to_phu_trach', b.to_phu_trach,
      'gio_co_dinh', b.gio_co_dinh, 'gio_moi_don_vi', b.gio_moi_don_vi, 'la_tam', b.la_tam, 'ghi_chu', b.ghi_chu
    ) order by b.thu_tu), '[]'::jsonb)
    into v_buoc from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt;
  return jsonb_build_object('chua_co_quy_trinh', (v_buoc = '[]'::jsonb), 'ma_quy_trinh', v_qt, 'buoc', v_buoc);
end $$;
grant execute on function kho.quy_trinh_cua_loi(text) to authenticated;

-- ════════ RPC kiem_quy_trinh(ma_quy_trinh) — hàng rào đồ thị (khoá QUY TRÌNH) ════════
drop function if exists kho.kiem_quy_trinh(text);   -- db/061 dùng tên tham số p_loi → đổi p_qt phải drop trước
create or replace function kho.kiem_quy_trinh(p_qt text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare loi jsonb := '[]'::jsonb; tmp jsonb; v_all int[];
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'kiem_quy_trinh: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  select array_agg(thu_tu) into v_all from kho.quy_trinh_buoc where ma_quy_trinh = p_qt;
  if v_all is null then return '[]'::jsonb; end if;
  -- (1) buoc_truoc trỏ thu_tu không tồn tại
  select coalesce(jsonb_agg(distinct jsonb_build_object('loai','buoc_truoc_khong_ton_tai','thu_tu',b.thu_tu,'thieu',p)), '[]'::jsonb)
    into tmp from kho.quy_trinh_buoc b cross join lateral unnest(b.buoc_truoc) p
    where b.ma_quy_trinh = p_qt and not (p = any (v_all));
  loi := loi || tmp;
  -- (2) không có bước khởi đầu
  if not exists (select 1 from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and cardinality(buoc_truoc) = 0) then
    loi := loi || jsonb_build_array(jsonb_build_object('loai','khong_co_buoc_khoi_dau')); end if;
  -- (3) chu trình
  with recursive nodes as (select thu_tu, buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh = p_qt),
  walk(seed, cur, path, cyc) as (
    select thu_tu, thu_tu, array[thu_tu], false from nodes
    union all
    select w.seed, n.thu_tu, w.path || n.thu_tu, n.thu_tu = any (w.path)
    from walk w join nodes n on w.cur = any (n.buoc_truoc)
    where not w.cyc and cardinality(w.path) <= (select count(*) from nodes)
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('loai','chu_trinh','tai',cur)), '[]'::jsonb) into tmp from walk where cyc;
  loi := loi || tmp;
  -- (4) không với tới
  with recursive nodes as (select thu_tu, buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh = p_qt),
  reach as (
    select thu_tu from nodes where cardinality(buoc_truoc) = 0
    union
    select n.thu_tu from nodes n join reach r on r.thu_tu = any (n.buoc_truoc)
  )
  select coalesce(jsonb_agg(jsonb_build_object('loai','khong_voi_toi','thu_tu',thu_tu)), '[]'::jsonb) into tmp
    from nodes where thu_tu not in (select thu_tu from reach);
  loi := loi || tmp;
  return loi;
end $$;
grant execute on function kho.kiem_quy_trinh(text) to authenticated;

-- ════════ RPC gio_du_kien_cua_mon(ma_bien_the) — giờ từng bước + tổng + NGUỒN, fail-đóng 3 mã ════════
create or replace function kho.gio_du_kien_cua_mon(p_ma text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_loi text; v_qt text; r record; v_buoc jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
        v_tong numeric := 0; v_mauso numeric; v_sodv numeric; v_nguon text; v_gio numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'gio_du_kien_cua_mon: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  select ma_loi into v_loi from kho.san_pham_mau where ma = p_ma;
  if not found then raise exception 'gio_du_kien_cua_mon: không có biến thể "%"', p_ma; end if;
  -- lõi chưa gán quy trình → mã lỗi RIÊNG, KHÔNG trả 0
  if v_loi is null then
    return jsonb_build_object('ok', false, 'loi', 'LOI_CHUA_GAN_QUY_TRINH', 'tong_gio', null, 'buoc','[]'::jsonb, 'thieu','[]'::jsonb); end if;
  select ma_quy_trinh into v_qt from kho.san_pham_loi where ma_loi = v_loi;
  if v_qt is null then
    return jsonb_build_object('ok', false, 'loi', 'LOI_CHUA_GAN_QUY_TRINH', 'tong_gio', null, 'buoc','[]'::jsonb, 'thieu','[]'::jsonb); end if;

  for r in select * from kho.quy_trinh_buoc where ma_quy_trinh = v_qt order by thu_tu loop
    if r.loai_buoc = 'tu_chay' then                          -- tự chạy: chỉ gio_co_dinh, KHÔNG cần số đơn vị
      v_gio := coalesce(r.gio_co_dinh, 0);
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','tu_chay','so_don_vi',null,'nguon','tu_chay','gio',v_gio);
      v_tong := v_tong + v_gio;
    else
      select mau_so into v_mauso from kho.don_gia_baseline where hoat_dong = r.hoat_dong;
      if v_mauso is null or v_mauso = 0 then                 -- hoạt động chưa khai mẫu số công suất
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_DON_GIA'); continue; end if;
      select so_don_vi, nguon into v_sodv, v_nguon from kho.so_don_vi_mon where ma_bien_the = p_ma and hoat_dong = r.hoat_dong;
      if not found then                                      -- thiếu CẢ BA nguồn (không phải riêng cutlist)
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_SO_DON_VI'); continue; end if;
      v_gio := coalesce(r.gio_co_dinh,0) + coalesce(r.gio_moi_don_vi,0) * v_sodv;
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','nguoi','so_don_vi',v_sodv,'nguon',v_nguon,'gio',v_gio);
      v_tong := v_tong + v_gio;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', (jsonb_array_length(v_thieu) = 0), 'loi', null,
    'tong_gio', case when jsonb_array_length(v_thieu) = 0 then v_tong else null end,   -- fail-đóng: thiếu → null, KHÔNG 0
    'buoc', v_buoc, 'thieu', v_thieu);
end $$;
grant execute on function kho.gio_du_kien_cua_mon(text) to authenticated;

-- ════════ DỮ LIỆU MẦM · 1 quy trình TU-AO-MELAMINE (8 bước, giờ [TẠM]) — KHÔNG gán lõi ════════
insert into kho.quy_trinh(ma_quy_trinh, ten, mo_ta) values
  ('TU-AO-MELAMINE','Tủ áo melamine','Quy trình dùng chung mọi tủ áo melamine, mọi kích thước.')
  on conflict (ma_quy_trinh) do nothing;
insert into kho.quy_trinh_buoc(ma_quy_trinh, thu_tu, buoc_truoc, nhanh, hoat_dong, gio_co_dinh, gio_moi_don_vi) values
  ('TU-AO-MELAMINE', 100, '{}',        'chung', 'cat',   0.5, 0.10),
  ('TU-AO-MELAMINE', 200, '{100}',     'chung', 'dan',   0.5, 0.08),
  ('TU-AO-MELAMINE', 250, '{200}',     'chung', 'cam',   0.5, 0.05),
  ('TU-AO-MELAMINE', 300, '{250}',     'thùng', 'thung', 0.5, 0.12),
  ('TU-AO-MELAMINE', 310, '{250}',     'cánh',  'cup',   0.5, 0.06),
  ('TU-AO-MELAMINE', 320, '{300}',     'kéo',   'ray',   0.5, 0.09),
  ('TU-AO-MELAMINE', 400, '{300,310}', 'chung', 'canh',  0.5, 0.11),
  ('TU-AO-MELAMINE', 500, '{400,320}', 'chung', 'goi',   0.5, 0.07)
on conflict (ma_quy_trinh, thu_tu) do nothing;

commit;
