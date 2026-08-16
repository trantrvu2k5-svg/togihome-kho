-- db/086 — THIẾT KẾ BÁN HÀNG NHẬP SỐ ƯỚC khi gửi bản 3D (L-40)
--   Bối cảnh (QD-15): số đơn vị có BA MỐC. Mốc 'du_kien' = thiết kế BÁN HÀNG ước, để BÁO GIÁ khách.
--   Mốc 'du_kien' đang 0 dòng → atp('du_kien') luôn THIEU_SO_DON_VI → dòng báo giá không có ngày giao.
--   Lô này mở cho tk_ban_hang GHI được mốc 'du_kien' (CHỈ du_kien; 'chuan' vẫn chỉ thiet_ke/ceo — QD-15
--   "không mốc nào ghi đè mốc nào"). so_don_vi_mon khoá (mon_id,hoat_dong,moc) từ db/070 → ghi du_kien
--   KHÔNG bao giờ đụng dòng chuan (khác moc = khác khoá). nguon='uoc' (QD-06).
--
--   ⚠ GHI CHÚ MÂU THUẪN ĐẦU BÀI (báo ra, không lặng lẽ): L-40 A1 nói "ma trận vai (db/038)". Nhưng db/038
--   (chan_chuyen_theo_vai) GÁC don_hang.trang_thai — KHÔNG gác ghi so_don_vi_mon. Hơn nữa GHI so_don_vi_mon
--   là DEFINER-ONLY: authenticated chỉ có SELECT (grant), mọi INSERT/UPDATE đi qua RPC definer. Nên "ma trận
--   vai" GHI SỐ nằm ở CỔNG VAI TRONG TỪNG RPC ghi, KHÔNG ở db/038 và KHÔNG ở RLS. Lô này mở đúng chỗ đó (RPC).
--
--   Chạy: cd web && node ops/run_sql.mjs ../db/086_tkbh_so_uoc.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ MA TRẬN VAI GHI so_don_vi_mon (theo RPC ghi — definer, tự gác vai) ══════════
--   TRƯỚC lô này:                                  SAU lô này:
--     luu_so_don_vi (mọi mốc, mặc định chuan):        (giữ nguyên) luu_so_don_vi: ceo, thiet_ke
--        ceo, thiet_ke                                 tkbh_so_uoc  (CHỈ du_kien): ceo, thiet_ke, tk_ban_hang  ← MỚI
--     → du_kien ghi được bởi: ceo, thiet_ke          → du_kien ghi được bởi: ceo, thiet_ke, tk_ban_hang  ← MỞ THÊM
--     → chuan  ghi được bởi: ceo, thiet_ke           → chuan  ghi được bởi: ceo, thiet_ke                 ← GIỮ NGUYÊN
--   (tk_ban_hang KHÔNG gọi được luu_so_don_vi → KHÔNG có đường nào ghi chuan. tkbh_so_uoc ÉP moc='du_kien'.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.tkbh_so_uoc(text,uuid,jsonb);
--   drop function if exists kho.tkbh_goi_y_so(uuid);
--   drop function if exists kho.tkbh_so_cua_don(text);
--   drop function if exists kho._kt_dims(text);
--   drop index if exists kho.idx_dhm_sp; drop index if exists kho.idx_sdv_chuan_mon;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─────────── 1. Dọn policy chết (nếu lần chạy trước đã tạo) — GHI số là DEFINER-ONLY, RLS không tới ───────────
--   authenticated chỉ SELECT so_don_vi_mon; mọi ghi đi qua RPC definer. Cổng vai nằm TRONG RPC (mục 3), không ở RLS.
drop policy if exists sdv_ghi_uoc_tkbh on kho.so_don_vi_mon;

-- ─────────── 2. _kt_dims: tách kích thước "160x60x75" → [160,60,75] (immutable, cho gợi ý) ───────────
create or replace function kho._kt_dims(p text) returns numeric[]
  language sql immutable as $$
  select coalesce(array_agg((m[1])::numeric), '{}'::numeric[])
  from regexp_matches(coalesce(p,''), '[0-9]+(?:\.[0-9]+)?', 'g') as m;
$$;

-- ─────────── 3. tkbh_so_uoc: ghi số ước mốc 'du_kien', nguồn 'uoc' (KHÔNG đụng 'chuan') ───────────
--   p_so_lieu = map hoat_dong -> số đơn vị, ví dụ {"cat":40,"dan":18.5,"cam":24,"thung":6,"cup":8,"ray":2,"canh":4,"goi":1}
--   Gác: vai ceo/thiet_ke/tk_ban_hang · đơn đang BÁO GIÁ (bao_gia/bao_gia_treo) · món thuộc đơn.
--   Ghi đè được (ước lại nhiều lần). Chỉ ghi moc='du_kien' → dòng 'chuan' bất khả xâm phạm (khác khoá).
create or replace function kho.tkbh_so_uoc(p_ma_don text, p_mon_id uuid, p_so_lieu jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ns  uuid;
  v_don kho.don_hang;
  v_hd text; v_txt text; v_val numeric; v_n int := 0;
begin
  if v_vai not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'tkbh_so_uoc: chỉ ceo/thiet_ke/tk_ban_hang (vai "%")',
      coalesce(nullif(v_vai,''),'(chưa đăng nhập)');
  end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'tkbh_so_uoc: không có đơn "%"', p_ma_don; end if;
  if v_don.trang_thai not in ('bao_gia','bao_gia_treo') then
    raise exception 'tkbh_so_uoc: đơn "%" không ở trạng thái báo giá (đang "%") — số ước chỉ nhập lúc báo giá',
      p_ma_don, v_don.trang_thai;
  end if;
  if not exists (select 1 from kho.don_hang_mon m where m.id = p_mon_id and m.don_id = v_don.id) then
    raise exception 'tkbh_so_uoc: món % không thuộc đơn "%"', p_mon_id, p_ma_don;
  end if;
  select id into v_ns from kho.nguoi_dung where auth_uid = auth.uid();

  for v_hd, v_txt in select key, value from jsonb_each_text(coalesce(p_so_lieu,'{}'::jsonb)) loop
    if not exists (select 1 from kho.don_gia_baseline b where b.hoat_dong = v_hd) then
      raise exception 'tkbh_so_uoc: hoạt động lạ "%"', v_hd; end if;
    if v_txt !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'tkbh_so_uoc: số "%" ở "%" không phải số không âm', v_txt, v_hd; end if;
    v_val := v_txt::numeric;
    insert into kho.so_don_vi_mon(mon_id, hoat_dong, moc, so_don_vi, nguon, nguoi_nhap)
      values (p_mon_id, v_hd, 'du_kien', v_val, 'uoc', v_ns)
    on conflict (mon_id, hoat_dong, moc)
      do update set so_don_vi = excluded.so_don_vi, nguon = 'uoc',
                    nguoi_nhap = excluded.nguoi_nhap, luc = now();
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'mon_id', p_mon_id,
                            'so_ghi', v_n, 'moc', 'du_kien', 'nguon', 'uoc');
end $$;
grant execute on function kho.tkbh_so_uoc(text, uuid, jsonb) to authenticated;

-- ─────────── 4. tkbh_goi_y_so: gợi ý số từ MÓN TƯƠNG TỰ đã có mốc 'chuan' ───────────
--   Cùng LOẠI (ưu tiên sp_id; món tự do không sp_id → theo ma_quy_trinh) + kích thước GẦN NHẤT.
--   Trả danh sách (tối đa 5) mỗi cái: tên nguồn · kt nguồn · độ chênh kích thước · map số 'chuan'.
--   Không có món tương tự nào → co_goi_y=false + goi_y rỗng. KHÔNG trả 0.
create or replace function kho.tkbh_goi_y_so(p_mon_id uuid)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_sp text; v_qt text; v_kt text; v_dims numeric[]; v_list jsonb; v_ids uuid[];
begin
  if v_vai not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'tkbh_goi_y_so: chỉ ceo/thiet_ke/tk_ban_hang'; end if;
  select sp_id, ma_quy_trinh, kt into v_sp, v_qt, v_kt
    from kho.don_hang_mon where id = p_mon_id;
  if not found then raise exception 'tkbh_goi_y_so: không có món %', p_mon_id; end if;
  v_dims := kho._kt_dims(v_kt);

  -- ứng viên = MÓN cùng LOẠI, đã có 'chuan'. TÁCH nhánh để predicate ĐI ĐÚNG INDEX (idx_dhm_sp / ma_quy_trinh),
  --   không dùng OR trên biến (OR-trên-biến ép seq scan — chậm ở quy mô lớn).
  if v_sp is not null then
    select array_agg(m.id) into v_ids from kho.don_hang_mon m
      where m.sp_id = v_sp and m.id <> p_mon_id
        and exists (select 1 from kho.so_don_vi_mon s where s.mon_id = m.id and s.moc = 'chuan');
  elsif v_qt is not null then
    select array_agg(m.id) into v_ids from kho.don_hang_mon m
      where m.ma_quy_trinh = v_qt and m.id <> p_mon_id
        and exists (select 1 from kho.so_don_vi_mon s where s.mon_id = m.id and s.moc = 'chuan');
  else
    v_ids := null;   -- không sp_id lẫn quy trình → không có "loại" để so
  end if;

  if v_ids is not null then
    select jsonb_agg(jsonb_build_object(
             'mon_nguon_id', id, 'ten', ten, 'kt', kt, 'chenh_kt', chenh,
             'so_lieu', (select jsonb_object_agg(hoat_dong, so_don_vi)
                           from kho.so_don_vi_mon where mon_id = x.id and moc = 'chuan')
           ) order by chenh asc)
      into v_list
    from (
      select m.id, m.ten, m.kt, md.chenh
      from kho.don_hang_mon m
        cross join lateral (
          select ( abs(coalesce(d[1],0) - coalesce(v_dims[1],0))
                 + abs(coalesce(d[2],0) - coalesce(v_dims[2],0))
                 + abs(coalesce(d[3],0) - coalesce(v_dims[3],0)) ) as chenh
          from (select kho._kt_dims(m.kt) d) t
        ) md
      where m.id = any(v_ids)
      order by md.chenh asc limit 5
    ) x;
  end if;

  if v_list is null then
    return jsonb_build_object('ok', true, 'co_goi_y', false, 'goi_y', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'co_goi_y', true, 'goi_y', v_list);
end $$;
grant execute on function kho.tkbh_goi_y_so(uuid) to authenticated;

-- ─────────── 5. tkbh_so_cua_don: đọc số ĐÃ ước của mỗi món (cho màn hiện "đã ước") ───────────
--   Trả từng món: đã ước chưa (có dòng du_kien) + map số du_kien. Definer để tk_ban_hang đọc được.
create or replace function kho.tkbh_so_cua_don(p_ma_don text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don uuid; v_out jsonb;
begin
  if v_vai not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'tkbh_so_cua_don: chỉ ceo/thiet_ke/tk_ban_hang'; end if;
  select id into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don is null then raise exception 'tkbh_so_cua_don: không có đơn "%"', p_ma_don; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'mon_id', m.id, 'ten', m.ten, 'kt', m.kt,
           'da_uoc', exists(select 1 from kho.so_don_vi_mon s where s.mon_id = m.id and s.moc='du_kien'),
           'so_lieu', coalesce((select jsonb_object_agg(hoat_dong, so_don_vi)
                        from kho.so_don_vi_mon where mon_id = m.id and moc='du_kien'), '{}'::jsonb)
         ) order by m.id), '[]'::jsonb)
    into v_out
  from kho.don_hang_mon m where m.don_id = v_don;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'mon', v_out);
end $$;
grant execute on function kho.tkbh_so_cua_don(text) to authenticated;

-- ─────────── 6. Index đỡ gợi ý ở quy mô lớn (Test 7: 3.000 đơn < 500ms) ───────────
create index if not exists idx_dhm_sp on kho.don_hang_mon(sp_id);
create index if not exists idx_sdv_chuan_mon on kho.so_don_vi_mon(mon_id) where moc = 'chuan';

-- ─────────── 6b. atp: MỞ cho tk_ban_hang XEM (thiết kế bán hàng phải thấy ngày mình vừa ước) ───────────
--   Chỉ đổi CỔNG VAI: thêm 'tk_ban_hang'. Thân hàm GIỮ NGUYÊN db/080 (chép verbatim, chỉ khác 1 dòng vai).
create or replace function kho.atp(p_ma_don text, p_moc text default 'chuan')
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare r jsonb; r2 jsonb; v_khac text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan','sale','thiet_ke','tk_ban_hang') then
    raise exception 'atp: vai không xem được'; end if;
  if p_moc not in ('du_kien','chuan') then raise exception 'atp: mốc phải du_kien/chuan'; end if;
  r := kho._atp_moc(p_ma_don, p_moc);
  if (r->>'loi') = 'THIEU_SO_DON_VI' then
    v_khac := case p_moc when 'chuan' then 'du_kien' else 'chuan' end;
    r2 := kho._atp_moc(p_ma_don, v_khac);
    if (r2->>'ok')::boolean is true then
      return r2 || jsonb_build_object('ma_don',p_ma_don,'moc_da_dung',v_khac,
        'do_tin', case when v_khac='chuan' then 'cao' else 'uoc' end,
        'da_dung_moc_khac', true, 'moc_yeu_cau', p_moc); end if;
    return jsonb_build_object('ok',false,'loi','THIEU_SO_DON_VI','ma_don',p_ma_don,'moc_yeu_cau',p_moc,
      'ca_hai_moc_trong', true);
  end if;
  if (r->>'ok')::boolean is not true then return r || jsonb_build_object('ma_don',p_ma_don); end if;
  return r || jsonb_build_object('ma_don',p_ma_don,'moc_da_dung',p_moc,
    'do_tin', case when p_moc='chuan' then 'cao' else 'uoc' end, 'da_dung_moc_khac', false);
end $$;
grant execute on function kho.atp(text, text) to authenticated;

-- ─────────── 7. KIỂM nhanh: 3 RPC + policy tồn tại ───────────
do $$
begin
  if to_regprocedure('kho.tkbh_so_uoc(text,uuid,jsonb)') is null then raise exception 'THIẾU tkbh_so_uoc'; end if;
  if to_regprocedure('kho.tkbh_goi_y_so(uuid)')        is null then raise exception 'THIẾU tkbh_goi_y_so'; end if;
  if to_regprocedure('kho.tkbh_so_cua_don(text)')      is null then raise exception 'THIẾU tkbh_so_cua_don'; end if;
  raise notice 'db/086 OK: tkbh_so_uoc · tkbh_goi_y_so · tkbh_so_cua_don (ghi số definer-only, cổng vai trong RPC)';
end $$;

commit;
