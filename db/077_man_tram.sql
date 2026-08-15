-- db/077 — RPC nền cho MÀN TRẠM QUÉT (app Xưởng, L-19)
-- Căn cứ MES 6.1.3 (MES Terminal): danh sách chờ + nút trạng thái luôn thấy · thu dữ liệu bằng quét ·
--   trạng thái máy ghi đầy đủ (danh mục lý do, không gõ tự do) · ghi bù sau ca.
-- FAIL-ĐÓNG: tram_quet chỉ BỌC quet_tem (guard a–f ở sq_ghi), KHÔNG tự đoán chặn. THUẦN DB.
-- Mọi RPC gác vai tho/xuong/ceo (coalesce fail-đóng). Idempotent (create or replace).
begin;

-- gác vai dùng chung cho màn trạm
create or replace function kho.tram_gac_vai() returns void language plpgsql stable as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('tho','xuong','ceo') then
    raise exception 'màn trạm: chỉ tho/xuong/ceo'; end if;
end $$;

-- ─────────── danh sách trạm (chọn thiết bị lần đầu) ───────────
create or replace function kho.tram_ds()
  returns table(ma_tram text, ten text, hoat_dong text, hd_ten text)
  language sql stable security definer set search_path = kho as $$
  select t.ma_tram, t.ten, t.hoat_dong, coalesce(d.ten, t.hoat_dong)
  from kho.tram t left join kho.don_gia_baseline d on d.hoat_dong = t.hoat_dong
  where t.dang_dung order by t.ma_tram;
$$;
grant execute on function kho.tram_ds() to authenticated;

-- ─────────── người có thể mở ca (thợ + xưởng đang hoạt động) ───────────
create or replace function kho.tram_ds_nguoi()
  returns table(id uuid, ho_ten text, vai_tro text)
  language sql stable security definer set search_path = kho as $$
  select id, ho_ten, vai_tro from kho.nguoi_dung
  where dang_hoat_dong and vai_tro in ('tho','xuong','ceo') order by ho_ten;
$$;
grant execute on function kho.tram_ds_nguoi() to authenticated;

-- ─────────── danh mục lý do dừng (dropdown, KHÔNG gõ tự do) ───────────
create or replace function kho.ly_do_dung_ds()
  returns table(ma text, ten text, nhom text)
  language sql stable security definer set search_path = kho as $$
  select ma, ten, nhom from kho.ly_do_dung where dang_dung order by nhom, ten;
$$;
grant execute on function kho.ly_do_dung_ds() to authenticated;

-- ─────────── đầu màn: trạm + người trực + trạng thái + có ca chưa ───────────
create or replace function kho.tram_man(p_tram text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb; v_ca record; v_ten_nguoi text;
begin
  perform kho.tram_gac_vai();
  select nguoi_id, bat_dau into v_ca from kho.ca_lam where ma_tram = p_tram and ket_thuc is null order by bat_dau desc limit 1;
  if v_ca.nguoi_id is not null then select ho_ten into v_ten_nguoi from kho.nguoi_dung where id = v_ca.nguoi_id; end if;
  select jsonb_build_object(
    'ma_tram', t.ma_tram, 'ten', t.ten, 'hoat_dong', t.hoat_dong,
    'hd_ten', coalesce(d.ten, t.hoat_dong), 'dang_dung', t.dang_dung,
    'co_ca', (v_ca.nguoi_id is not null), 'nguoi_truc', v_ten_nguoi,
    'trang_thai', coalesce(kho.sq_tram_trang_thai(p_tram), 'chay'))
    into v from kho.tram t left join kho.don_gia_baseline d on d.hoat_dong = t.hoat_dong
    where t.ma_tram = p_tram;
  return coalesce(v, jsonb_build_object('ma_tram', p_tram, 'khong_co', true));
end $$;
grant execute on function kho.tram_man(text) to authenticated;

-- ─────────── mở ca (chọn tên, không gõ) ───────────
create or replace function kho.mo_ca(p_tram text, p_nguoi uuid)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  perform kho.tram_gac_vai();
  if not exists (select 1 from kho.tram where ma_tram = p_tram and dang_dung) then
    raise exception 'mo_ca: trạm "%" không dùng được', p_tram; end if;
  if not exists (select 1 from kho.nguoi_dung where id = p_nguoi and dang_hoat_dong) then
    raise exception 'mo_ca: người không hợp lệ'; end if;
  -- đóng ca cũ của CHÍNH người này (một người một trạm) rồi mở ca mới ở trạm này
  update kho.ca_lam set ket_thuc = now() where nguoi_id = p_nguoi and ket_thuc is null;
  insert into kho.ca_lam(nguoi_id, ma_tram) values (p_nguoi, p_tram);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function kho.mo_ca(text, uuid) to authenticated;

-- ─────────── đổi trạng thái trạm (non-chay bắt buộc lý do từ danh mục) ───────────
create or replace function kho.doi_trang_thai_tram(p_tram text, p_trang_thai text, p_ly_do text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  perform kho.tram_gac_vai();
  if p_trang_thai not in ('chay','nghi','hong','cho_vat_tu','ve_sinh') then
    raise exception 'doi_trang_thai_tram: trạng thái lạ "%"', p_trang_thai; end if;
  if p_trang_thai <> 'chay' and coalesce(btrim(p_ly_do),'') = '' then
    raise exception 'doi_trang_thai_tram: trạng thái "%" cần lý do', p_trang_thai; end if;
  update kho.trang_thai_tram set ket_thuc = now() where ma_tram = p_tram and ket_thuc is null;
  insert into kho.trang_thai_tram(ma_tram, trang_thai, ly_do, nguoi_id, nguon)
    values (p_tram, p_trang_thai, case when p_trang_thai='chay' then null else p_ly_do end, kho.current_ns(), 'nguoi');
  return jsonb_build_object('ok', true, 'trang_thai', p_trang_thai);
end $$;
grant execute on function kho.doi_trang_thai_tram(text, text, text) to authenticated;

-- ─────────── ĐANG CHỜ ở trạm này (MES 6.1.3 khung 1) ───────────
--   tem sẵn sàng cho bước của trạm: mọi bước-trước LIÊN QUAN (cùng nhánh + 'chung', L-18) đã 'ra',
--   nhưng CHƯA 'vao' ở trạm này. Chỉ đơn đang sản xuất. Trả số + 8 tấm gần sẵn sàng nhất.
create or replace function kho.tram_dang_cho(p_tram text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_hd text; v_ds jsonb; v_so int;
begin
  perform kho.tram_gac_vai();
  select hoat_dong into v_hd from kho.tram where ma_tram = p_tram;
  if v_hd is null then return jsonb_build_object('so', 0, 'ds', '[]'::jsonb); end if;

  with tv as (
    select distinct on (ma_tam) ma_tam, ma_don, mon_id, vai_tro
    from kho.tem_ban_ve order by ma_tam, phien_ban desc
  ),
  u as (
    select tv.ma_tam, tv.ma_don, tv.mon_id, tv.vai_tro,
           (kho.nhanh_cua_tem(tv.ma_tam) ->> 'nhanh') as nhanh,
           q.qt, sb.buoc_truoc
    from tv
    join kho.don_hang d on d.ma_don = tv.ma_don and d.trang_thai in ('cho_cat','da_cat','dang_lam')
    cross join lateral (select qt, nhieu from kho.sq_qt_cua_tem(tv.ma_tam)) q
    join kho.quy_trinh_buoc sb on sb.ma_quy_trinh = q.qt and sb.hoat_dong = v_hd
    where q.qt is not null and not q.nhieu
  ),
  san as (
    select u.*,
      exists(select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
             where sq.tem_ma = u.ma_tam and sq.ket_qua='nhan' and sq.loai='vao' and t.hoat_dong = v_hd) as da_vao,
      (select bool_and(exists(
                select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
                where sq.tem_ma = u.ma_tam and sq.ket_qua='nhan' and sq.loai='ra' and t.hoat_dong = pb.hoat_dong))
       from unnest(coalesce(u.buoc_truoc, array[]::int[])) pr
       join kho.quy_trinh_buoc pb on pb.ma_quy_trinh = u.qt and pb.thu_tu = pr
       where u.nhanh = 'chung' or pb.nhanh = 'chung' or pb.nhanh = u.nhanh) as pre_xong,
      (select max(kho.sq_luc(sq.*)) from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
       join unnest(coalesce(u.buoc_truoc, array[]::int[])) pr on true
       join kho.quy_trinh_buoc pb on pb.ma_quy_trinh = u.qt and pb.thu_tu = pr and pb.hoat_dong = t.hoat_dong
       where sq.tem_ma = u.ma_tam and sq.ket_qua='nhan' and sq.loai='ra'
         and (u.nhanh='chung' or pb.nhanh='chung' or pb.nhanh=u.nhanh)) as san_luc
    from u
  ),
  cho as (
    select * from san where not da_vao and coalesce(pre_xong, true)
  )
  select count(*)::int,
    coalesce(jsonb_agg(x.j order by x.san_luc desc nulls last) filter (where x.rn <= 8), '[]'::jsonb)
  into v_so, v_ds
  from (
    select san_luc, row_number() over (order by san_luc desc nulls last) rn,
      jsonb_build_object(
        'tem', ma_tam,
        'tam', kho.ten_vai_tro_tam(vai_tro),
        'mon', (select ten from kho.don_hang_mon m where m.id = cho.mon_id),
        'don', ma_don,
        'cho_phut', case when san_luc is null then null else round(extract(epoch from now()-san_luc)/60)::int end
      ) j
    from cho
  ) x;
  return jsonb_build_object('so', coalesce(v_so,0), 'ds', v_ds);
end $$;
grant execute on function kho.tram_dang_cho(text) to authenticated;

-- ─────────── ca hôm nay: số tấm · hỏng · giờ (ca đang mở) ───────────
create or replace function kho.tram_ca_hom_nay(p_tram text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_bd timestamptz; v_so int; v_hong numeric; v_gio numeric;
begin
  perform kho.tram_gac_vai();
  select bat_dau into v_bd from kho.ca_lam where ma_tram = p_tram and ket_thuc is null order by bat_dau desc limit 1;
  if v_bd is null then return jsonb_build_object('co_ca', false, 'so_tam', 0, 'so_hong', 0, 'gio', 0); end if;
  select count(distinct sq.tem_ma) filter (where sq.loai='ra'),
         coalesce(sum(sq.so_hong) filter (where sq.loai='ra'), 0)
    into v_so, v_hong
    from kho.su_kien_quet sq
    where sq.ma_tram = p_tram and sq.ket_qua='nhan' and sq.luc >= v_bd;
  -- giờ chạm tay = Σ(ra − vào) GHÉP CẶP: mỗi 'ra' trong ca ghép với 'vào' liền trước cùng tem+trạm.
  --   (KHÔNG cộng epoch trần — 'vào' lẻ chưa có 'ra' sẽ ra số vô nghĩa.)
  select coalesce(sum(extract(epoch from (kho.sq_luc(r.*) - kho.sq_luc(v.*)))) / 3600.0, 0)
    into v_gio
    from kho.su_kien_quet r
    cross join lateral (select * from kho.su_kien_quet v
      where v.tem_ma = r.tem_ma and v.ma_tram = r.ma_tram and v.loai='vao' and v.ket_qua='nhan'
        and kho.sq_luc(v.*) < kho.sq_luc(r.*) order by kho.sq_luc(v.*) desc limit 1) v
    where r.ma_tram = p_tram and r.loai='ra' and r.ket_qua='nhan' and r.luc >= v_bd;
  return jsonb_build_object('co_ca', true, 'so_tam', coalesce(v_so,0), 'so_hong', coalesce(v_hong,0),
                            'gio', round(coalesce(v_gio,0)::numeric, 1));
end $$;
grant execute on function kho.tram_ca_hom_nay(text) to authenticated;

-- ─────────── lượt vừa quét ở trạm (8 dòng gần nhất) ───────────
create or replace function kho.tram_luot_gan_day(p_tram text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb;
begin
  perform kho.tram_gac_vai();
  select coalesce(jsonb_agg(j order by luc desc), '[]'::jsonb) into v from (
    select sq.luc,
      jsonb_build_object(
        'gio', to_char(kho.sq_luc(sq.*) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'tem', sq.tem_ma,
        'tam', kho.ten_vai_tro_tam(tv.vai_tro),
        'vr', case when sq.ket_qua='chan' then 'chan' else sq.loai end,
        'hong', (coalesce(sq.so_hong,0) > 0)
      ) j
    from kho.su_kien_quet sq
    left join lateral (select vai_tro from kho.tem_ban_ve where ma_tam = sq.tem_ma order by phien_ban desc limit 1) tv on true
    where sq.ma_tram = p_tram
    order by sq.luc desc limit 8
  ) t;
  return v;
end $$;
grant execute on function kho.tram_luot_gan_day(text) to authenticated;

-- ─────────── tram_quet: BỌC quet_tem + làm giàu hiển thị + ĐƯỜNG THOÁT ───────────
--   FAIL-ĐÓNG: guard nằm ở quet_tem/sq_ghi. Đây chỉ thêm chữ cho màn. Chặn → kèm câu PHẢI LÀM GÌ.
create or replace function kho.tram_quet(p_tem text, p_tram text, p_so_hong numeric default 0, p_so_lam_lai numeric default 0)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare g jsonb; v_vai text; v_tam text; v_don text; v_mon text; v_hd_ten text; v_thoat text;
        v_mon_id uuid; v_vaitro text; v_tien jsonb; v_phut int;
begin
  perform kho.tram_gac_vai();
  -- lõi fail-đóng
  g := kho.quet_tem(p_tem, p_tram, p_so_hong, p_so_lam_lai);
  -- thông tin tấm (luôn có nếu tem tồn tại)
  select vai_tro, mon_id, ma_don into v_vaitro, v_mon_id, v_don
    from kho.tem_ban_ve where ma_tam = p_tem order by phien_ban desc limit 1;
  v_tam := kho.ten_vai_tro_tam(v_vaitro);
  if v_mon_id is not null then select ten into v_mon from kho.don_hang_mon where id = v_mon_id; end if;

  if (g->>'ok')::boolean then
    -- hoạt động của trạm + số phút cặp vào-ra gần nhất (nếu là 'ra')
    select coalesce(d.ten, t.hoat_dong) into v_hd_ten
      from kho.tram t left join kho.don_gia_baseline d on d.hoat_dong = t.hoat_dong where t.ma_tram = p_tram;
    v_tien := kho.tien_do_tam(p_tem);
    if (g->>'loai') = 'ra' then
      select round(extract(epoch from (
        (select max(kho.sq_luc(sq.*)) from kho.su_kien_quet sq where sq.tem_ma=p_tem and sq.ma_tram=p_tram and sq.loai='ra' and sq.ket_qua='nhan')
        - (select max(kho.sq_luc(sq.*)) from kho.su_kien_quet sq where sq.tem_ma=p_tem and sq.ma_tram=p_tram and sq.loai='vao' and sq.ket_qua='nhan')
      ))/60)::int into v_phut;
    end if;
    return g || jsonb_build_object('tam', v_tam, 'mon', v_mon, 'don', v_don, 'hoat_dong_ten', v_hd_ten,
      'mat_phut', v_phut, 'buoc_ke', v_tien->>'ten_buoc_ke_tiep', 'xong', v_tien->'xong', 'tong_buoc', v_tien->'tong_buoc');
  end if;

  -- CHẶN → đường thoát (câu thứ hai BẮT BUỘC: đường ghi bù/hành động)
  v_thoat := case g->>'loi'
    when 'NHAY_BUOC' then 'Mang tấm sang tổ '
        || nullif(regexp_replace(coalesce(g->>'ly_do',''), '^tấm này chưa qua ', ''), '')
        || ' trước. Nếu tấm đã làm rồi mà quên quét, báo tổ trưởng ghi bù.'
    when 'TRAM_KHONG_CHAY' then 'Đổi trạng thái trạm về "Đang chạy" rồi quét lại. Nếu máy vừa xong, báo tổ trưởng.'
    when 'CHUA_CO_CA' then 'Mở ca ở trạm này trước khi quét.'
    when 'NHIEU_QUY_TRINH' then 'Đơn có nhiều quy trình — nhờ tổ trưởng gán tấm vào đúng món trước.'
    when 'CHUA_QUY_TRINH' then 'Sản phẩm chưa có quy trình — báo tổ trưởng / kỹ thuật.'
    when 'TEM_LA' then 'Tem không đọc được trong hệ — kiểm lại tem hoặc báo tổ trưởng.'
    when 'TRAM_TAT' then 'Trạm này chưa được bật — báo tổ trưởng.'
    when 'SAI_TRAM' then 'Tấm này không có bước ở trạm này — mang sang đúng trạm.'
    else 'Báo tổ trưởng để xử lý.'
  end;
  return g || jsonb_build_object('tam', v_tam, 'mon', v_mon, 'don', v_don, 'duong_thoat', v_thoat);
end $$;
grant execute on function kho.tram_quet(text, text, numeric, numeric) to authenticated;

commit;
