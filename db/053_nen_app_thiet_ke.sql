-- 053 — NỀN DỮ LIỆU APP THIẾT KẾ (BƯỚC 1). CHƯA dựng app/màn — chỉ bảng + RPC + hàm thành tích.
--   HAI VAI TÁCH BẠCH khắp nơi:
--     • THIẾT KẾ SẢN XUẤT = vai 'thiet_ke'    — dựng file cắt, ĐẨY TEM, đẩy giá vốn (loai_gio='xuong')
--     • THIẾT KẾ BÁN HÀNG = vai 'tk_ban_hang'  — dựng 3D cho khách xem, GỬI BẢN     (loai_gio='ban_hang')
--   Chỉ số "sale trả về vì hiểu sai" ĐỌC TỪ db/051 (ban_thiet_ke.trang_thai='chua_dung_yeu_cau') — KHÔNG dựng lại.
--   node ops/run_sql.mjs ../db/053_nen_app_thiet_ke.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.nguyen_nhan_sua(text); drop function if exists kho.tt_thiet_ke_ban_hang(text);
--   drop function if exists kho.tt_thiet_ke_xuong(text); drop function if exists kho.gio_uoc_cap(text);
--   drop function if exists kho.ghi_gio_thiet_ke(text,numeric); drop function if exists kho.nhan_viec_thiet_ke(text);
--   drop trigger if exists trg_loi_gan_thiet_ke on kho.loi_lam_lai; drop function if exists kho.loi_gan_thiet_ke();
--   drop table if exists kho.dung_lai_ban;
--   alter table kho.don_hang_mon drop column if exists ma_sp_goc; alter table kho.don_hang_mon drop column if exists mo_ta_sua;
--   alter table kho.loi_lam_lai drop column if exists do_file; alter table kho.loi_lam_lai drop column if exists ma_ns_thiet_ke;
--   alter table kho.don_hang drop column if exists ma_ns_thiet_ke; alter table kho.don_hang drop column if exists luc_nhan_thiet_ke;
--   alter table kho.don_hang drop column if exists buoc_thiet_ke;
--   drop function if exists kho.current_ns();
--   -- gui_ban_thiet_ke / phan_hoi_ban / day_tem_ban_ve: khôi phục bản db/051 (xem git).
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- helper: nguoi_dung.id của NGƯỜI ĐANG GỌI (chưa có sẵn trong hệ)
create or replace function kho.current_ns() returns uuid language sql stable security definer set search_path = kho as $$
  select id from kho.nguoi_dung where auth_uid = auth.uid() limit 1 $$;

-- ════════ 1. CHIA VIỆC ════════
alter table kho.don_hang add column if not exists ma_ns_thiet_ke   uuid references kho.nguoi_dung(id);
alter table kho.don_hang add column if not exists luc_nhan_thiet_ke timestamptz;
-- 5 BƯỚC KANBAN thiết kế — TÁCH khỏi trang_thai đơn. NULL = chưa vào luồng thiết kế.
alter table kho.don_hang add column if not exists buoc_thiet_ke text
  check (buoc_thiet_ke in ('cho_nhan','dang_dung','cho_duyet','sua_gop_y','xong_file'));

-- NHẬN VIỆC: khoá tên người cầm. Đã có người → CHẶN (báo ai cầm). Tối đa 5 đơn đang cầm/người.
create or replace function kho.nhan_viec_thiet_ke(p_ma_don text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_don kho.don_hang; v_dang int; v_ten text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'nhan_viec_thiet_ke: chỉ ceo / thiết kế sản xuất / thiết kế bán hàng'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'nhan_viec_thiet_ke: không có đơn "%"', p_ma_don; end if;
  if v_don.ma_ns_thiet_ke is not null then
    select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
    raise exception 'nhan_viec_thiet_ke: đơn "%" đang do % cầm', p_ma_don, coalesce(v_ten,'người khác'); end if;
  v_ns := kho.current_ns();
  select count(*) into v_dang from kho.don_hang
    where ma_ns_thiet_ke = v_ns and coalesce(buoc_thiet_ke,'') <> 'xong_file';
  if v_dang >= 5 then
    raise exception 'nhan_viec_thiet_ke: bạn đang cầm % đơn (tối đa 5) — xong bớt rồi nhận thêm', v_dang; end if;
  update kho.don_hang
     set ma_ns_thiet_ke = v_ns, luc_nhan_thiet_ke = now(), buoc_thiet_ke = 'dang_dung',
         trang_thai = case when trang_thai in ('moi_len_don','bao_gia','bao_gia_treo') then 'nhan_thiet_ke' else trang_thai end
   where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'buoc', 'dang_dung');
end $$;
grant execute on function kho.nhan_viec_thiet_ke(text) to authenticated;

-- ════════ 3. GHI GIỜ THIẾT KẾ (từ web) — loai_gio SUY TỪ VAI, không tham số cứng ════════
create or replace function kho.ghi_gio_thiet_ke(p_ma_don text, p_so_gio numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text; v_loai text; v_ns uuid; v_cap text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('thiet_ke','tk_ban_hang') then
    raise exception 'ghi_gio_thiet_ke: chỉ thiết kế sản xuất (thiet_ke) / thiết kế bán hàng (tk_ban_hang)'; end if;
  if p_so_gio is null or p_so_gio < 0 then raise exception 'ghi_gio_thiet_ke: số giờ không hợp lệ'; end if;
  if not exists (select 1 from kho.don_hang where ma_don = p_ma_don) then
    raise exception 'ghi_gio_thiet_ke: không có đơn "%"', p_ma_don; end if;
  -- thiet_ke (SẢN XUẤT) -> 'xuong' · tk_ban_hang (BÁN HÀNG) -> 'ban_hang'
  v_loai := case v_vai when 'thiet_ke' then 'xuong' when 'tk_ban_hang' then 'ban_hang' end;
  v_ns := kho.current_ns();
  select cap_thiet_ke into v_cap from kho.don_hang where ma_don = p_ma_don;
  insert into kho.gio_thiet_ke_thuc(ma_don, ma_ns, loai_gio, gio_thuc, cap)
    values (p_ma_don, v_ns, v_loai, p_so_gio, v_cap);
  return jsonb_build_object('ok', true, 'loai_gio', v_loai, 'gio', p_so_gio);
end $$;
grant execute on function kho.ghi_gio_thiet_ke(text,numeric) to authenticated;

-- ════════ 4. LỖI DO FILE THIẾT KẾ ════════
alter table kho.loi_lam_lai add column if not exists do_file boolean not null default false;
alter table kho.loi_lam_lai add column if not exists ma_ns_thiet_ke uuid references kho.nguoi_dung(id);
-- do_file=true -> TỰ lấy ma_ns_thiet_ke của đơn (không bắt thợ gõ). do_file=false -> null.
create or replace function kho.loi_gan_thiet_ke() returns trigger language plpgsql security definer set search_path = kho as $$
begin
  if new.do_file then
    select ma_ns_thiet_ke into new.ma_ns_thiet_ke from kho.don_hang where ma_don = new.ma_don;
  else
    new.ma_ns_thiet_ke := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_loi_gan_thiet_ke on kho.loi_lam_lai;
create trigger trg_loi_gan_thiet_ke before insert or update of do_file, ma_don on kho.loi_lam_lai
  for each row execute function kho.loi_gan_thiet_ke();

-- ════════ 7. NỀN THƯ VIỆN (chỉ bảng — màn ở lô sau) ════════
alter table kho.don_hang_mon add column if not exists ma_sp_goc text references kho.san_pham_mau(ma);
alter table kho.don_hang_mon add column if not exists mo_ta_sua text;
create table if not exists kho.dung_lai_ban (
  id         uuid primary key default gen_random_uuid(),
  mon_id_goc uuid references kho.don_hang_mon(id) on delete set null,
  mon_id_moi uuid not null references kho.don_hang_mon(id) on delete cascade,
  sua_gi     text,
  luc        timestamptz not null default now()
);
alter table kho.dung_lai_ban enable row level security;
drop policy if exists dlb_doc on kho.dung_lai_ban;
create policy dlb_doc on kho.dung_lai_ban for select using (
  kho.current_vai_tro() = any (array['ceo','thiet_ke','tk_ban_hang','kho','xuong']));

-- ════════ Giờ ƯỚC theo CẤP (chuẩn hoá khối lượng) — [GIẢ ĐỊNH] bám tiền lệ sale (có sẵn 0,3h / dựng mới 3h) ════════
create or replace function kho.gio_uoc_cap(p_cap text) returns numeric language sql immutable as $$
  select case p_cap
    when 'full_can'         then 5.0
    when 'thiet_ke_rieng'   then 3.0
    when 'co_mon_dung_moi'  then 3.0
    when 'co_file_san'      then 0.3
    when 'toan_mon_co_san'  then 0.3
    when 'cat_lai'          then 0.3
    when 'bao_hanh'         then 0.3
    else 1.0 end $$;

-- ════════ 5a. THÀNH TÍCH THIẾT KẾ SẢN XUẤT ════════
--   RLS: thiet_ke thấy số CHÍNH MÌNH · ceo thấy hết. Thiếu giờ -> uoc_lech NULL, ba chỉ số kia VẪN chạy.
create or replace function kho.tt_thiet_ke_xuong(p_ma_ky text)
  returns table(ma_ns uuid, ho_ten text, viec_xong_chuan_hoa numeric, file_dung_lan_dau_pct numeric,
                loi_do_file_bat integer, uoc_lech_gio_tb numeric, so_don_can_cu integer,
                du_tin boolean, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text; v_me uuid;
begin
  v_vai := coalesce(kho.current_vai_tro(),''); v_me := kho.current_ns();
  if v_vai not in ('ceo','thiet_ke') then
    raise exception 'tt_thiet_ke_xuong: chỉ ceo hoặc thiết kế sản xuất'; end if;
  return query
  with base as (   -- đơn của THIẾT KẾ SẢN XUẤT (vai thiet_ke), trong kỳ, KHÔNG demo; lọc RLS
    select d.ma_don, d.cap_thiet_ke, d.buoc_thiet_ke, n.id ns, n.ho_ten
    from kho.don_hang d
    join kho.nguoi_dung n on n.id = d.ma_ns_thiet_ke and n.vai_tro = 'thiet_ke'
    where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
      and (v_vai = 'ceo' or d.ma_ns_thiet_ke = v_me)
  )
  select b.ns, b.ho_ten,
    coalesce(sum(kho.gio_uoc_cap(b.cap_thiet_ke)) filter (where b.buoc_thiet_ke = 'xong_file'), 0)::numeric,
    -- file đúng lần đầu = % đơn (có tem) chỉ 1 phiên bản
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where mx = 1) / count(*), 1) end
       from (select t.ma_don, max(t.phien_ban) mx from kho.tem_ban_ve t
             where t.ma_don in (select ma_don from base bb where bb.ns = b.ns) group by t.ma_don) s),
    (select count(*)::int from kho.loi_lam_lai l
       where l.do_file and l.ma_ns_thiet_ke = b.ns and l.ma_don in (select ma_don from base b2 where b2.ns = b.ns)),
    -- ước lệch = avg(giờ thực xuong - giờ ước); đơn KHÔNG ghi giờ -> loại khỏi avg; không đơn nào ghi -> NULL
    (select round(avg(gt.gio - kho.gio_uoc_cap(bb.cap_thiet_ke)), 2)
       from base bb
       join lateral (select sum(g.gio_thuc) gio from kho.gio_thiet_ke_thuc g
                     where g.ma_don = bb.ma_don and g.loai_gio = 'xuong') gt on true
       where bb.ns = b.ns and gt.gio is not null),
    count(*) filter (where b.buoc_thiet_ke = 'xong_file')::int,
    count(*) filter (where b.buoc_thiet_ke = 'xong_file') >= 5,
    case when count(*) filter (where b.buoc_thiet_ke = 'xong_file') < 5
         then 'Chưa đủ đơn để tin (' || count(*) filter (where b.buoc_thiet_ke = 'xong_file') || '/5)' else null end
  from base b group by b.ns, b.ho_ten;
end $$;
grant execute on function kho.tt_thiet_ke_xuong(text) to authenticated;

-- ════════ 5b. THÀNH TÍCH THIẾT KẾ BÁN HÀNG ════════
create or replace function kho.tt_thiet_ke_ban_hang(p_ma_ky text)
  returns table(ma_ns uuid, ho_ten text, ra_phuong_an_dau_gio numeric, sale_tra_ve_hieu_sai integer,
                viec_xong_chuan_hoa numeric, ty_le_khach_chot numeric, so_don_can_cu integer,
                du_tin boolean, canh_bao text, xep_hang_ty_le text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text; v_me uuid;
begin
  v_vai := coalesce(kho.current_vai_tro(),''); v_me := kho.current_ns();
  if v_vai not in ('ceo','tk_ban_hang') then
    raise exception 'tt_thiet_ke_ban_hang: chỉ ceo hoặc thiết kế bán hàng'; end if;
  return query
  with base as (   -- đơn của THIẾT KẾ BÁN HÀNG (vai tk_ban_hang), trong kỳ, KHÔNG demo; lọc RLS
    select d.ma_don, d.cap_thiet_ke, d.buoc_thiet_ke, d.luc_nhan_thiet_ke, n.id ns, n.ho_ten
    from kho.don_hang d
    join kho.nguoi_dung n on n.id = d.ma_ns_thiet_ke and n.vai_tro = 'tk_ban_hang'
    where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
      and (v_vai = 'ceo' or d.ma_ns_thiet_ke = v_me)
  )
  select b.ns, b.ho_ten,
    -- ra phương án đầu = avg(GIỜ) từ luc_nhan_thiet_ke tới bản đầu (min luc_gui); đơn thiếu mốc -> loại
    (select round(avg(extract(epoch from (fg.luc - bb.luc_nhan_thiet_ke)) / 3600.0), 2)
       from base bb
       join lateral (select min(x.luc_gui) luc from kho.ban_thiet_ke x where x.ma_don = bb.ma_don) fg on true
       where bb.ns = b.ns and bb.luc_nhan_thiet_ke is not null and fg.luc is not null),
    -- sale trả về vì hiểu sai = ĐỌC db/051 trang_thai='chua_dung_yeu_cau' (KHÔNG dựng lại cơ chế)
    (select count(*)::int from kho.ban_thiet_ke bt
       where bt.trang_thai = 'chua_dung_yeu_cau' and bt.ma_don in (select ma_don from base b2 where b2.ns = b.ns)),
    coalesce(sum(kho.gio_uoc_cap(b.cap_thiet_ke)) filter (where b.buoc_thiet_ke = 'xong_file'), 0)::numeric,
    -- tỷ lệ khách chốt = % đơn có bản khách duyệt
    (select round(100.0 * count(distinct case when exists(select 1 from kho.ban_thiet_ke bt2
             where bt2.ma_don = bb.ma_don and bt2.trang_thai = 'khach_duyet') then bb.ma_don end)
          / nullif(count(distinct bb.ma_don),0), 1) from base bb where bb.ns = b.ns),
    count(distinct b.ma_don)::int,
    count(distinct b.ma_don) >= 5,
    case when count(distinct b.ma_don) < 5 then 'Chưa đủ đơn để tin (' || count(distinct b.ma_don) || '/5)' else null end,
    'KHONG_XEP_HANG'   -- tỷ lệ khách chốt: trả SỐ nhưng KHÔNG xếp hạng (phụ thuộc khách, không do thiết kế)
  from base b group by b.ns, b.ho_ten;
end $$;
grant execute on function kho.tt_thiet_ke_ban_hang(text) to authenticated;

-- ════════ 6. NGUYÊN NHÂN SỬA (đếm theo ban_thiet_ke.trang_thai) — LOẠI demo ════════
create or replace function kho.nguyen_nhan_sua(p_ma_ky text)
  returns table(trang_thai text, so_lan integer) language plpgsql stable security definer set search_path = kho as $$
declare v_vai text; v_me uuid;
begin
  v_vai := coalesce(kho.current_vai_tro(),''); v_me := kho.current_ns();
  if v_vai not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'nguyen_nhan_sua: chỉ ceo / thiết kế sản xuất / thiết kế bán hàng'; end if;
  return query
  select bt.trang_thai, count(*)::int
  from kho.ban_thiet_ke bt
  join kho.don_hang d on d.ma_don = bt.ma_don
  where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
    and (v_vai = 'ceo' or d.ma_ns_thiet_ke = v_me)
  group by bt.trang_thai order by count(*) desc;
end $$;
grant execute on function kho.nguyen_nhan_sua(text) to authenticated;

-- ════════ 2. KANBAN tự chuyển bước + Q2 CHỐT đẩy tem — sửa 3 RPC db/051 ════════

-- gui_ban_thiet_ke: sau khi gửi bản -> buoc_thiet_ke = 'cho_duyet'
create or replace function kho.gui_ban_thiet_ke(p_ma_don text, p_ghi_chu text, p_anh jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_pb integer; v_ban uuid; a jsonb; i int := 0;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'gui_ban_thiet_ke: chỉ ceo / thiết kế sản xuất / thiết kế bán hàng'; end if;
  if not exists (select 1 from kho.don_hang where ma_don = p_ma_don) then
    raise exception 'gui_ban_thiet_ke: không có đơn "%"', p_ma_don; end if;
  if p_anh is null or jsonb_typeof(p_anh) <> 'array' or jsonb_array_length(p_anh) = 0 then
    raise exception 'gui_ban_thiet_ke: phải có ít nhất 1 ảnh'; end if;
  select id into v_ns from kho.nguoi_dung where auth_uid = auth.uid();
  select coalesce(max(phien_ban),0)+1 into v_pb from kho.ban_thiet_ke where ma_don = p_ma_don;
  insert into kho.ban_thiet_ke(ma_don, phien_ban, ma_ns_gui, ghi_chu, trang_thai)
    values (p_ma_don, v_pb, v_ns, p_ghi_chu, 'cho_duyet') returning id into v_ban;
  for a in select * from jsonb_array_elements(p_anh) loop
    insert into kho.anh_ban_thiet_ke(ban_id, duong_dan_nho, duong_dan_to, byte_nho, byte_to, thu_tu)
      values (v_ban, a->>'duong_dan_nho', a->>'duong_dan_to',
              (a->>'byte_nho')::bigint, (a->>'byte_to')::bigint, coalesce((a->>'thu_tu')::int, i));
    i := i + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'cho_duyet' where ma_don = p_ma_don;   -- [KANBAN] tự sang chờ duyệt
  return jsonb_build_object('ok', true, 'ban_id', v_ban, 'phien_ban', v_pb, 'so_anh', jsonb_array_length(p_anh));
end $$;
grant execute on function kho.gui_ban_thiet_ke(text,text,jsonb) to authenticated;

-- phan_hoi_ban: sale trả về (≠ khach_duyet) -> buoc_thiet_ke = 'sua_gop_y'
create or replace function kho.phan_hoi_ban(p_ban_id uuid, p_ket_qua text, p_ghi_chu text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_ma_don text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','sale','tk_ban_hang') then
    raise exception 'phan_hoi_ban: chỉ ceo/sale/tk_ban_hang'; end if;
  if p_ket_qua not in ('khach_duyet','khach_doi_y','chua_dung_yeu_cau') then
    raise exception 'phan_hoi_ban: kết quả không hợp lệ (%)', p_ket_qua; end if;
  if p_ket_qua in ('khach_doi_y','chua_dung_yeu_cau') and coalesce(btrim(p_ghi_chu),'') = '' then
    raise exception 'phan_hoi_ban: "%" bắt buộc có ghi chú (vì sao)', p_ket_qua; end if;
  select id into v_ns from kho.nguoi_dung where auth_uid = auth.uid();
  update kho.ban_thiet_ke
     set trang_thai = p_ket_qua, ma_ns_phan_hoi = v_ns, luc_phan_hoi = now(), ghi_chu_phan_hoi = p_ghi_chu
   where id = p_ban_id returning ma_don into v_ma_don;
  if not found then raise exception 'phan_hoi_ban: không có bản %', p_ban_id; end if;
  -- [KANBAN] BẤT KỲ phản hồi KHÁC 'khach_duyet' -> quay lại sửa góp ý. CẢ 'khach_doi_y' LẪN 'chua_dung_yeu_cau'
  --   đều chuyển bước như nhau; KHÁC NHAU ở CHỖ ĐẾM chỉ số (chỉ 'chua_dung_yeu_cau' = "sale trả về vì hiểu sai").
  if p_ket_qua <> 'khach_duyet' then
    update kho.don_hang set buoc_thiet_ke = 'sua_gop_y' where ma_don = v_ma_don;
  end if;
  return jsonb_build_object('ok', true, 'ban_id', p_ban_id, 'trang_thai', p_ket_qua);
end $$;
grant execute on function kho.phan_hoi_ban(uuid,text,text) to authenticated;

-- day_tem_ban_ve: + CHỐT Q2 (chỉ THIẾT KẾ SẢN XUẤT + đúng người cầm) + buoc_thiet_ke='xong_file'
create or replace function kho.day_tem_ban_ve(p_ma_don text, p_tam jsonb)
 returns jsonb language plpgsql security definer set search_path to 'kho'
as $function$
declare v_pb integer; t jsonb; v_bac boolean := false; v_don kho.don_hang; v_le_mau_san boolean; v_vai text; v_ten text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  -- ĐẨY TEM = XUẤT FILE CẮT = việc THIẾT KẾ SẢN XUẤT. Thiết kế BÁN HÀNG không xuất file cắt.
  if v_vai = 'tk_ban_hang' then
    raise exception 'day_tem_ban_ve: thiết kế bán hàng không xuất file cắt (chỉ dựng 3D cho khách)';
  end if;
  if v_vai not in ('ceo','kho','thiet_ke') then
    raise exception 'day_tem_ban_ve: chỉ ceo/kho/thiết kế sản xuất';
  end if;
  select * into v_don from kho.don_hang d where d.ma_don = p_ma_don;
  if v_don.ma_don is null then
    raise exception 'day_tem_ban_ve: không có đơn "%"', p_ma_don;
  end if;

  -- [CHỐT Q2 — QUY ĐÚNG NGƯỜI] chỉ NGƯỜI CẦM đơn (ma_ns_thiet_ke) mới đẩy tem, để "file đúng lần đầu" quy
  --   đúng người. ceo/kho bỏ qua chốt này (đẩy hộ). thiet_ke khác / đơn chưa ai nhận -> CHẶN.
  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then
      raise exception 'day_tem_ban_ve: đơn "%" CHƯA AI NHẬN việc thiết kế — nhận việc trước khi đẩy tem', p_ma_don;
    end if;
    if v_don.ma_ns_thiet_ke <> kho.current_ns() then
      select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
      raise exception 'day_tem_ban_ve: đơn "%" đang do % cầm — chỉ người cầm mới đẩy tem', p_ma_don, coalesce(v_ten,'người khác');
    end if;
  end if;

  -- [CỔNG KHOÁ CẮT] — không cắt ván khi khách chưa duyệt bản thiết kế (trừ đơn le mẫu sẵn).
  v_le_mau_san := (v_don.dong = 'le'
                   and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau_san
     and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'day_tem_ban_ve: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT — chưa được cắt ván.', p_ma_don;
  end if;

  select coalesce(max(phien_ban),0)+1 into v_pb from kho.tem_ban_ve where ma_don = p_ma_don;
  for t in select * from jsonb_array_elements(p_tam) loop
    insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,duong_dan_svg)
      values(p_ma_don, v_pb, t->>'ma_tam', t->>'vai_tro',
             (t->>'dai')::numeric, (t->>'rong')::numeric, (t->>'day')::numeric,
             coalesce(t->'canh_dan','[]'::jsonb), (t->>'kien')::int,
             p_ma_don||'/'||v_pb||'/'||replace(replace(t->>'ma_tam','|','_'),'#','_')||'.svg');
  end loop;

  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat'
    where ma_don = p_ma_don and trang_thai in ('xong_file','moi_len_don','nhan_thiet_ke','dang_thiet_ke');
  v_bac := found;
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where ma_don = p_ma_don;   -- [KANBAN] tự sang xong file
  perform set_config('chan.tu_mon','',true);

  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'phien_ban',v_pb,
                            'so_tam',jsonb_array_length(p_tam),'vao_chuyen',v_bac);
end $function$;

commit;
