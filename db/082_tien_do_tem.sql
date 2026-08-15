-- db/082 — tien_do_tem: trạng thái HIỆN TẠI của từng tem (lưu sẵn) — L-27
-- Căn cứ MES 6.3.2: điều khiển đơn vị SX cần TRUY VẾT — biết vị trí/trạng thái BẤT KỲ LÚC NÀO = tra ngay,
--   không suy lại từ toàn bộ lịch sử. → trạng thái hiện tại của tem LƯU SẴN (bảng suy ra, nguồn vẫn là su_kien_quet).
-- L-26: tram_dang_cho vẫn timeout ở 100k tem (index không cứu — quét mọi tem + hàm con từng tem); do_gio_that ~2,2s.
-- THUẦN DB.
begin;

-- ─────────── VIỆC 1 · bảng SUY RA (mất thì dựng lại từ sổ) ───────────
create table if not exists kho.tien_do_tem (
  tem_ma        text primary key,
  mon_id        uuid,
  ma_don        text,
  buoc_hien_tai int,
  to_hien_tai   text,
  nhanh         text,
  trang_thai    text not null check (trang_thai in ('cho_vao','dang_lam','xong_buoc','xong_het')),
  tram_dang_o   text,
  vao_luc       timestamptz,
  ra_luc        timestamptz,
  so_buoc_xong  int,
  tong_so_buoc  int,
  cap_nhat_luc  timestamptz not null default now()
);
create index if not exists idx_tdt_to_tt on kho.tien_do_tem (to_hien_tai, trang_thai, ra_luc desc);
create index if not exists idx_tdt_mon   on kho.tien_do_tem (mon_id);
grant select on kho.tien_do_tem to authenticated;

-- ─────────── capnhat_tien_do_tem(tem): SUY từ sổ + upsert (dùng chung: quet + dựng lại) ───────────
create or replace function kho.capnhat_tien_do_tem(p_tem text)
  returns void language plpgsql security definer set search_path = kho as $$
declare v_mon uuid; v_don text; v_qt text; v_nhieu boolean; v_nhanh text;
        v_tong int; v_xong int; v_bhien int; v_to text; v_tt text; v_tramo text; v_vao timestamptz; v_ra timestamptz;
begin
  select mon_id, ma_don into v_mon, v_don from kho.tem_ban_ve where ma_tam = p_tem order by phien_ban desc limit 1;
  select qt, nhieu into v_qt, v_nhieu from kho.sq_qt_cua_tem(p_tem);
  if v_qt is null or v_nhieu then delete from kho.tien_do_tem where tem_ma = p_tem; return; end if;   -- không quy trình rõ
  v_nhanh := kho.nhanh_cua_tem(p_tem) ->> 'nhanh';
  select count(*) into v_tong from kho.quy_trinh_buoc where ma_quy_trinh = v_qt and coalesce(loai_buoc,'nguoi') <> 'tu_chay';
  select count(*) into v_xong from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt and coalesce(b.loai_buoc,'nguoi') <> 'tu_chay'
    and exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
                where sq.tem_ma = p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong = b.hoat_dong);

  -- ĐANG LÀM? bước có 'vao' chưa 'ra' (mới nhất)
  select b.thu_tu, t.ma_tram, d.ma_to,
         (select max(kho.sq_luc(s.*)) from kho.su_kien_quet s where s.tem_ma=p_tem and s.ma_tram=t.ma_tram and s.loai='vao' and s.ket_qua='nhan')
    into v_bhien, v_tramo, v_to, v_vao
    from kho.quy_trinh_buoc b join kho.tram t on t.hoat_dong = b.hoat_dong
    left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
    join kho.su_kien_quet sq on sq.ma_tram = t.ma_tram and sq.tem_ma = p_tem and sq.ket_qua='nhan'
    where b.ma_quy_trinh = v_qt
    group by b.thu_tu, t.ma_tram, d.ma_to
    having count(*) filter (where sq.loai='vao') > count(*) filter (where sq.loai='ra')
    order by b.thu_tu desc limit 1;

  if v_bhien is not null then
    v_tt := 'dang_lam'; v_ra := null;
  else
    -- BƯỚC KẾ TIẾP (nhánh-aware): bước người trên đường tem, chưa 'ra', predecessors LIÊN QUAN đã 'ra'
    select b.thu_tu, d.ma_to into v_bhien, v_to
      from kho.quy_trinh_buoc b left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
      where b.ma_quy_trinh = v_qt and coalesce(b.loai_buoc,'nguoi') <> 'tu_chay'
        and (v_nhanh='chung' or b.nhanh='chung' or b.nhanh = v_nhanh)
        and not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
                        where sq.tem_ma=p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=b.hoat_dong)
        and coalesce((select bool_and(exists (select 1 from kho.su_kien_quet sq2 join kho.tram t2 on t2.ma_tram=sq2.ma_tram
                        where sq2.tem_ma=p_tem and sq2.loai='ra' and sq2.ket_qua='nhan' and t2.hoat_dong=pb.hoat_dong))
                      from unnest(coalesce(b.buoc_truoc,array[]::int[])) pr
                      join kho.quy_trinh_buoc pb on pb.ma_quy_trinh=v_qt and pb.thu_tu=pr
                      where v_nhanh='chung' or pb.nhanh='chung' or pb.nhanh=v_nhanh), true)
      order by b.thu_tu limit 1;
    v_ra := (select max(kho.sq_luc(s.*)) from kho.su_kien_quet s where s.tem_ma=p_tem and s.loai='ra' and s.ket_qua='nhan');
    if v_bhien is not null then v_tt := 'cho_vao'; v_tramo := null; v_vao := null;
    elsif v_tong > 0 and v_xong >= v_tong then v_tt := 'xong_het'; v_to := null; v_tramo := null;
    else v_tt := 'cho_vao'; v_to := null; v_tramo := null; end if;   -- hiếm: không bước kế mà chưa xong hết
  end if;

  insert into kho.tien_do_tem(tem_ma,mon_id,ma_don,buoc_hien_tai,to_hien_tai,nhanh,trang_thai,tram_dang_o,vao_luc,ra_luc,so_buoc_xong,tong_so_buoc,cap_nhat_luc)
    values (p_tem,v_mon,v_don,v_bhien,v_to,v_nhanh,v_tt,v_tramo,v_vao,v_ra,v_xong,v_tong,now())
  on conflict (tem_ma) do update set mon_id=excluded.mon_id, ma_don=excluded.ma_don, buoc_hien_tai=excluded.buoc_hien_tai,
    to_hien_tai=excluded.to_hien_tai, nhanh=excluded.nhanh, trang_thai=excluded.trang_thai, tram_dang_o=excluded.tram_dang_o,
    vao_luc=excluded.vao_luc, ra_luc=excluded.ra_luc, so_buoc_xong=excluded.so_buoc_xong, tong_so_buoc=excluded.tong_so_buoc, cap_nhat_luc=now();
end $$;

-- ─────────── dung_lai_tien_do(): xoá sạch + dựng lại từ SỔ (bảng suy ra, không phải nguồn thứ hai) ───────────
create or replace function kho.dung_lai_tien_do()
  returns int language plpgsql security definer set search_path = kho as $$
declare n int := 0; t text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'dung_lai_tien_do: chỉ ceo/xuong'; end if;
  delete from kho.tien_do_tem;
  for t in select distinct tem_ma from kho.su_kien_quet where ket_qua='nhan' loop
    perform kho.capnhat_tien_do_tem(t); n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function kho.dung_lai_tien_do() to authenticated;

commit;

-- ─────────── VIỆC 2 · sq_ghi: sau khi ghi 'nhan' → cập nhật tien_do_tem (quét + ghi bù). Chặn KHÔNG đụng. ───────────
begin;
create or replace function kho.sq_ghi(p_tem text, p_tram text, p_loai_ep text, p_nguon text,
                                      p_ghi_bu_cho timestamptz, p_ly_do text, p_so_hong numeric, p_so_lam_lai numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_qt text; v_nhieu boolean; v_ns uuid; v_tt text; v_loai text; v_buoc record; v_thieu text;
        p int; v_pre_hd text; v_pre_nhanh text; v_nhanh text;
begin
  select nguoi_id into v_ns from kho.ca_lam where ma_tram = p_tram and ket_thuc is null order by bat_dau limit 1;
  v_loai := coalesce(p_loai_ep, 'vao');
  if not exists (select 1 from kho.tem_ban_ve where ma_tam = p_tem) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TEM_LA', 'tem không có trong hệ thống'); end if;
  if not exists (select 1 from kho.tram where ma_tram = p_tram and dang_dung) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_TAT', 'trạm không dùng được'); end if;
  v_loai := coalesce(p_loai_ep,
    case when (select count(*) filter (where loai='vao') - count(*) filter (where loai='ra')
               from kho.su_kien_quet where tem_ma=p_tem and ma_tram=p_tram and ket_qua='nhan') > 0 then 'ra' else 'vao' end);
  if v_ns is null then
    return kho.sq_chan(p_tem, p_tram, null, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_CO_CA', 'chưa ai mở ca ở trạm này'); end if;
  v_tt := coalesce(kho.sq_tram_trang_thai(p_tram), 'chay');
  if v_tt <> 'chay' then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_KHONG_CHAY', 'trạm đang "'||v_tt||'", không chạy'); end if;
  select qt, nhieu into v_qt, v_nhieu from kho.sq_qt_cua_tem(p_tem);
  if v_nhieu then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'NHIEU_QUY_TRINH', 'đơn này có nhiều quy trình, cần gán tấm vào món trước'); end if;
  if v_qt is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_QUY_TRINH', 'sản phẩm này chưa có quy trình sản xuất'); end if;
  select b.thu_tu, b.buoc_truoc into v_buoc
    from kho.quy_trinh_buoc b join kho.tram t on t.ma_tram = p_tram
    where b.ma_quy_trinh = v_qt and b.hoat_dong = t.hoat_dong limit 1;
  if v_buoc.thu_tu is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'SAI_TRAM', 'quy trình không có bước cho trạm này'); end if;
  v_nhanh := kho.nhanh_cua_tem(p_tem) ->> 'nhanh';
  v_thieu := null;
  foreach p in array coalesce(v_buoc.buoc_truoc, array[]::int[]) loop
    select b.hoat_dong, b.nhanh into v_pre_hd, v_pre_nhanh
      from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt and b.thu_tu = p;
    if v_nhanh = 'chung' or v_pre_nhanh = 'chung' or v_pre_nhanh = v_nhanh then
      if not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
        where sq.tem_ma = p_tem and sq.loai = 'ra' and sq.ket_qua = 'nhan' and t.hoat_dong = v_pre_hd) then
        v_thieu := concat_ws(', ', v_thieu, (select ten from kho.don_gia_baseline where hoat_dong = v_pre_hd));
      end if;
    end if;
  end loop;
  if v_thieu is not null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'NHAY_BUOC', 'tấm này chưa qua ' || v_thieu); end if;

  -- ĐỦ guard → ghi NHẬN
  insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,nguon,ghi_bu_cho,ly_do_chan,so_hong,so_lam_lai)
    values (p_tem, p_tram, v_ns, v_loai, 'nhan', p_nguon, p_ghi_bu_cho, case when p_nguon='tay' then p_ly_do else null end,
            coalesce(p_so_hong,0), coalesce(p_so_lam_lai,0));
  perform kho.capnhat_tien_do_tem(p_tem);   -- ← LƯU SẴN trạng thái hiện tại (chỉ khi NHẬN; chặn không tới đây)
  return jsonb_build_object('ok', true, 'loai', v_loai, 'ket_qua', 'nhan', 'nguoi_id', v_ns, 'buoc', v_buoc.thu_tu, 'nhanh', v_nhanh);
end $$;

-- ─────────── VIỆC 3 · tram_dang_cho: đọc THẲNG tien_do_tem (không quét tem_ban_ve, không hàm con) + phân trang ───────────
drop function if exists kho.tram_dang_cho(text);
create or replace function kho.tram_dang_cho(p_tram text, p_limit int default 50, p_offset int default 0)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_to text; v_so int; v_ds jsonb;
begin
  perform kho.tram_gac_vai();
  select coalesce(d.ma_to, t.hoat_dong) into v_to from kho.tram t left join kho.don_gia_baseline d on d.hoat_dong = t.hoat_dong where t.ma_tram = p_tram;
  if v_to is null then return jsonb_build_object('so', 0, 'ds', '[]'::jsonb); end if;
  -- đếm THẲNG từ index (cho_vao ⟹ đang sản xuất; lọc đơn để cho ds 50 dòng, không đếm-join 100k)
  select count(*) into v_so from kho.tien_do_tem td where td.to_hien_tai = v_to and td.trang_thai = 'cho_vao';
  select coalesce(jsonb_agg(j order by ra desc nulls last), '[]'::jsonb) into v_ds from (
    select td.ra_luc ra, jsonb_build_object(
      'tem', td.tem_ma,
      'tam', kho.ten_vai_tro_tam((select vai_tro from kho.tem_ban_ve where ma_tam = td.tem_ma order by phien_ban desc limit 1)),
      'mon', (select ten from kho.don_hang_mon m where m.id = td.mon_id),
      'don', td.ma_don,
      'cho_phut', case when td.ra_luc is null then null else round(extract(epoch from now()-td.ra_luc)/60)::int end) j
    from kho.tien_do_tem td join kho.don_hang dh on dh.ma_don = td.ma_don and dh.trang_thai in ('cho_cat','da_cat','dang_lam')
    where td.to_hien_tai = v_to and td.trang_thai = 'cho_vao'
    order by td.ra_luc desc nulls last limit p_limit offset p_offset) x;
  return jsonb_build_object('so', coalesce(v_so,0), 'ds', v_ds, 'limit', p_limit, 'offset', p_offset);
end $$;
grant execute on function kho.tram_dang_cho(text, int, int) to authenticated;

-- ─────────── VIỆC 4 · do_gio_that: lấy tem của món qua index (mon_id) rồi lọc sổ theo mảng tem (không join toàn bảng) ───────────
create or replace function kho.do_gio_that(p_mon uuid)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_qt text; v_hd text; v_thieu text; v_bang jsonb := '[]'::jsonb; v_so int; v_cham numeric; v_hong numeric; v_lam numeric; v_tems text[];
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','thiet_ke') then raise exception 'do_gio_that: chỉ ceo/xuong/thiet_ke'; end if;
  v_qt := kho.qt_hieu_luc(p_mon);
  if v_qt is null then raise exception 'do_gio_that: món "%" chưa có quy trình', p_mon; end if;
  v_tems := array(select distinct ma_tam from kho.tem_ban_ve where mon_id = p_mon);   -- idx_tem_mon (không join toàn bảng)
  select string_agg(d.ten, ', ') into v_thieu from kho.quy_trinh_buoc qb left join kho.don_gia_baseline d on d.hoat_dong=qb.hoat_dong
    where qb.ma_quy_trinh=v_qt and coalesce(qb.loai_buoc,'nguoi')<>'tu_chay'
      and not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
        where sq.tem_ma = any(v_tems) and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=qb.hoat_dong);
  if v_thieu is not null then raise exception 'CHUA_QUET_XONG: món còn thiếu bước: %', v_thieu; end if;
  for v_hd in select distinct qb.hoat_dong from kho.quy_trinh_buoc qb where qb.ma_quy_trinh=v_qt and coalesce(qb.loai_buoc,'nguoi')<>'tu_chay' loop
    select count(distinct sq.tem_ma) into v_so from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
      where sq.tem_ma = any(v_tems) and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=v_hd;
    select coalesce(sum(case when sq.loai='ra' then extract(epoch from coalesce(sq.ghi_bu_cho,sq.luc)) else -extract(epoch from coalesce(sq.ghi_bu_cho,sq.luc)) end),0)/3600.0,
           coalesce(sum(sq.so_hong) filter (where sq.loai='ra'),0), coalesce(sum(sq.so_lam_lai) filter (where sq.loai='ra'),0)
      into v_cham, v_hong, v_lam
      from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
      where sq.tem_ma = any(v_tems) and sq.ket_qua='nhan' and t.hoat_dong=v_hd;
    insert into kho.so_don_vi_mon(mon_id, hoat_dong, moc, so_don_vi, nguon, so_hong, so_lam_lai, nguoi_nhap)
      values (p_mon, v_hd, 'thuc_te', v_so, 'cutlist', v_hong, v_lam, kho.current_ns())
      on conflict (mon_id, hoat_dong, moc) do update set so_don_vi=excluded.so_don_vi, so_hong=excluded.so_hong, so_lam_lai=excluded.so_lam_lai, luc=now();
    v_bang := v_bang || jsonb_build_array(jsonb_build_object('hoat_dong', v_hd, 'so_don_vi', v_so,
      'gio_cham_tay', round(v_cham::numeric,4), 'so_hong', v_hong, 'so_lam_lai', v_lam));
  end loop;
  return jsonb_build_object('ok', true, 'mon_id', p_mon, 'bang', v_bang);
end $$;
grant execute on function kho.do_gio_that(uuid) to authenticated;

commit;
