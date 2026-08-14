-- 063 — L-05: 2 quy trình nữa + ĐƠN FULL CĂN GIẢ (la_demo) + RPC gio_du_kien_cua_don.
--   Việc thật của công ty = full căn/combo, món MỚI mỗi căn, số đơn vị GÕ TAY. Plugin nối sau.
--   ⚠ KHÔNG đụng 100 lõi web (WEB-*). Dữ liệu MỚI tách biệt, mã 'CAN-A-*' + đơn 'CAN-A-DEMO'.
--   node ops/run_sql.mjs ../db/063_don_full_can_demo.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.gio_du_kien_cua_don(text);
--   delete from kho.don_hang where ma_don='CAN-A-DEMO';   -- cascade món
--   delete from kho.so_don_vi_mon where ma_bien_the like 'CAN-A-%';
--   delete from kho.san_pham_mau where ma like 'CAN-A-%';
--   delete from kho.san_pham_loi where ma_loi like 'CAN-A-%';
--   delete from kho.quy_trinh_buoc where ma_quy_trinh in ('TU-BEP-MELAMINE','KE-HO-MELAMINE');
--   delete from kho.quy_trinh where ma_quy_trinh in ('TU-BEP-MELAMINE','KE-HO-MELAMINE');
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ ① HAI QUY TRÌNH NỮA (đồ thị nhánh, kiem_quy_trinh phải sạch) ════════
insert into kho.quy_trinh(ma_quy_trinh, ten, mo_ta) values
  ('TU-BEP-MELAMINE','Tủ bếp melamine','Như tủ áo nhưng KHÔNG ngăn kéo (bỏ bước ray).'),
  ('KE-HO-MELAMINE','Kệ hở melamine','Không cánh, không bản lề, không ngăn kéo.')
  on conflict (ma_quy_trinh) do nothing;

-- TU-BEP: cat→dan→cam→{thung ‖ cup→canh}→goi (7 bước, nhánh thùng ‖ cánh gộp ở canh)
insert into kho.quy_trinh_buoc(ma_quy_trinh, thu_tu, buoc_truoc, nhanh, hoat_dong, gio_co_dinh, gio_moi_don_vi) values
  ('TU-BEP-MELAMINE',100,'{}',       'chung','cat',  0.5,0.10),
  ('TU-BEP-MELAMINE',200,'{100}',    'chung','dan',  0.5,0.08),
  ('TU-BEP-MELAMINE',250,'{200}',    'chung','cam',  0.5,0.05),
  ('TU-BEP-MELAMINE',300,'{250}',    'thùng','thung',0.5,0.12),
  ('TU-BEP-MELAMINE',310,'{250}',    'cánh', 'cup',  0.5,0.06),
  ('TU-BEP-MELAMINE',400,'{300,310}','chung','canh', 0.5,0.11),
  ('TU-BEP-MELAMINE',500,'{400}',    'chung','goi',  0.5,0.07)
  on conflict (ma_quy_trinh,thu_tu) do nothing;

-- KE-HO: cat→dan→cam→thung→goi (5 bước tuyến tính — kệ hở không cánh/kéo)
insert into kho.quy_trinh_buoc(ma_quy_trinh, thu_tu, buoc_truoc, nhanh, hoat_dong, gio_co_dinh, gio_moi_don_vi) values
  ('KE-HO-MELAMINE',100,'{}',    'chung','cat',  0.5,0.10),
  ('KE-HO-MELAMINE',200,'{100}', 'chung','dan',  0.5,0.08),
  ('KE-HO-MELAMINE',250,'{200}', 'chung','cam',  0.5,0.05),
  ('KE-HO-MELAMINE',300,'{250}', 'chung','thung',0.5,0.12),
  ('KE-HO-MELAMINE',400,'{300}', 'chung','goi',  0.5,0.07)
  on conflict (ma_quy_trinh,thu_tu) do nothing;

-- ════════ ② 6 LÕI 'CAN-A-*' + biến thể + gán quy trình (dữ liệu MỚI, KHÔNG đụng web) ════════
insert into kho.san_pham_loi(ma_loi, ten_ky_thuat, nhom_hang, kich_thuoc, nguon, ma_quy_trinh) values
  ('CAN-A-TUAO-MASTER','Tủ áo master 4 cánh','tu_ao','2400x600x2400','xuong','TU-AO-MELAMINE'),
  ('CAN-A-TUAO-NHO',   'Tủ áo nhỏ 2 cánh',   'tu_ao','1200x600x2000','xuong','TU-AO-MELAMINE'),
  ('CAN-A-BEP-TREN',   'Tủ bếp trên',        'tu_bep','2000x350x700','xuong','TU-BEP-MELAMINE'),
  ('CAN-A-BEP-DUOI',   'Tủ bếp dưới',        'tu_bep','2000x600x810','xuong','TU-BEP-MELAMINE'),
  ('CAN-A-KE-TIVI',    'Kệ tivi',            'ke','2400x400x500','xuong','KE-HO-MELAMINE'),
  ('CAN-A-TU-GIAY',    'Tủ giày',            'ke','1000x350x1000','xuong','KE-HO-MELAMINE')
  on conflict (ma_loi) do update set ma_quy_trinh = excluded.ma_quy_trinh;

insert into kho.san_pham_mau(ma, ten, ma_loi, dai_mm, rong_mm, cao_mm) values
  ('CAN-A-TUAO-MASTER-BT','Tủ áo master 4C 2m4','CAN-A-TUAO-MASTER',2400,600,2400),
  ('CAN-A-TUAO-NHO-BT',   'Tủ áo nhỏ 2C 1m2',   'CAN-A-TUAO-NHO',   1200,600,2000),
  ('CAN-A-BEP-TREN-BT',   'Tủ bếp trên 2m',     'CAN-A-BEP-TREN',   2000,350,700),
  ('CAN-A-BEP-DUOI-BT',   'Tủ bếp dưới 2m',     'CAN-A-BEP-DUOI',   2000,600,810),
  ('CAN-A-KE-TIVI-BT',    'Kệ tivi 2m4',        'CAN-A-KE-TIVI',    2400,400,500),
  ('CAN-A-TU-GIAY-BT',    'Tủ giày',            'CAN-A-TU-GIAY',    1000,350,1000)
  on conflict (ma) do nothing;

-- số đơn vị GÕ TAY (nguồn go_tay) — soạn hợp lý theo kích thước; CHỈ hoạt động có trong quy trình của món.
delete from kho.so_don_vi_mon where ma_bien_the like 'CAN-A-%';
insert into kho.so_don_vi_mon(ma_bien_the, hoat_dong, so_don_vi, nguon) values
  -- TUAO-MASTER (8 hoạt động, tủ lớn 2m4)
  ('CAN-A-TUAO-MASTER-BT','cat',45,'go_tay'),('CAN-A-TUAO-MASTER-BT','dan',50,'go_tay'),('CAN-A-TUAO-MASTER-BT','cam',120,'go_tay'),
  ('CAN-A-TUAO-MASTER-BT','thung',12,'go_tay'),('CAN-A-TUAO-MASTER-BT','cup',16,'go_tay'),('CAN-A-TUAO-MASTER-BT','ray',3,'go_tay'),
  ('CAN-A-TUAO-MASTER-BT','canh',4,'go_tay'),('CAN-A-TUAO-MASTER-BT','goi',2,'go_tay'),
  -- TUAO-NHO (8 hoạt động, tủ nhỏ 1m2 — số ÍT hơn master)
  ('CAN-A-TUAO-NHO-BT','cat',22,'go_tay'),('CAN-A-TUAO-NHO-BT','dan',25,'go_tay'),('CAN-A-TUAO-NHO-BT','cam',55,'go_tay'),
  ('CAN-A-TUAO-NHO-BT','thung',7,'go_tay'),('CAN-A-TUAO-NHO-BT','cup',8,'go_tay'),('CAN-A-TUAO-NHO-BT','ray',1,'go_tay'),
  ('CAN-A-TUAO-NHO-BT','canh',2,'go_tay'),('CAN-A-TUAO-NHO-BT','goi',1,'go_tay'),
  -- BEP-TREN (7 hoạt động, không ray)
  ('CAN-A-BEP-TREN-BT','cat',20,'go_tay'),('CAN-A-BEP-TREN-BT','dan',24,'go_tay'),('CAN-A-BEP-TREN-BT','cam',50,'go_tay'),
  ('CAN-A-BEP-TREN-BT','thung',8,'go_tay'),('CAN-A-BEP-TREN-BT','cup',6,'go_tay'),('CAN-A-BEP-TREN-BT','canh',3,'go_tay'),('CAN-A-BEP-TREN-BT','goi',1,'go_tay'),
  -- BEP-DUOI (7 hoạt động)
  ('CAN-A-BEP-DUOI-BT','cat',26,'go_tay'),('CAN-A-BEP-DUOI-BT','dan',30,'go_tay'),('CAN-A-BEP-DUOI-BT','cam',60,'go_tay'),
  ('CAN-A-BEP-DUOI-BT','thung',9,'go_tay'),('CAN-A-BEP-DUOI-BT','cup',6,'go_tay'),('CAN-A-BEP-DUOI-BT','canh',3,'go_tay'),('CAN-A-BEP-DUOI-BT','goi',2,'go_tay'),
  -- KE-TIVI (5 hoạt động, kệ hở)
  ('CAN-A-KE-TIVI-BT','cat',18,'go_tay'),('CAN-A-KE-TIVI-BT','dan',22,'go_tay'),('CAN-A-KE-TIVI-BT','cam',40,'go_tay'),('CAN-A-KE-TIVI-BT','thung',10,'go_tay'),('CAN-A-KE-TIVI-BT','goi',1,'go_tay'),
  -- TU-GIAY (5 hoạt động)
  ('CAN-A-TU-GIAY-BT','cat',12,'go_tay'),('CAN-A-TU-GIAY-BT','dan',14,'go_tay'),('CAN-A-TU-GIAY-BT','cam',28,'go_tay'),('CAN-A-TU-GIAY-BT','thung',6,'go_tay'),('CAN-A-TU-GIAY-BT','goi',1,'go_tay');

-- ════════ ③ ĐƠN full căn GIẢ (la_demo=true) + 6 món ════════
do $$
declare v_don uuid;
begin
  select id into v_don from kho.don_hang where ma_don = 'CAN-A-DEMO';
  if v_don is null then
    insert into kho.don_hang(ma_don, trang_thai, la_demo, ten_khach)
      values('CAN-A-DEMO','dang_thiet_ke', true, '[DEMO] Căn hộ A · 2 phòng ngủ') returning id into v_don;
  end if;
  delete from kho.don_hang_mon where don_id = v_don;   -- reset (idempotent)
  insert into kho.don_hang_mon(don_id, sp_id, ten, so_luong, trang_thai) values
    (v_don,'CAN-A-TUAO-MASTER-BT','Tủ áo master 4 cánh 2m4',1,'cho_cat'),
    (v_don,'CAN-A-TUAO-NHO-BT',   'Tủ áo nhỏ 2 cánh 1m2',  1,'cho_cat'),
    (v_don,'CAN-A-BEP-TREN-BT',   'Tủ bếp trên 2m',        1,'cho_cat'),
    (v_don,'CAN-A-BEP-DUOI-BT',   'Tủ bếp dưới 2m',        1,'cho_cat'),
    (v_don,'CAN-A-KE-TIVI-BT',    'Kệ tivi 2m4',           1,'cho_cat'),
    (v_don,'CAN-A-TU-GIAY-BT',    'Tủ giày',               1,'cho_cat');
end $$;

-- ════════ ④ RPC gio_du_kien_cua_don(ma_don) — cộng giờ cả đơn, FAIL-ĐÓNG cấp đơn ════════
create or replace function kho.gio_du_kien_cua_don(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare
  v_don uuid; r record; g jsonb; arr jsonb; i int; hd text; mato text; gi numeric; mgio numeric;
  v_mon jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
  v_hd jsonb := '{}'::jsonb; v_to jsonb := '{}'::jsonb;
  v_tong numeric := 0; v_nang jsonb := null; v_nang_gio numeric := -1;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'gio_du_kien_cua_don: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  select id into v_don from kho.don_hang where ma_don = p_ma_don;
  if not found then raise exception 'gio_du_kien_cua_don: không có đơn "%"', p_ma_don; end if;

  for r in select dhm.sp_id, dhm.ten, dhm.so_luong from kho.don_hang_mon dhm
           where dhm.don_id = v_don and dhm.sp_id is not null order by dhm.tao_luc loop
    g := kho.gio_du_kien_cua_mon(r.sp_id);
    if (g->>'ok')::boolean is not true then
      -- MÓN THIẾU: ghi RÕ thiếu gì, KHÔNG bỏ qua rồi cộng phần còn lại
      v_thieu := v_thieu || jsonb_build_array(jsonb_build_object('sp_id',r.sp_id,'ten',r.ten,'loi',g->'loi','thieu',g->'thieu'));
      v_mon   := v_mon   || jsonb_build_array(jsonb_build_object('sp_id',r.sp_id,'ten',r.ten,'ok',false,'tong_gio',null,'loi',g->'loi','thieu',g->'thieu'));
    else
      mgio := 0; arr := g->'buoc';
      for i in 0 .. jsonb_array_length(arr) - 1 loop
        hd := arr->i->>'hoat_dong'; gi := (arr->i->>'gio')::numeric * coalesce(r.so_luong,1);
        select ma_to into mato from kho.don_gia_baseline where hoat_dong = hd;
        mato := coalesce(mato, '(chưa rõ tổ)');
        v_hd := jsonb_set(v_hd, array[hd],   to_jsonb(coalesce((v_hd->>hd)::numeric,0)   + gi));
        v_to := jsonb_set(v_to, array[mato], to_jsonb(coalesce((v_to->>mato)::numeric,0) + gi));
        mgio := mgio + gi;
      end loop;
      v_tong := v_tong + mgio;
      v_mon := v_mon || jsonb_build_array(jsonb_build_object('sp_id',r.sp_id,'ten',r.ten,'ok',true,'tong_gio',mgio,'so_luong',coalesce(r.so_luong,1)));
      if mgio > v_nang_gio then v_nang_gio := mgio; v_nang := jsonb_build_object('sp_id',r.sp_id,'ten',r.ten,'tong_gio',mgio); end if;
    end if;
  end loop;

  -- FAIL-ĐÓNG: có món thiếu → tong_gio_don = NULL, liệt kê món thiếu; KHÔNG trả tổng 5 món như thể đủ
  if jsonb_array_length(v_thieu) > 0 then
    return jsonb_build_object('ma_don',p_ma_don,'ok',false,'tong_gio_don',null,'thieu_mon',v_thieu,'mon',v_mon);
  end if;
  return jsonb_build_object('ma_don',p_ma_don,'ok',true,'tong_gio_don',v_tong,'mon',v_mon,
    'theo_hoat_dong',v_hd,'theo_to',v_to,'mon_nang_nhat',v_nang);
end $$;
grant execute on function kho.gio_du_kien_cua_don(text) to authenticated;

commit;
