-- db/229 · WP-91 (i)+(ii) · SỔ MỐC KÉO ADS + khoá tự hết hạn + đèn trễ. TẦNG DB, không UI/scheduler.
--   Bệnh WP-70 (QD-80): cron "xanh" mà mốc đứng 8h. Bộ kéo Meta dừng 30/08, không lịch chạy → số cũ trông
--   y hệt số mới. Sắp có bộ kéo Google → cần sổ mốc + đèn TRƯỚC (dùng chung mọi bộ kéo). QD-108x (xem docs).
--   Khuôn: khoá TỰ HẾT HẠN theo thời gian (QD-80, finally KHÔNG đáng tin) · ngưỡng đọc từ ads_nguong (QD-93)
--   · grant DANH SÁCH CHO-PHÉP, bảng mới mặc định ĐÓNG với client (QD-96).

begin;

-- ── A · Bảng sổ mốc: một dòng mỗi lượt chạy ──────────────────────────────
create table if not exists kho.ads_moc_keo (
  id               bigint generated always as identity primary key,
  nguon            text not null check (nguon in ('meta_chi_ad','meta_chi_chien_dich','gop_ky')),  -- chỗ cho google_* SAU (chưa token → chưa thêm, tránh nhãn chết)
  bat_dau_luc      timestamptz not null default now(),
  ket_thuc_luc     timestamptz,
  so_dong_ghi      integer,
  khoang_tu        date,
  khoang_den       date,
  trang_thai       text not null default 'dang_chay' check (trang_thai in ('dang_chay','xong','loi')),
  loi_van_ban      text,
  khoa_het_han_luc timestamptz    -- khoá TỰ HẾT HẠN: còn hạn (> now) khi trang_thai='dang_chay' = đang giữ; null/quá hạn = nhả
);
create index if not exists ads_moc_keo_nguon_bat_dau on kho.ads_moc_keo (nguon, bat_dau_luc desc);

-- ── B · Hai ngưỡng đèn trễ vào ads_nguong (khoảng hiệu lực, [TẠM]) ────────
--   Căn cứ: kéo 1 lần/ngày + đệm 2 giờ. Số [TẠM] — sửa qua bảng, không đụng code.
insert into kho.ads_nguong (ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
select * from (values
  ('keo_tre_vang_gio'::text, 8::numeric,  current_date, '[TẠM] kéo 1 lần/ngày + đệm 2h → quá 8h là vàng'::text, 'db/229'::text),
  ('keo_tre_do_gio'::text,  26::numeric,  current_date, '[TẠM] quá 26h (>1 ngày + đệm) là đỏ'::text,          'db/229'::text)
) v(ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
where not exists (select 1 from kho.ads_nguong n where n.ma = v.ma and n.hieu_luc_den is null);

-- ── D · RPC bộ kéo gọi: mở/đóng lượt, ghi lỗi ────────────────────────────
--   p_hanh_dong: 'mo' | 'xong' | 'loi'. 'mo' → chiếm khoá (chặn trùng, thu hồi khoá treo). 'xong'/'loi' → đóng + nhả khoá.
create or replace function kho.ads_moc_keo_ghi(
  p_hanh_dong text,
  p_nguon     text default null,
  p_id        bigint default null,
  p_so_dong   integer default null,
  p_khoang_tu date default null,
  p_khoang_den date default null,
  p_loi       text default null,
  p_khoa_phut integer default 10          -- TTL khoá: dài hơn 1 lượt kéo thật (giây), đủ ngắn để thu hồi lượt chết
) returns jsonb
  language plpgsql security definer set search_path = kho set jit = 'off' as $$
declare v_id bigint; v_con record;
begin
  if p_hanh_dong = 'mo' then
    if p_nguon is null then raise exception 'ads_moc_keo_ghi: mở lượt cần p_nguon'; end if;
    -- khoá CÒN HẠN của nguồn này → chặn lượt trùng
    select id, khoa_het_han_luc into v_con from kho.ads_moc_keo
      where nguon = p_nguon and trang_thai = 'dang_chay' and khoa_het_han_luc > now() limit 1;
    if v_con.id is not null then
      raise exception 'ads_moc_keo_ghi: nguồn "%" đang chạy (lượt %, khoá còn hạn tới %) — chặn lượt trùng',
        p_nguon, v_con.id, v_con.khoa_het_han_luc;
    end if;
    -- khoá QUÁ hạn (lượt chết giữa chừng, finally không chạy — QD-80) → thu hồi rồi cho lượt mới chạy
    update kho.ads_moc_keo set trang_thai = 'loi', ket_thuc_luc = now(), khoa_het_han_luc = null,
        loi_van_ban = coalesce(loi_van_ban, 'khoá treo quá hạn — thu hồi tự động')
      where nguon = p_nguon and trang_thai = 'dang_chay' and (khoa_het_han_luc is null or khoa_het_han_luc <= now());
    insert into kho.ads_moc_keo (nguon, bat_dau_luc, trang_thai, khoa_het_han_luc)
      values (p_nguon, now(), 'dang_chay', now() + make_interval(mins => greatest(p_khoa_phut,1)))
      returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'nguon', p_nguon, 'khoa_het_han_luc', now() + make_interval(mins => greatest(p_khoa_phut,1)));
  elsif p_hanh_dong in ('xong','loi') then
    if p_id is null then raise exception 'ads_moc_keo_ghi: đóng lượt cần p_id'; end if;
    update kho.ads_moc_keo set
        trang_thai = p_hanh_dong, ket_thuc_luc = now(), khoa_het_han_luc = null,
        so_dong_ghi = coalesce(p_so_dong, so_dong_ghi),
        khoang_tu = coalesce(p_khoang_tu, khoang_tu), khoang_den = coalesce(p_khoang_den, khoang_den),
        loi_van_ban = case when p_hanh_dong = 'loi' then p_loi else loi_van_ban end
      where id = p_id returning id into v_id;
    if v_id is null then raise exception 'ads_moc_keo_ghi: không có lượt id %', p_id; end if;
    return jsonb_build_object('ok', true, 'id', v_id, 'trang_thai', p_hanh_dong);
  else
    raise exception 'ads_moc_keo_ghi: p_hanh_dong "%" không hợp lệ (mo|xong|loi)', p_hanh_dong;
  end if;
end $$;

-- ── C · RPC đèn: tình trạng kéo mỗi nguồn ────────────────────────────────
create or replace function kho.ads_tinh_trang_keo()
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_vang numeric; v_do numeric; v_ket jsonb;
begin
  select gia_tri into v_vang from kho.ads_nguong
    where ma = 'keo_tre_vang_gio' and hieu_luc_tu <= current_date and (hieu_luc_den is null or hieu_luc_den >= current_date)
    order by hieu_luc_tu desc limit 1;
  select gia_tri into v_do from kho.ads_nguong
    where ma = 'keo_tre_do_gio' and hieu_luc_tu <= current_date and (hieu_luc_den is null or hieu_luc_den >= current_date)
    order by hieu_luc_tu desc limit 1;

  select jsonb_agg(t order by t.nguon) into v_ket from (
    select n.nguon,
      x.ket_thuc_luc as lan_xong_luc, x.so_dong_ghi, x.khoang_den,
      case when x.ket_thuc_luc is null then null
           else round(extract(epoch from (now() - x.ket_thuc_luc)) / 3600.0, 1) end as tre_gio,
      case
        when x.ket_thuc_luc is null then 'chua_chay'
        when extract(epoch from (now() - x.ket_thuc_luc)) / 3600.0 < v_vang then 'xanh'
        when extract(epoch from (now() - x.ket_thuc_luc)) / 3600.0 < v_do   then 'vang'
        else 'do' end as den,
      case when e.id is null then null
           else jsonb_build_object('luc', e.ket_thuc_luc, 'van_ban', e.loi_van_ban) end as loi_gan_nhat
    from (values ('meta_chi_ad'),('meta_chi_chien_dich'),('gop_ky')) n(nguon)
    left join lateral (
      select ket_thuc_luc, so_dong_ghi, khoang_den from kho.ads_moc_keo
      where nguon = n.nguon and trang_thai = 'xong' order by ket_thuc_luc desc limit 1) x on true
    left join lateral (
      select id, ket_thuc_luc, loi_van_ban from kho.ads_moc_keo
      where nguon = n.nguon and trang_thai = 'loi' order by ket_thuc_luc desc nulls last limit 1) e on true
  ) t;

  return jsonb_build_object(
    'nguong', jsonb_build_object('vang_gio', v_vang, 'do_gio', v_do),
    'ngay_moi_nhat', jsonb_build_object(
      'chi_ads_ngay',        (select max(ngay) from kho.chi_ads_ngay),
      'chi_chien_dich_ngay', (select max(ngay) from kho.chi_chien_dich_ngay)),
    'nguon', coalesce(v_ket, '[]'::jsonb));
end $$;

-- ── E · GRANT: bảng mặc định ĐÓNG với client (QD-96) — chỉ đọc qua RPC ────
revoke all on kho.ads_moc_keo from public, anon, authenticated;   -- client KHÔNG insert/update/select thẳng
alter table kho.ads_moc_keo enable row level security;            -- không policy client → deny-all (RPC DEFINER bỏ qua)
grant all on kho.ads_moc_keo to service_role;                     -- bộ kéo (service) ghi trực tiếp nếu cần

-- đèn: client đọc được (app ads hiện đèn); ghi: chỉ bộ kéo (service), KHÔNG mở cho authenticated
revoke execute on function kho.ads_tinh_trang_keo()             from public, anon;
grant  execute on function kho.ads_tinh_trang_keo()             to authenticated, service_role;
revoke execute on function kho.ads_moc_keo_ghi(text,text,bigint,integer,date,date,text,integer) from public, anon, authenticated;
grant  execute on function kho.ads_moc_keo_ghi(text,text,bigint,integer,date,date,text,integer) to service_role;

commit;
