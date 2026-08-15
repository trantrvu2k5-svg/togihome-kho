-- 074 — SỔ QUÉT (A2): chỗ chứa dữ liệu quét = nguồn duy nhất của mốc thuc_te. THUẦN DB. QD-18.
--   Chạy: cd web && node ops/run_sql.mjs ../db/074_so_quet.sql   (idempotent phần lớn; RLS/policy drop-if-exists)
begin;

-- tem gắn MÓN (tem_ban_ve chỉ có ma_don+vai_tro; cần mon_id để suy quy trình khi quét)
alter table kho.tem_ban_ve add column if not exists mon_id uuid references kho.don_hang_mon(id);

-- ─────────── BẢNG 1 · su_kien_quet — SỔ GHI THÊM, CẤM SỬA CẤM XOÁ ───────────
create table if not exists kho.su_kien_quet (
  id          uuid primary key default gen_random_uuid(),
  tem_ma      text not null,
  ma_tram     text not null references kho.tram(ma_tram),
  nguoi_id    uuid references kho.nguoi_dung(id),
  luc         timestamptz not null default now(),
  loai        text not null check (loai in ('vao','ra')),
  ket_qua     text not null check (ket_qua in ('nhan','chan')),
  ly_do_chan  text,
  nguon       text not null default 'quet' check (nguon in ('quet','tay')),
  ghi_bu_cho  timestamptz,                 -- ghi bù: thời điểm THẬT sự xảy ra (khác luc)
  so_hong     numeric not null default 0 check (so_hong >= 0),
  so_lam_lai  numeric not null default 0 check (so_lam_lai >= 0)
);
create index if not exists idx_sq_tem  on kho.su_kien_quet (tem_ma, luc);
create index if not exists idx_sq_tram on kho.su_kien_quet (ma_tram, luc);

-- ─────────── BẢNG 2 · ca_lam ───────────
create table if not exists kho.ca_lam (
  id        uuid primary key default gen_random_uuid(),
  nguoi_id  uuid not null references kho.nguoi_dung(id),
  ma_tram   text not null references kho.tram(ma_tram),
  bat_dau   timestamptz not null default now(),
  ket_thuc  timestamptz
);
-- một người một lúc chỉ trực MỘT trạm (trạm nhiều người thì được → không unique ma_tram)
create unique index if not exists uq_ca_nguoi_dang on kho.ca_lam (nguoi_id) where ket_thuc is null;

-- ─────────── BẢNG 3 · trang_thai_tram + ly_do_dung (MES 6.1.3) ───────────
create table if not exists kho.ly_do_dung (
  ma text primary key, nhom text, ten text not null, dang_dung boolean not null default true
);
insert into kho.ly_do_dung(ma, nhom, ten) values
  ('hong_may',   'hong',        'Hỏng máy'),
  ('het_vat_tu', 'cho_vat_tu',  'Hết vật tư'),
  ('cho_ban_ve', 'cho_vat_tu',  'Chờ bản vẽ'),
  ('thay_dao',   've_sinh',     'Thay dao'),
  ('nghi_giua_ca','nghi',       'Nghỉ giữa ca')
on conflict (ma) do nothing;

create table if not exists kho.trang_thai_tram (
  id         uuid primary key default gen_random_uuid(),
  ma_tram    text not null references kho.tram(ma_tram),
  trang_thai text not null check (trang_thai in ('chay','nghi','hong','cho_vat_tu','ve_sinh')),
  ly_do      text,
  bat_dau    timestamptz not null default now(),
  ket_thuc   timestamptz,
  nguoi_id   uuid references kho.nguoi_dung(id),
  nguon      text not null default 'nguoi' check (nguon in ('nguoi','tu_dong')),
  -- trạng thái KHÔNG phải 'chay' → bắt buộc có lý do
  constraint tt_ly_do_khi_dung check (trang_thai = 'chay' or (ly_do is not null and btrim(ly_do) <> ''))
);
create unique index if not exists uq_tt_tram_dang on kho.trang_thai_tram (ma_tram) where ket_thuc is null;

-- mầm: một trạm cho MỖI hoạt động (đã có cat/dan/pu) — để quét đủ 8 bước tủ áo
insert into kho.tram(ma_tram, ten, hoat_dong) values
  ('TRAM-CAM-01','Bàn khoan cam #1','cam'), ('TRAM-THUNG-01','Bàn lắp thùng #1','thung'),
  ('TRAM-CUP-01','Bàn khoan cup #1','cup'), ('TRAM-RAY-01','Bàn lắp ray #1','ray'),
  ('TRAM-CANH-01','Bàn lắp cánh #1','canh'), ('TRAM-GOI-01','Bàn đóng gói #1','goi'),
  ('TRAM-LOT-01','Buồng chà lót #1','lot'), ('TRAM-SONCANH-01','Bàn sơn cạnh #1','son_canh')
on conflict (ma_tram) do nothing;

-- ─────────── RLS: mọi vai INSERT · KHÔNG AI UPDATE/DELETE (kể cả ceo) ───────────
alter table kho.su_kien_quet enable row level security;
alter table kho.su_kien_quet force  row level security;
drop policy if exists sq_insert on kho.su_kien_quet;
drop policy if exists sq_select on kho.su_kien_quet;
create policy sq_insert on kho.su_kien_quet for insert to authenticated with check (kho.current_vai_tro() is not null);
create policy sq_select on kho.su_kien_quet for select to authenticated using (kho.current_vai_tro() is not null);
grant select, insert on kho.su_kien_quet to authenticated;   -- KHÔNG grant update/delete
grant select, insert, update on kho.ca_lam, kho.trang_thai_tram to authenticated;
grant select on kho.ly_do_dung, kho.tram to authenticated;

-- ─────────── helper nội bộ ───────────
create or replace function kho.sq_tem_mon(p_tem text) returns uuid
  language sql stable security definer set search_path = kho as $$
  select mon_id from kho.tem_ban_ve where ma_tam = p_tem order by phien_ban desc limit 1;
$$;
create or replace function kho.sq_tram_trang_thai(p_tram text) returns text
  language sql stable security definer set search_path = kho as $$
  select trang_thai from kho.trang_thai_tram where ma_tram = p_tram and ket_thuc is null order by bat_dau desc limit 1;
$$;
-- luc HIỆU LỰC (ghi bù dùng thời điểm thật)
create or replace function kho.sq_luc(s kho.su_kien_quet) returns timestamptz
  language sql immutable as $$ select coalesce(s.ghi_bu_cho, s.luc); $$;

-- ─────────── lõi ghi 1 sự kiện + gác a–f (dùng chung quét & ghi bù) ───────────
--   TRẢ VỀ (KHÔNG raise) khi chặn → INSERT ket_qua='chan' RỒI return {ok:false,loi,...}.
--   Vì sao không raise: raise ROLLBACK cả INSERT của chính nó → sổ mất dòng chan. Phải return để dòng chan CÒN.
create or replace function kho.sq_ghi(p_tem text, p_tram text, p_loai_ep text, p_nguon text,
                                      p_ghi_bu_cho timestamptz, p_ly_do text, p_so_hong numeric, p_so_lam_lai numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_mon uuid; v_qt text; v_ns uuid; v_tt text; v_loai text; v_buoc record; v_thieu text; p int; v_pre_hd text; v_msg text;
begin
  select nguoi_id into v_ns from kho.ca_lam where ma_tram = p_tram and ket_thuc is null order by bat_dau limit 1;
  v_loai := coalesce(p_loai_ep, 'vao');
  -- a. tem tồn tại?
  if not exists (select 1 from kho.tem_ban_ve where ma_tam = p_tem) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TEM_LA', 'tem không có trong hệ thống'); end if;
  -- b. trạm đang dùng?
  if not exists (select 1 from kho.tram where ma_tram = p_tram and dang_dung) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_TAT', 'trạm không dùng được'); end if;
  -- xác định loai (tem+trạm hợp lệ): đã 'vao' chưa 'ra' ở trạm này → lần này là 'ra'
  v_loai := coalesce(p_loai_ep,
    case when (select count(*) filter (where loai='vao') - count(*) filter (where loai='ra')
               from kho.su_kien_quet where tem_ma=p_tem and ma_tram=p_tram and ket_qua='nhan') > 0 then 'ra' else 'vao' end);
  -- c. có ai trực?
  if v_ns is null then
    return kho.sq_chan(p_tem, p_tram, null, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_CO_CA', 'chưa ai mở ca ở trạm này'); end if;
  -- d. trạm đang 'chay'?
  v_tt := coalesce(kho.sq_tram_trang_thai(p_tram), 'chay');
  if v_tt <> 'chay' then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_KHONG_CHAY', 'trạm đang "'||v_tt||'", không chạy'); end if;
  -- e. món của tem có quy trình?
  v_mon := kho.sq_tem_mon(p_tem);
  v_qt  := case when v_mon is null then null else kho.qt_hieu_luc(v_mon) end;
  if v_qt is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_QUY_TRINH', 'sản phẩm này chưa có quy trình sản xuất'); end if;
  -- bước hiện tại = bước của quy trình có hoạt động = hoạt động của trạm
  select b.thu_tu, b.buoc_truoc into v_buoc
    from kho.quy_trinh_buoc b join kho.tram t on t.ma_tram = p_tram
    where b.ma_quy_trinh = v_qt and b.hoat_dong = t.hoat_dong limit 1;
  if v_buoc.thu_tu is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'SAI_TRAM', 'quy trình không có bước cho trạm này'); end if;
  -- f. MỌI bước trong buoc_truoc đã có 'ra' chưa (ĐỌC buoc_truoc, CẤM suy thu_tu-1 — QD-01)
  v_thieu := null;
  foreach p in array coalesce(v_buoc.buoc_truoc, array[]::int[]) loop
    select b.hoat_dong into v_pre_hd from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt and b.thu_tu = p;
    if not exists (
      select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
      where sq.tem_ma = p_tem and sq.loai = 'ra' and sq.ket_qua = 'nhan' and t.hoat_dong = v_pre_hd) then
      v_thieu := concat_ws(', ', v_thieu, (select ten from kho.don_gia_baseline where hoat_dong = v_pre_hd));
    end if;
  end loop;
  if v_thieu is not null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'NHAY_BUOC', 'tấm này chưa qua ' || v_thieu); end if;

  -- ĐỦ guard → ghi NHẬN
  insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,nguon,ghi_bu_cho,ly_do_chan,so_hong,so_lam_lai)
    values (p_tem, p_tram, v_ns, v_loai, 'nhan', p_nguon, p_ghi_bu_cho, case when p_nguon='tay' then p_ly_do else null end,
            coalesce(p_so_hong,0), coalesce(p_so_lam_lai,0));
  return jsonb_build_object('ok', true, 'loai', v_loai, 'ket_qua', 'nhan', 'nguoi_id', v_ns, 'buoc', v_buoc.thu_tu);
end $$;

-- ghi 1 dòng chan rồi TRẢ VỀ (không raise) — để dòng chan CÒN trong sổ
create or replace function kho.sq_chan(p_tem text, p_tram text, p_ns uuid, p_loai text, p_nguon text,
                                       p_gbc timestamptz, p_loi text, p_ly_do text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,ly_do_chan,nguon,ghi_bu_cho)
    values (p_tem, p_tram, p_ns, p_loai, 'chan', p_ly_do, p_nguon, p_gbc);
  return jsonb_build_object('ok', false, 'ket_qua', 'chan', 'loi', p_loi, 'ly_do', p_ly_do, 'loai', p_loai);
end $$;

-- ─────────── RPC quet_tem ───────────
create or replace function kho.quet_tem(p_tem text, p_tram text, p_so_hong numeric default 0, p_so_lam_lai numeric default 0)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  return kho.sq_ghi(p_tem, p_tram, null, 'quet', null, null, p_so_hong, p_so_lam_lai);
end $$;
grant execute on function kho.quet_tem(text, text, numeric, numeric) to authenticated;

-- ─────────── RPC ghi_bu (chỉ xuong/ceo; qua đủ guard a–f, không phá thứ tự bước) ───────────
create or replace function kho.ghi_bu(p_tem text, p_tram text, p_loai text, p_luc_that timestamptz, p_ly_do text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('xuong','ceo') then raise exception 'ghi_bu: chỉ xuong/ceo'; end if;
  if p_loai not in ('vao','ra') then raise exception 'ghi_bu: loại phải vao/ra'; end if;
  if p_luc_that is null then raise exception 'ghi_bu: cần thời điểm thật'; end if;
  return kho.sq_ghi(p_tem, p_tram, p_loai, 'tay', p_luc_that, p_ly_do, 0, 0);
end $$;
grant execute on function kho.ghi_bu(text, text, text, timestamptz, text) to authenticated;

-- ─────────── RPC tien_do_tam — SUY từ su_kien_quet ───────────
create or replace function kho.tien_do_tam(p_tem text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_mon uuid; v_qt text; v_tong int; v_xong int; r record; v_ke int; v_ke_ten text; v_cur int; v_cur_ten text;
  v_cham numeric := 0; v_first timestamptz; v_last timestamptz;
begin
  if coalesce(kho.current_vai_tro(),'') = '' then raise exception 'tien_do: chưa đăng nhập'; end if;
  v_mon := kho.sq_tem_mon(p_tem);
  v_qt  := case when v_mon is null then null else kho.qt_hieu_luc(v_mon) end;
  if v_qt is null then raise exception 'tien_do: tem "%" chưa gắn quy trình', p_tem; end if;
  select count(*) into v_tong from kho.quy_trinh_buoc where ma_quy_trinh = v_qt and coalesce(loai_buoc,'nguoi') <> 'tu_chay';
  -- bước đã XONG = có 'ra' nhận ở trạm của hoạt động bước đó
  select count(*) into v_xong from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt and coalesce(b.loai_buoc,'nguoi')<>'tu_chay'
    and exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
                where sq.tem_ma=p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=b.hoat_dong);
  -- giờ chạm tay = tổng (ra − vào) mọi lượt nhận; mốc thời gian = coalesce(ghi_bu_cho,luc)
  select coalesce(sum(case when loai='ra' then extract(epoch from coalesce(ghi_bu_cho,luc)) else -extract(epoch from coalesce(ghi_bu_cho,luc)) end),0)/3600.0,
         min(coalesce(ghi_bu_cho,luc)), max(coalesce(ghi_bu_cho,luc))
    into v_cham, v_first, v_last from kho.su_kien_quet where tem_ma=p_tem and ket_qua='nhan';
  -- bước hiện tại = bước đang 'vao' chưa 'ra'; nếu không có, bước 'ra' gần nhất
  select b.thu_tu, d.ten into v_cur, v_cur_ten from kho.quy_trinh_buoc b join kho.tram t on t.hoat_dong=b.hoat_dong
    join kho.su_kien_quet sq on sq.ma_tram=t.ma_tram and sq.tem_ma=p_tem and sq.ket_qua='nhan'
    left join kho.don_gia_baseline d on d.hoat_dong=b.hoat_dong
    where b.ma_quy_trinh=v_qt group by b.thu_tu, d.ten
    having count(*) filter (where sq.loai='vao') > count(*) filter (where sq.loai='ra') order by b.thu_tu desc limit 1;
  -- bước kế tiếp = bước chưa xong mà mọi buoc_truoc đã xong
  select b.thu_tu, d.ten into v_ke, v_ke_ten from kho.quy_trinh_buoc b left join kho.don_gia_baseline d on d.hoat_dong=b.hoat_dong
    where b.ma_quy_trinh=v_qt and coalesce(b.loai_buoc,'nguoi')<>'tu_chay'
      and not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
                      where sq.tem_ma=p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=b.hoat_dong)
      and (select bool_and(exists (select 1 from kho.su_kien_quet sq2 join kho.tram t2 on t2.ma_tram=sq2.ma_tram
             join kho.quy_trinh_buoc pb on pb.ma_quy_trinh=v_qt and pb.thu_tu=pr
             where sq2.tem_ma=p_tem and sq2.loai='ra' and sq2.ket_qua='nhan' and t2.hoat_dong=pb.hoat_dong))
           from unnest(coalesce(b.buoc_truoc,array[]::int[])) pr)
    order by b.thu_tu limit 1;
  return jsonb_build_object(
    'tem', p_tem, 'buoc_hien_tai', v_cur, 'ten_buoc_hien_tai', v_cur_ten,
    'buoc_ke_tiep', v_ke, 'ten_buoc_ke_tiep', v_ke_ten,
    'xong', v_xong, 'tong_buoc', v_tong,
    'dung_yen_phut', case when v_last is null then null else round((extract(epoch from now()-v_last)/60)::numeric,1) end,
    'gio_cham_tay', round(v_cham::numeric, 4),
    'gio_troi_qua', case when v_first is null then 0 else round((extract(epoch from coalesce(v_last,v_first)-v_first)/3600)::numeric, 4) end);
end $$;
grant execute on function kho.tien_do_tam(text) to authenticated;

-- ─────────── RPC do_gio_that — nối quét sang mốc thuc_te ───────────
create or replace function kho.do_gio_that(p_mon uuid)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_qt text; v_hd text; v_thieu text; v_bang jsonb := '[]'::jsonb; v_so int; v_cham numeric; v_hong numeric; v_lam numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','thiet_ke') then raise exception 'do_gio_that: chỉ ceo/xuong/thiet_ke'; end if;
  v_qt := kho.qt_hieu_luc(p_mon);
  if v_qt is null then raise exception 'do_gio_that: món "%" chưa có quy trình', p_mon; end if;
  -- chưa quét xong MỌI bước người → CHẶN, KHÔNG ghi dở dang
  select string_agg(d.ten, ', ') into v_thieu from kho.quy_trinh_buoc qb left join kho.don_gia_baseline d on d.hoat_dong=qb.hoat_dong
    where qb.ma_quy_trinh=v_qt and coalesce(qb.loai_buoc,'nguoi')<>'tu_chay'
      and not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
        join kho.tem_ban_ve tb on tb.ma_tam=sq.tem_ma and tb.mon_id=p_mon
        where sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=qb.hoat_dong);
  if v_thieu is not null then raise exception 'CHUA_QUET_XONG: món còn thiếu bước: %', v_thieu; end if;
  -- mỗi hoạt động người: số đơn vị thật + giờ chạm tay + hỏng/làm lại → ghi thuc_te
  for v_hd in select distinct qb.hoat_dong from kho.quy_trinh_buoc qb where qb.ma_quy_trinh=v_qt and coalesce(qb.loai_buoc,'nguoi')<>'tu_chay' loop
    select count(distinct sq.tem_ma) into v_so from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
      join kho.tem_ban_ve tb on tb.ma_tam=sq.tem_ma and tb.mon_id=p_mon
      where sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=v_hd;
    select coalesce(sum(case when sq.loai='ra' then extract(epoch from coalesce(sq.ghi_bu_cho,sq.luc)) else -extract(epoch from coalesce(sq.ghi_bu_cho,sq.luc)) end),0)/3600.0,
           coalesce(sum(sq.so_hong) filter (where sq.loai='ra'),0), coalesce(sum(sq.so_lam_lai) filter (where sq.loai='ra'),0)
      into v_cham, v_hong, v_lam
      from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
      join kho.tem_ban_ve tb on tb.ma_tam=sq.tem_ma and tb.mon_id=p_mon
      where sq.ket_qua='nhan' and t.hoat_dong=v_hd;
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
