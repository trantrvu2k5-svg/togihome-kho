-- db/182 · WP-70 L-08 · loai_thuong_mai (bảng gốc DUY NHẤT phân loại thương mại) + cầu dong_loai + suy loại cho lead.
--   Chat não duyệt (iii-b) 29/08: BỎ kho.chu_de, dựng kho.loai_thuong_mai làm bảng gốc.
--   Ba chiều TÁCH BẠCH: DÒNG (xưởng làm, 11 · dong_san_pham) · LOẠI THƯƠNG MẠI (công ty bán, 10, đóng) · PHÒNG (khong_gian).
--   Nối dòng→loại qua dong_loai (nhiều dòng một loại). Lead suy loại QUA ĐƠN CHỐT (món giá trị lớn nhất).
--
--   HOÀN TÁC: khôi phục kho.chu_de + lead.chu_de_ma + các hàm bản db/178/179/180 từ git;
--     drop function kho.cac_theo_luong_loai(text); drop table kho.dong_loai; alter table kho.lead drop column loai_ma;
--     drop function kho.loai_cam_sua() cascade; drop table kho.loai_thuong_mai.
--   ⚠ migration ≥177 LUÔN backup.
begin;

-- ══ (1) BẢNG GỐC loai_thuong_mai — danh mục ĐÓNG (tinh thần QD-74) ══
create table if not exists kho.loai_thuong_mai (
  ma          text primary key,
  ten         text not null,
  thu_tu      int,
  hieu_luc_tu date not null,
  hieu_luc_den date,
  ly_do       text,
  dang_bat    boolean not null default true
);
-- CẤM sửa đè ma/ten (đóng) — sửa = tách khoảng (đóng hieu_luc_den + mã mới), như chu_de cũ.
create or replace function kho.loai_cam_sua() returns trigger language plpgsql set search_path to 'kho' as $fn$
begin
  if (new.ma is distinct from old.ma) or (new.ten is distinct from old.ten) then
    raise exception 'loai_thuong_mai: CẤM sửa đè ma/ten — danh mục ĐÓNG, sửa = tách khoảng (đóng hieu_luc_den cũ + mã mới)';
  end if;
  return new;
end $fn$;
drop trigger if exists trg_loai_cam_sua on kho.loai_thuong_mai;
create trigger trg_loai_cam_sua before update on kho.loai_thuong_mai for each row execute function kho.loai_cam_sua();
grant select on kho.loai_thuong_mai to authenticated;

-- Seed 10 loại — TÊN Y HỆT chữ tool ngoài của CEO (WP-09 sẽ khớp từng ký tự, KHÔNG chuẩn hoá).
insert into kho.loai_thuong_mai(ma, ten, thu_tu, hieu_luc_tu, dang_bat) values
  ('sofa',      'Sofa & Sofa bed',          1, '2026-01-01', true),
  ('giuong',    'Giường & Phòng ngủ',       2, '2026-01-01', true),
  ('ban_an',    'Bàn ăn & Ghế ăn',          3, '2026-01-01', true),
  ('tu',        'Tủ & Lưu trữ',             4, '2026-01-01', true),
  ('ban_lv',    'Bàn làm việc & Bàn học',   5, '2026-01-01', true),
  ('bep',       'Nội thất bếp',             6, '2026-01-01', true),
  ('ban_tra',   'Bàn trà & Bàn phụ',        7, '2026-01-01', true),
  ('tham',      'Thảm',                     8, '2026-01-01', true),
  ('chan_ga',   'Chăn ga gối nệm',          9, '2026-01-01', true),
  ('den',       'Đèn & Phụ kiện',          10, '2026-01-01', true)
on conflict (ma) do nothing;

-- ══ (2) CẦU dong_loai — dong_san_pham(ma_dong) → loai_thuong_mai(ma). Nhiều dòng một loại. ══
create table if not exists kho.dong_loai (
  dong_ma text primary key references kho.dong_san_pham(ma_dong),
  loai_ma text not null references kho.loai_thuong_mai(ma)
);
grant select on kho.dong_loai to authenticated;
insert into kho.dong_loai(dong_ma, loai_ma) values
  ('TA','tu'),('TG','tu'),('KE','tu'),('HK','tu'),      -- Tủ & Lưu trữ
  ('GN','giuong'),('TD','giuong'),                      -- Giường & Phòng ngủ
  ('BLV','ban_lv'),('HB','ban_lv'),                     -- Bàn làm việc & Bàn học
  ('BA','ban_an'),                                      -- Bàn ăn & Ghế ăn
  ('TB','bep'),                                         -- Nội thất bếp
  ('BT','ban_tra')                                      -- Bàn trà & Bàn phụ
on conflict (dong_ma) do nothing;
-- Sofa/Thảm/Chăn ga/Đèn KHÔNG có dòng trỏ tới — đúng (hàng săn xưởng không làm). Dòng lạ → NULL "chưa gán".

-- ══ (3) lead: chu_de_ma → loai_ma (references loai_thuong_mai). chu_de 0 dòng → không mất dữ liệu. ══
--   v_lead_hien_hanh (select *) PHỤ THUỘC chu_de_ma → phải DROP VIEW trước khi drop cột, rồi tạo lại.
drop view if exists kho.v_lead_hien_hanh;
alter table kho.lead add column if not exists loai_ma text references kho.loai_thuong_mai(ma);
alter table kho.lead drop column if exists chu_de_ma;
create view kho.v_lead_hien_hanh as
  select distinct on (page_id, hoi_thoai_id) *
  from kho.lead
  order by page_id, hoi_thoai_id, stt desc;
grant select on kho.v_lead_hien_hanh to authenticated;

-- ══ (4) lead_ghi — chu_de_ma → loai_ma (dau_van + insert). ══
create or replace function kho.lead_ghi(p_lead jsonb)
returns jsonb language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_dv text; v_last text;
  v_page text := p_lead->>'page_id'; v_ht text := p_lead->>'hoi_thoai_id'; v_id uuid; v_stt bigint;
begin
  if not (v_vai in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then raise exception 'lead_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)'; end if;
  if v_page is null or v_ht is null then raise exception 'lead_ghi: thiếu page_id/hoi_thoai_id'; end if;
  v_dv := md5(concat_ws('|', coalesce(p_lead->>'nguon','pancake'), v_page, v_ht,
     p_lead->>'khach_pancake_id', p_lead->>'loai', p_lead->>'thoi_diem_hoi_thoai',
     p_lead->>'luong', p_lead->>'loai_ma', p_lead->>'muc_chac_chan',
     p_lead->>'ad_id', p_lead->>'ref_web', p_lead->>'sdt', p_lead->>'ten_khach'));
  select dau_van into v_last from kho.lead where page_id=v_page and hoi_thoai_id=v_ht order by stt desc limit 1;
  if v_last is not null and v_last = v_dv then return jsonb_build_object('ket','khong_doi'); end if;
  insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,loai_ma,muc_chac_chan,ad_id,ref_web,sdt,ten_khach,dau_van)
  values(coalesce(nullif(p_lead->>'nguon',''),'pancake'), v_page, v_ht,
     nullif(p_lead->>'khach_pancake_id',''), nullif(p_lead->>'loai',''),
     (p_lead->>'thoi_diem_hoi_thoai')::timestamptz, p_lead->>'luong',
     nullif(p_lead->>'loai_ma',''), p_lead->>'muc_chac_chan',
     nullif(p_lead->>'ad_id',''), nullif(p_lead->>'ref_web',''), nullif(p_lead->>'sdt',''),
     nullif(p_lead->>'ten_khach',''), v_dv)
  returning id, stt into v_id, v_stt;
  return jsonb_build_object('ket','da_ghi','id',v_id,'stt',v_stt);
end $fn$;
grant execute on function kho.lead_ghi(jsonb) to authenticated;

-- ══ (5) lead_goi_y — chu_de_ma → loai_ma ══
create or replace function kho.lead_goi_y(p_tim text default null, p_ngay int default 7)
returns jsonb language plpgsql stable security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_tim text; v_res jsonb;
begin
  if v_vai not in ('sale','ceo','ke_toan') then raise exception 'lead_goi_y: chỉ sale/ceo/ke_toan'; end if;
  v_tim := nullif(btrim(coalesce(p_tim,'')),'');
  select coalesce(jsonb_agg(x order by x.thoi_diem desc), '[]'::jsonb) into v_res from (
    select v.id as lead_id, v.ten_khach,
      case when v.sdt is not null and length(v.sdt) > 4 then left(v.sdt, length(v.sdt)-4) || '****'
           when v.sdt is not null then '****' else null end as sdt,
      v.page_id as trang,
      case when v.page_id like 'pzl!_%' escape '!' then 'zalo'
           when v.page_id like 'igo!_%' escape '!' then 'instagram' else 'facebook' end as nen_tang,
      v.thoi_diem_hoi_thoai as thoi_diem, v.muc_chac_chan, v.luong, v.loai_ma
    from kho.v_lead_hien_hanh v
    where v.nguon='pancake'
      and case
        when v_tim is null then v.thoi_diem_hoi_thoai >= now() - make_interval(days => greatest(p_ngay,1))
        else (kho.bo_dau(v.ten_khach) like '%'||kho.bo_dau(v_tim)||'%' or v.sdt like '%'||v_tim||'%')
      end
    order by v.thoi_diem_hoi_thoai desc
    limit 50
  ) x;
  return v_res;
end $fn$;
grant execute on function kho.lead_goi_y(text, int) to authenticated;

-- ══ (6) cac_theo_luong_chu_de → cac_theo_luong_loai (DROP hàm cũ TRƯỚC — tránh overload). ══
--   Loại SUY từ đơn chốt (món giá trị lớn nhất) → dong_loai. Bảng loại: chi ads & CAC = NULL (cần WP-78, cấm chia đều).
drop function if exists kho.cac_theo_luong_chu_de(text);
create or replace function kho.cac_theo_luong_loai(p_ky text)
returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit='off' as $fn$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_from date; v_to date; v_chi_total numeric; v_res jsonb;
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'cac_theo_luong_loai: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky !~ '^\d{4}-\d{2}$' then raise exception 'cac_theo_luong_loai: p_ky phải dạng YYYY-MM'; end if;
  v_from := to_date(p_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;
  begin v_chi_total := (kho.kenh_cac_ky(p_ky) -> 'tong' ->> 'chi_ads_that')::numeric; exception when others then v_chi_total := null; end;
  if v_chi_total is not null and v_chi_total <= 0 then v_chi_total := null; end if;

  with coh as (
    select v.id, v.page_id, v.hoi_thoai_id, v.luong, v.muc_chac_chan,
      case when v.page_id like 'pzl!_%' escape '!' then 'zalo'
           when v.page_id like 'igo!_%' escape '!' then 'instagram' else 'facebook' end as platform
    from kho.v_lead_hien_hanh v
    where v.nguon='pancake' and v.thoi_diem_hoi_thoai >= v_from and v.thoi_diem_hoi_thoai < v_to
  ),
  don as (
    select l.page_id, l.hoi_thoai_id, count(distinct dh.id) n
    from kho.don_hang dh join kho.lead l on l.id = dh.lead_id
    where dh.trang_thai <> 'bao_gia' group by l.page_id, l.hoi_thoai_id
  ),
  -- LOẠI SUY từ đơn chốt: món giá trị (gia×so_luong) LỚN NHẤT → sp_id → biến thể → lõi.dong_id → dong_loai.loai_ma
  lead_loai as (
    select distinct on (coh.id) coh.id, dl.loai_ma
    from coh
    join kho.don_hang dh on dh.lead_id = coh.id and dh.trang_thai <> 'bao_gia'
    cross join lateral (
      select m.sp_id from kho.don_hang_mon m
      where m.don_id = dh.id and nullif(m.sp_id,'') is not null
      order by coalesce(m.gia,0)*coalesce(m.so_luong,1) desc nulls last limit 1
    ) top
    join kho.san_pham_mau sm on sm.ma = top.sp_id
    join kho.san_pham_loi sl on sl.ma_loi = sm.ma_loi
    join kho.dong_loai dl on dl.dong_ma = sl.dong_id
    order by coh.id
  ),
  cd as (
    select coh.*, coalesce(d.n,0) don_chot, ll.loai_ma
    from coh left join don d on d.page_id=coh.page_id and d.hoi_thoai_id=coh.hoi_thoai_id
      left join lead_loai ll on ll.id = coh.id
  ),
  tong as ( select count(*)::int n, count(*) filter (where muc_chac_chan='xac_dinh')::int xd from cd ),
  chat as ( select jsonb_build_object('tong',(select n from tong),
      'xac_dinh',count(*) filter(where muc_chac_chan='xac_dinh'),'suy_ref',count(*) filter(where muc_chac_chan='suy_ref'),
      'doi_chieu_lo',count(*) filter(where muc_chac_chan='doi_chieu_lo'),'khong_biet',count(*) filter(where muc_chac_chan='khong_biet')) j from cd ),
  chat_trang as ( select coalesce(jsonb_agg(jsonb_build_object('platform',platform,'tong',tong,'xac_dinh',xd,'suy_ref',sr,'doi_chieu_lo',dc,'khong_biet',kb) order by tong desc, platform),'[]'::jsonb) j
    from ( select platform,count(*) tong,count(*) filter(where muc_chac_chan='xac_dinh') xd,count(*) filter(where muc_chac_chan='suy_ref') sr,
        count(*) filter(where muc_chac_chan='doi_chieu_lo') dc,count(*) filter(where muc_chac_chan='khong_biet') kb from cd group by platform) t ),
  luong_g as ( select g.luong, coalesce(count(cd.id),0)::int hoi_thoai, coalesce(sum(cd.don_chot),0)::int don_chot,
      coalesce(count(cd.id) filter(where cd.muc_chac_chan='xac_dinh'),0)::int xd
    from (values ('qua_web',1),('mess_truc_tiep',2),('khong_biet',3)) g(luong,ord) left join cd on cd.luong=g.luong group by g.luong,g.ord order by g.ord ),
  luong_j as ( select coalesce(jsonb_agg(jsonb_build_object('luong',luong,'hoi_thoai',hoi_thoai,'don_chot',don_chot,
      'ty_le_chot',case when hoi_thoai>0 then round(don_chot::numeric*100/hoi_thoai,1) else null end,
      'chi_ads',case when v_chi_total is not null and (select xd from tong)>0 and xd>0 then round(v_chi_total*xd/(select xd from tong)) else null end,
      'cac',case when v_chi_total is not null and (select xd from tong)>0 and xd>0 and don_chot>0 then round(v_chi_total*xd/(select xd from tong)/don_chot) else null end,
      'cac_toi_da',null)),'[]'::jsonb) j from luong_g ),
  -- LOẠI (thay chủ đề): nhóm theo loại SUY. chi ads & CAC = NULL LUÔN (cần bản đồ quảng-cáo→loại, WP-78).
  loai_g as ( select cd.loai_ma, (cd.loai_ma is null) chua_gan, count(*)::int hoi_thoai, sum(cd.don_chot)::int don_chot,
      bool_or(cd.muc_chac_chan in ('suy_ref','doi_chieu_lo')) co_tron_suy from cd group by cd.loai_ma ),
  loai_j as ( select coalesce(jsonb_agg(jsonb_build_object(
      'loai_ma',loai_ma,'ten',(select ten from kho.loai_thuong_mai t where t.ma=g.loai_ma),
      'chua_gan',chua_gan,'co_tron_suy',coalesce(co_tron_suy,false),'hoi_thoai',hoi_thoai,'don_chot',don_chot,
      'chi_ads',null,'cac',null)                                            -- LUÔN NULL (WP-78), CẤM chia đều
      order by (not chua_gan), (select thu_tu from kho.loai_thuong_mai t where t.ma=g.loai_ma)),'[]'::jsonb) j from loai_g g ),
  tongdon as ( select coalesce(sum(don_chot),0)::int dc from cd )
  select jsonb_build_object('ma_ky',p_ky,'cohort_tong',(select n from tong),'don_chot_tong',(select dc from tongdon),
    'chi_ads_that_ky',v_chi_total,'chat_luong',(select j from chat),'chat_luong_trang',(select j from chat_trang),
    'luong',(select j from luong_j),'loai',(select j from loai_j)) into v_res;

  v_res := v_res || jsonb_build_object('bo_keo', (
    select jsonb_build_object('lan_keo_gan_nhat',max(lan_keo_luc),
      'phut_truoc',case when max(lan_keo_luc) is not null then floor(extract(epoch from(now()-max(lan_keo_luc)))/60)::int else null end,
      'lan_co_lead',max(lan_co_lead_luc),
      'phut_co_lead',case when max(lan_co_lead_luc) is not null then floor(extract(epoch from(now()-max(lan_co_lead_luc)))/60)::int else null end,
      'hoi_thoai_moi_lan_cuoi',(select so_ban_ghi_lan_cuoi from kho.lead_moc_keo order by lan_co_lead_luc desc nulls last limit 1),
      'tre',case when max(lan_keo_luc) is not null then (now()-max(lan_keo_luc)) > interval '15 minutes' else null end
    ) from kho.lead_moc_keo ));
  return v_res;
end $fn$;
grant execute on function kho.cac_theo_luong_loai(text) to authenticated;

-- ══ (7) BỎ kho.chu_de (0 dòng, không ai còn tham chiếu sau khi lead bỏ chu_de_ma) ══
drop trigger if exists trg_chu_de_cam_sua on kho.chu_de;
drop function if exists kho.chu_de_cam_sua() cascade;
drop table if exists kho.chu_de;

do $$ begin
  if (select count(*) from kho.loai_thuong_mai) <> 10 then raise exception 'loai_thuong_mai phải 10 dòng'; end if;
  if (select count(*) from kho.dong_loai) <> 11 then raise exception 'dong_loai phải 11 dòng'; end if;
  if to_regclass('kho.chu_de') is not null then raise exception 'chu_de CHƯA drop'; end if;
  if to_regprocedure('kho.cac_theo_luong_chu_de(text)') is not null then raise exception 'hàm chu_de cũ CHƯA drop'; end if;
  raise notice 'db/182 OK: loai_thuong_mai(10) + dong_loai(11) + lead.loai_ma + cac_theo_luong_loai + bỏ chu_de.';
end $$;
commit;
