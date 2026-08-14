-- 061 — XƯƠNG QUY TRÌNH SẢN XUẤT (A1). THUẦN DB, KHÔNG màn.
--   Routing theo LÕI, ĐỒ THỊ CÓ NHÁNH (đọc buoc_truoc, KHÔNG suy bằng thu_tu-1). Trạm QR vật lý.
--   DÙNG LẠI đúng 12 hoạt động ở don_gia_baseline(hoat_dong) — KHÔNG đẻ danh mục thứ hai.
--   ⚠ Tên khoá: hoạt động = TEXT `hoat_dong` (PK don_gia_baseline), lõi = TEXT `ma_loi` (PK san_pham_loi).
--     CEO ghi 'hoat_dong_id'/'san_pham_loi_id' nhưng khoá thật là TEXT — dùng đúng khoá thật + đúng quy ước schema.
--   node ops/run_sql.mjs ../db/061_quy_trinh_san_xuat.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.quy_trinh_cua_loi(text);
--   drop function if exists kho.kiem_quy_trinh(text);
--   drop table if exists kho.quy_trinh_buoc;
--   drop table if exists kho.tram;
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ BẢNG 1 · quy_trinh_buoc (routing theo LÕI — nội bộ, KHÔNG bao giờ đẩy web) ════════
create table if not exists kho.quy_trinh_buoc (
  id            bigint generated always as identity primary key,
  ma_loi        text not null references kho.san_pham_loi(ma_loi) on delete cascade,   -- (CEO: san_pham_loi_id)
  thu_tu        int  not null,                          -- BỘI 100 (100,200,300…) để chèn nhánh sau (210,310) khỏi đánh số lại
  buoc_truoc    int[] not null default '{}',            -- các thu_tu phải XONG trước; RỖNG = bước khởi đầu (cho nhiều khởi đầu)
  nhanh         text,                                   -- nhãn người đọc: 'thùng' | 'cánh' | 'chung'
  hoat_dong     text not null references kho.don_gia_baseline(hoat_dong),   -- FK về đúng 12 hoạt động (CEO: hoat_dong_id)
  to_phu_trach  text,
  gio_chuan     numeric,                                -- [TẠM] — sau thay bằng số đo quét thật
  la_tam        boolean not null default true,
  ghi_chu       text,
  unique (ma_loi, thu_tu)
);
comment on table kho.quy_trinh_buoc is 'Routing sản xuất theo lõi — ĐỒ THỊ có nhánh (buoc_truoc). Nội bộ, không đẩy web.';

-- ════════ BẢNG 2 · tram (trạm vật lý, mỗi trạm một mã QR cố định) ════════
create table if not exists kho.tram (
  ma_tram    text primary key,                          -- chuỗi in ra QR (unique + not null)
  ten        text not null,
  hoat_dong  text not null references kho.don_gia_baseline(hoat_dong),   -- một trạm MỘT hoạt động; một hoạt động NHIỀU trạm
  dang_dung  boolean not null default true
);
comment on table kho.tram is 'Trạm vật lý (QR). Quy trình chỉ ghi hoạt động; trạm nào nhận thì tra ngược bảng này.';

-- GRANT ở tầng bảng (privilege) — RLS bên dưới mới quyết TỪNG DÒNG theo vai. Grant rộng, RLS siết.
grant select, insert, update, delete on kho.quy_trinh_buoc to authenticated;
grant select, insert, update, delete on kho.tram to authenticated;

-- ════════ RLS (roles=public + current_vai_tro() = any(...) — dạng dương, NULL tự rớt = fail-đóng) ════════
alter table kho.quy_trinh_buoc enable row level security;
drop policy if exists qtb_doc on kho.quy_trinh_buoc;
create policy qtb_doc on kho.quy_trinh_buoc for select to public
  using (kho.current_vai_tro() = any (array['ceo','ke_toan','thiet_ke','xuong']));
drop policy if exists qtb_ghi on kho.quy_trinh_buoc;
create policy qtb_ghi on kho.quy_trinh_buoc for all to public
  using (kho.current_vai_tro() = any (array['ceo','thiet_ke']))
  with check (kho.current_vai_tro() = any (array['ceo','thiet_ke']));

alter table kho.tram enable row level security;
drop policy if exists tram_doc on kho.tram;
create policy tram_doc on kho.tram for select to public
  using (kho.current_vai_tro() = any (array['ceo','xuong','tho']));
drop policy if exists tram_ghi on kho.tram;
create policy tram_ghi on kho.tram for all to public
  using (kho.current_vai_tro() = any (array['ceo']))
  with check (kho.current_vai_tro() = any (array['ceo']));

-- ════════ RPC quy_trinh_cua_loi(ma_loi) — bước + tên hoạt động + tổ + nhánh + buoc_truoc ════════
create or replace function kho.quy_trinh_cua_loi(p_loi text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_buoc jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'quy_trinh_cua_loi: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  if not exists (select 1 from kho.san_pham_loi where ma_loi = p_loi) then
    raise exception 'quy_trinh_cua_loi: không có lõi "%"', p_loi; end if;   -- fail-đóng: lõi lạ → báo, không trả rỗng giả
  select coalesce(jsonb_agg(jsonb_build_object(
      'thu_tu', b.thu_tu, 'buoc_truoc', b.buoc_truoc, 'nhanh', b.nhanh,
      'hoat_dong', b.hoat_dong,
      'to_gia_von', (select d.ma_to from kho.don_gia_baseline d where d.hoat_dong = b.hoat_dong),
      'to_phu_trach', b.to_phu_trach, 'gio_chuan', b.gio_chuan, 'la_tam', b.la_tam, 'ghi_chu', b.ghi_chu
    ) order by b.thu_tu), '[]'::jsonb)
    into v_buoc from kho.quy_trinh_buoc b where b.ma_loi = p_loi;
  -- FAIL-ĐÓNG: LUÔN kèm cờ; lõi chưa khai → chua_co_quy_trinh=true (KHÔNG rỗng im lặng, KHÔNG 0 giờ như đã xong)
  return jsonb_build_object('chua_co_quy_trinh', (v_buoc = '[]'::jsonb), 'buoc', v_buoc);
end $$;
grant execute on function kho.quy_trinh_cua_loi(text) to authenticated;

-- ════════ RPC kiem_quy_trinh(ma_loi) — hàng rào đồ thị, trả danh sách lỗi (rỗng = sạch) ════════
create or replace function kho.kiem_quy_trinh(p_loi text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare loi jsonb := '[]'::jsonb; tmp jsonb; v_all int[];
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'kiem_quy_trinh: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  select array_agg(thu_tu) into v_all from kho.quy_trinh_buoc where ma_loi = p_loi;
  if v_all is null then return '[]'::jsonb; end if;   -- lõi không có bước → không có gì để kiểm

  -- (1) buoc_truoc trỏ thu_tu KHÔNG tồn tại trong cùng lõi
  select coalesce(jsonb_agg(distinct jsonb_build_object('loai','buoc_truoc_khong_ton_tai','thu_tu',b.thu_tu,'thieu',p)), '[]'::jsonb)
    into tmp from kho.quy_trinh_buoc b cross join lateral unnest(b.buoc_truoc) p
    where b.ma_loi = p_loi and not (p = any (v_all));
  loi := loi || tmp;

  -- (2) lõi có bước nhưng KHÔNG có bước khởi đầu (không dòng nào buoc_truoc rỗng)
  if not exists (select 1 from kho.quy_trinh_buoc where ma_loi = p_loi and cardinality(buoc_truoc) = 0) then
    loi := loi || jsonb_build_array(jsonb_build_object('loai','khong_co_buoc_khoi_dau'));
  end if;

  -- (3) CHU TRÌNH — duyệt tiến theo cạnh (prereq → dependent), phát hiện khi gặp lại node trong đường đi
  with recursive nodes as (select thu_tu, buoc_truoc from kho.quy_trinh_buoc where ma_loi = p_loi),
  walk(seed, cur, path, cyc) as (
    select thu_tu, thu_tu, array[thu_tu], false from nodes
    union all
    select w.seed, n.thu_tu, w.path || n.thu_tu, n.thu_tu = any (w.path)
    from walk w join nodes n on w.cur = any (n.buoc_truoc)
    where not w.cyc and cardinality(w.path) <= (select count(*) from nodes)
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('loai','chu_trinh','tai',cur)), '[]'::jsonb)
    into tmp from walk where cyc;
  loi := loi || tmp;

  -- (4) bước KHÔNG với tới được từ bất kỳ bước khởi đầu nào
  with recursive nodes as (select thu_tu, buoc_truoc from kho.quy_trinh_buoc where ma_loi = p_loi),
  reach as (
    select thu_tu from nodes where cardinality(buoc_truoc) = 0
    union
    select n.thu_tu from nodes n join reach r on r.thu_tu = any (n.buoc_truoc)
  )
  select coalesce(jsonb_agg(jsonb_build_object('loai','khong_voi_toi','thu_tu',thu_tu)), '[]'::jsonb)
    into tmp from nodes where thu_tu not in (select thu_tu from reach);
  loi := loi || tmp;

  return loi;
end $$;
grant execute on function kho.kiem_quy_trinh(text) to authenticated;

-- ════════ DỮ LIỆU MẦM · 3 trạm mẫu (mỗi trạm một hoạt động khác nhau) — KHÔNG chèn quy_trinh_buoc ════════
insert into kho.tram (ma_tram, ten, hoat_dong) values
  ('TRAM-CAT-01', 'Máy CNC #1',        'cat'),
  ('TRAM-DAN-01', 'Bàn dán cạnh #1',   'dan'),
  ('TRAM-PU-01',  'Buồng sơn PU #1',   'pu')
on conflict (ma_tram) do nothing;

commit;
