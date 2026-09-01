-- db/201 · WP-90 · Bản đồ TÀI KHOẢN quảng cáo → BRAND (khoảng hiệu lực) + gộp chi_ads_ngay → chi_ads. QD kèm lô.
--   Ý: chi ads mức ngày (chi_ads_ngay, hạt act×ad×ngày) GỘP lên chi_ads (hạt kỳ×brand×kênh) mà app Tài chính đọc —
--      THAY nhập tay. Bản đồ act_id→brand là BẢNG có khoảng hiệu lực (họ QD-68), KHÔNG chôn trong code; nạp theo brand.
--   BỐI CẢNH (đo 01/09): /me/adaccounts = 6 tài khoản, cả 6 của SCONCEPT (Sophia Concept, ma='sconcept'). 3 TK có chi
--      last_7d (FB ADS 3.267.635 · bàn nâng hạ 1.332.275 · Anh Thuận ADS 2.778.405), 3 TK chưa chi. thuong_hieu_ban=9 → phủ 1/9.
--   chi_ads TRỐNG (0 dòng) lúc migrate → không có số nhập tay kỳ 08 để đè; gộp chỉ THÊM. (VIỆC 1: soi read-only trước.)
--   HAI CHẤT LƯỢNG TÁCH NHÃN (04 §C): meta_tu_dong = 'chua_ro_vat' (số Meta thô, chưa đối chiếu hoá đơn) ·
--      nhap_tay = 'gom_vat' (kế toán nhập gồm VAT). kenh_cac_ky (CAC) đọc cột này → phải rẽ theo nhãn, KHÔNG ÷VAT số chua_ro.
--   HAI CỬA GHI TÁCH nguon: ads_ghi (nhập tay) chỉ đụng nguon='nhap_tay'; gộp chỉ đụng nguon='meta_tu_dong'. Không giẫm nhau.
--   ⚠ KHÔNG IDEMPOTENT hoàn toàn (create table + insert 6 dòng bản đồ có guard). Cổng backup QD-61.
--   HOÀN TÁC: drop function kho.chi_ads_gop_meta(), kho.ads_do_phu_brand(); drop table kho.ads_tai_khoan_brand;
--     alter table kho.chi_ads drop column nguon, drop column nhan_vat; + chạy lại db/115 (ads_ghi, kenh_cac_ky bản cũ).
begin;

create extension if not exists btree_gist;   -- cho EXCLUDE (act_id text '=' trong gist)

-- ═══════════════ 1. BẢNG BẢN ĐỒ act_id → brand (khoảng hiệu lực, họ QD-68) ═══════════════
create table if not exists kho.ads_tai_khoan_brand (
  id             bigserial primary key,
  act_id         text not null,
  ten_tai_khoan  text,
  brand_id       text not null references kho.thuong_hieu(ma),
  hieu_luc_tu    date not null,
  hieu_luc_den   date,                       -- null = khoảng đang MỞ
  ghi_chu        text,
  tao_luc        timestamptz not null default now(),
  check (hieu_luc_den is null or hieu_luc_den >= hieu_luc_tu)
);
-- Một act_id KHÔNG chồng khoảng hiệu lực (đổi brand = đóng khoảng cũ + mở mới, không đè — QD-68).
alter table kho.ads_tai_khoan_brand drop constraint if exists ads_tk_brand_khong_chong;
alter table kho.ads_tai_khoan_brand add constraint ads_tk_brand_khong_chong
  exclude using gist (act_id with =,
    daterange(hieu_luc_tu, coalesce(hieu_luc_den, 'infinity'::date), '[]') with &&);
alter table kho.ads_tai_khoan_brand enable row level security;
revoke all on kho.ads_tai_khoan_brand from public, anon;
grant select on kho.ads_tai_khoan_brand to authenticated;
drop policy if exists ads_tkb_doc on kho.ads_tai_khoan_brand;
create policy ads_tkb_doc on kho.ads_tai_khoan_brand for select to authenticated
  using (kho.current_vai_tro() in ('ceo','ke_toan','ads_user'));

-- Nạp 6 tài khoản → SCONCEPT (đo /me/adaccounts 01/09). hieu_luc_tu = đầu kỳ mốc 2026-08 (chi_ads_ngay sớm nhất 2026-08-24).
-- Guard: chỉ nạp nếu bảng chưa có act_id đó (idempotent, không đè khoảng đã có).
insert into kho.ads_tai_khoan_brand(act_id, ten_tai_khoan, brand_id, hieu_luc_tu, ghi_chu)
select v.act_id, v.ten, 'sconcept', date '2026-08-01',
       '6 tài khoản quảng cáo của SCONCEPT (CEO 01/09). Brand khác nạp sau — triển khai lần lượt.'
from (values
  ('425089874000080','Sofa bed'),
  ('725695276511778','sofabed việt'),
  ('1639223353406452','bàn nâng hạ'),
  ('1100574562214961','bàn học'),
  ('1316832279835473','FB ADS'),
  ('3849052618723908','Anh Thuận ADS')
) as v(act_id, ten)
where not exists (select 1 from kho.ads_tai_khoan_brand m where m.act_id = v.act_id);

-- ═══════════════ 2. chi_ads: THÊM cột nguồn + nhãn VAT (tách hai chất lượng) ═══════════════
alter table kho.chi_ads add column if not exists nguon    text not null default 'nhap_tay';
alter table kho.chi_ads add column if not exists nhan_vat text not null default 'gom_vat';
alter table kho.chi_ads drop constraint if exists chi_ads_nguon_chk;
alter table kho.chi_ads add  constraint chi_ads_nguon_chk    check (nguon    in ('nhap_tay','meta_tu_dong'));
alter table kho.chi_ads drop constraint if exists chi_ads_nhan_vat_chk;
alter table kho.chi_ads add  constraint chi_ads_nhan_vat_chk check (nhan_vat in ('gom_vat','chua_ro_vat'));
-- Một dòng auto duy nhất mỗi (kỳ,brand,kênh) → gộp chạy lại không đẻ trùng (idempotent ở tầng ràng buộc).
create unique index if not exists uq_chi_ads_meta on kho.chi_ads(ma_ky, thuong_hieu, kenh) where nguon='meta_tu_dong';

-- ═══════════════ 3. ads_ghi (nhập tay) — SCOPE delete về nguon='nhap_tay', gắn nhãn gom_vat ═══════════════
--   (db/115 xoá CẢ kỳ rồi ghi lại → sẽ NUỐT dòng meta_tu_dong. Sửa: chỉ đụng phần nhập tay.)
create or replace function kho.ads_ghi(p_ky text, p_dong jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare r jsonb; v_n int := 0; v_nguoi text := coalesce((select ho_ten from kho.nguoi_dung where id=kho.current_ns()),'');
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'ads_ghi: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky='' then raise exception 'ads_ghi: thiếu ma_ky'; end if;
  delete from kho.chi_ads where ma_ky = p_ky and nguon = 'nhap_tay';   -- KHÔNG đụng dòng meta_tu_dong
  for r in select * from jsonb_array_elements(coalesce(p_dong,'[]'::jsonb)) loop
    insert into kho.chi_ads(ma_ky,thuong_hieu,kenh,so_tien_nhap,ghi_chu,nguoi_nhap,nguon,nhan_vat)
      values(p_ky, r->>'thuong_hieu', r->>'kenh', coalesce(nullif(r->>'so_tien_nhap','')::numeric,0),
             nullif(r->>'ghi_chu',''), coalesce(nullif(r->>'nguoi_nhap',''), v_nguoi), 'nhap_tay', 'gom_vat');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok',true,'ma_ky',p_ky,'so_dong',v_n);
end $$;
grant execute on function kho.ads_ghi(text, jsonb) to authenticated;

-- ═══════════════ 4. GỘP chi_ads_ngay → chi_ads (từ MỐC trở đi, idempotent, không đè nhập tay) ═══════════════
create or replace function kho.chi_ads_gop_meta() returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v_moc date; v_moc_ky text; v_n int; v_treo numeric; v_tk_treo int; v_bo_tay int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan')
          or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_ads_gop_meta: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  select min(ngay) into v_moc from kho.chi_ads_ngay;
  if v_moc is null then
    return jsonb_build_object('ok',true,'moc',null,'so_dong',0,'ghi_chu','chi_ads_ngay rỗng — không gộp'); end if;
  v_moc_ky := to_char(v_moc,'YYYY-MM');

  -- idempotent: dọn dòng auto từ mốc kỳ trở đi (KHÔNG đụng nhap_tay, KHÔNG đụng kỳ < mốc).
  delete from kho.chi_ads where nguon='meta_tu_dong' and ma_ky >= v_moc_ky;

  -- gộp theo (kỳ, brand qua bản đồ đúng khoảng hiệu lực), kênh='quang_cao'. BỎ QUA (kỳ,brand) đã có dòng nhập tay
  -- cùng kênh (CẤM đè nhập tay) — số bị bỏ đếm ở v_bo_tay để không im lặng.
  with g as (
    select to_char(n.ngay,'YYYY-MM') ky, m.brand_id, sum(n.chi_tieu) chi, count(distinct n.act_id) so_tk
    from kho.chi_ads_ngay n
    join kho.ads_tai_khoan_brand m
      on m.act_id = n.act_id and n.ngay >= m.hieu_luc_tu
     and (m.hieu_luc_den is null or n.ngay <= m.hieu_luc_den)
    where to_char(n.ngay,'YYYY-MM') >= v_moc_ky
    group by 1, 2
  ), ins as (
    insert into kho.chi_ads(ma_ky,thuong_hieu,kenh,so_tien_nhap,nguon,nhan_vat,ghi_chu,nguoi_nhap)
    select g.ky, g.brand_id, 'quang_cao', g.chi, 'meta_tu_dong', 'chua_ro_vat',
           'Tự gộp từ chi_ads_ngay ('||g.so_tk||' TK Meta)', 'he_thong'
    from g
    where not exists (select 1 from kho.chi_ads t
                      where t.ma_ky=g.ky and t.thuong_hieu=g.brand_id and t.kenh='quang_cao' and t.nguon='nhap_tay')
    returning 1)
  select count(*)::int into v_n from ins;

  select count(*)::int into v_bo_tay from (
    select g.ky, g.brand_id from (
      select to_char(n.ngay,'YYYY-MM') ky, m.brand_id
      from kho.chi_ads_ngay n join kho.ads_tai_khoan_brand m
        on m.act_id=n.act_id and n.ngay>=m.hieu_luc_tu and (m.hieu_luc_den is null or n.ngay<=m.hieu_luc_den)
      where to_char(n.ngay,'YYYY-MM') >= v_moc_ky group by 1,2) g
    where exists (select 1 from kho.chi_ads t
                  where t.ma_ky=g.ky and t.thuong_hieu=g.brand_id and t.kenh='quang_cao' and t.nguon='nhap_tay')
  ) x;

  -- chi TREO = tài khoản chưa có trong bản đồ (đúng khoảng) → ĐẾM ĐƯỢC, không nuốt im.
  select coalesce(sum(n.chi_tieu),0), count(distinct n.act_id) into v_treo, v_tk_treo
  from kho.chi_ads_ngay n
  where not exists (select 1 from kho.ads_tai_khoan_brand m where m.act_id=n.act_id
    and n.ngay>=m.hieu_luc_tu and (m.hieu_luc_den is null or n.ngay<=m.hieu_luc_den));

  return jsonb_build_object('ok',true,'moc',v_moc,'moc_ky',v_moc_ky,'so_dong_gop',v_n,
    'bo_qua_vi_nhap_tay',v_bo_tay,'chi_treo_chua_gan',v_treo,'so_tk_chua_gan',v_tk_treo);
end $$;
revoke execute on function kho.chi_ads_gop_meta() from public, anon;
grant  execute on function kho.chi_ads_gop_meta() to authenticated;

-- ═══════════════ 5. kenh_cac_ky — ads CTE RẼ THEO NHÃN VAT (chua_ro_vat KHÔNG bóc VAT) ═══════════════
--   ⚠ Bản LIVE là 3-ARG kenh_cac_ky(text,text,boolean p_gom_demo) (db/120 demo) — PATCH đúng bản này, giữ NGUYÊN
--     logic demo (cm_don_raw 5-arg · fb lọc la_demo). Đổi DUY NHẤT CTE 'ads': gom_vat ÷(1+vat) như cũ · chua_ro_vat
--     lấy nguyên (số Meta thô). Dòng nhập tay mặc định gom_vat → CAC kỳ chỉ-nhập-tay GIỮ NGUYÊN hành vi (byte-identical).
--   (KHÔNG tạo overload 2-arg — sẽ đá nhau với 3-arg default → gọi ambiguous.)
create or replace function kho.kenh_cac_ky(p_ky text, p_brand text default null, p_gom_demo boolean default false)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  t record; v_vat numeric; v_hh numeric; v_from date; v_to date; v_ds jsonb; v_tong jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'kenh_cac_ky: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ky;
  if not found or t.vat is null then raise exception 'kenh_cac_ky: kỳ % chưa có tham số tài chính (vat)', p_ky; end if;
  v_vat := t.vat; v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_from := to_date(p_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;

  with cm as (   -- CHỈ ĐƠN TRỌN trong kỳ, gom brand×kênh (nguồn: cm_don_raw, giữ cờ demo)
    select coalesce(nullif(btrim(r.thuong_hieu),''),'(chưa ghi TH)') brand,
           coalesce(nullif(btrim(r.nguon_khach),''),'(chưa ghi nguồn)') kenh,
           count(*) don_giao, sum(r.dt_thuan) dt, sum(r.cm) cm
    from kho.cm_don_raw(p_ky, v_vat, v_hh, null, p_gom_demo) r
    where not (r.thieu_gv or r.thieu_ship)
    group by 1,2
  ),
  fb as (   -- khách MỚI theo brand (giữ lọc la_demo)
    select brand, kenh, count(*) khach_moi from (
      select distinct on (d.sdt_khach, d.thuong_hieu)
             d.thuong_hieu brand, d.nguon_khach kenh, d.ngay_giao first_giao
      from kho.don_hang d
      where d.trang_thai='da_giao' and (p_gom_demo or not d.la_demo) and nullif(btrim(d.sdt_khach),'') is not null
        and nullif(btrim(d.thuong_hieu),'') is not null and d.ngay_giao is not null
      order by d.sdt_khach, d.thuong_hieu, d.ngay_giao
    ) x where x.first_giao >= v_from and x.first_giao < v_to and nullif(btrim(x.kenh),'') is not null
    group by brand, kenh
  ),
  ads as (   -- chi ads THẬT: gom_vat ÷(1+vat) · chua_ro_vat lấy nguyên (KHÔNG bóc VAT số chưa rõ) — 04 §C
    select thuong_hieu brand, kenh,
      sum(case when nhan_vat='gom_vat' then so_tien_nhap/(1+v_vat/100.0) else so_tien_nhap end) chi_that
    from kho.chi_ads where ma_ky=p_ky group by 1,2
  ),
  gop as (
    select coalesce(cm.brand, fb.brand, ads.brand) brand, coalesce(cm.kenh, fb.kenh, ads.kenh) kenh,
      coalesce(cm.don_giao,0) don_giao, coalesce(cm.dt,0) dt, coalesce(cm.cm,0) cm,
      coalesce(fb.khach_moi,0) khach_moi, coalesce(ads.chi_that,0) chi_that
    from cm full outer join fb on fb.brand=cm.brand and fb.kenh=cm.kenh
            full outer join ads on ads.brand=coalesce(cm.brand,fb.brand) and ads.kenh=coalesce(cm.kenh,fb.kenh)
  ),
  loc as ( select * from gop where p_brand is null or brand = p_brand )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'brand',brand,'kenh',kenh,'don_giao',don_giao,'khach_moi_brand',khach_moi,
      'chi_ads_that',chi_that,'cac', case when khach_moi>0 then chi_that/khach_moi else null end,
      'vo_han', (chi_that>0 and khach_moi=0), 'mau_mong', (khach_moi>0 and khach_moi<3),
      'dt_thuan',dt,'cm_kenh',cm,'cm_sau_ads', cm - chi_that
    ) order by brand, kenh),'[]'::jsonb),
    jsonb_build_object('don_giao',coalesce(sum(don_giao),0),'khach_moi_brand',coalesce(sum(khach_moi),0),
      'chi_ads_that',coalesce(sum(chi_that),0),'dt_thuan',coalesce(sum(dt),0),
      'cm_kenh',coalesce(sum(cm),0),'cm_sau_ads',coalesce(sum(cm),0)-coalesce(sum(chi_that),0))
  into v_ds, v_tong from loc;

  return jsonb_build_object('ma_ky',p_ky,'vat',v_vat,'brand_loc',p_brand,'dong',v_ds,'tong',v_tong);
end $$;
grant execute on function kho.kenh_cac_ky(text, text, boolean) to authenticated;
drop function if exists kho.kenh_cac_ky(text, text);   -- gỡ overload 2-arg lỡ tạo (đá ambiguous với 3-arg default)

-- ═══════════════ 6. ĐỘ PHỦ BRAND — RPC trả "chi ads trong hệ phủ mấy / mấy brand" (VIỆC 4) ═══════════════
--   brand_co_ban_do = brand có bản đồ TK quảng cáo đang mở · brand_dang_ban = view thuong_hieu_ban (9).
--   Mục đích: màn nói "chi ads phủ 1/9 brand" — nạp brand thứ hai thì số TỰ đổi (đọc DB, không ghi cứng).
create or replace function kho.ads_do_phu_brand() returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v_co int; v_ban int; v_treo numeric; v_tk_treo int; v_ds jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_do_phu_brand: chỉ ceo/ke_toan/ads_user'; end if;
  select count(distinct brand_id) into v_co from kho.ads_tai_khoan_brand where hieu_luc_den is null;
  select count(*) into v_ban from kho.thuong_hieu_ban;
  select coalesce(sum(n.chi_tieu),0), count(distinct n.act_id) into v_treo, v_tk_treo
  from kho.chi_ads_ngay n
  where not exists (select 1 from kho.ads_tai_khoan_brand m where m.act_id=n.act_id
    and n.ngay>=m.hieu_luc_tu and (m.hieu_luc_den is null or n.ngay<=m.hieu_luc_den));
  select coalesce(jsonb_agg(jsonb_build_object('brand_id',b.brand_id,'ten',th.ten,'so_tk',b.so_tk,'tong_chi',b.tong)
                            order by b.brand_id),'[]'::jsonb) into v_ds
  from (
    select m.brand_id, count(distinct m.act_id) so_tk,
      coalesce((select sum(n.chi_tieu) from kho.chi_ads_ngay n
        where n.act_id in (select act_id from kho.ads_tai_khoan_brand mm where mm.brand_id=m.brand_id)),0) tong
    from kho.ads_tai_khoan_brand m where m.hieu_luc_den is null group by m.brand_id
  ) b left join kho.thuong_hieu th on th.ma=b.brand_id;
  return jsonb_build_object(
    'brand_co_ban_do', v_co, 'brand_dang_ban', v_ban,
    'do_phu', v_co::text || '/' || v_ban::text,
    'chi_treo_chua_gan', v_treo, 'so_tk_chua_gan', v_tk_treo,
    'ds_brand_phu', v_ds);
end $$;
revoke execute on function kho.ads_do_phu_brand() from public, anon;
grant  execute on function kho.ads_do_phu_brand() to authenticated;

do $$ begin
  if to_regclass('kho.ads_tai_khoan_brand') is null then raise exception 'THIẾU ads_tai_khoan_brand'; end if;
  if to_regprocedure('kho.chi_ads_gop_meta()') is null then raise exception 'THIẾU chi_ads_gop_meta'; end if;
  if to_regprocedure('kho.ads_do_phu_brand()') is null then raise exception 'THIẾU ads_do_phu_brand'; end if;
  raise notice 'db/201 OK: ads_tai_khoan_brand (% dòng) + chi_ads(nguon,nhan_vat) + chi_ads_gop_meta + ads_do_phu_brand + kenh_cac_ky rẽ nhãn.',
    (select count(*) from kho.ads_tai_khoan_brand);
end $$;
commit;
