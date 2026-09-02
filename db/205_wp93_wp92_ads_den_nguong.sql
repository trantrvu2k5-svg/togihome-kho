-- db/205 · WP-93 (bảng ads theo chiến dịch) + WP-92 (đèn trần CAC) TẦNG DB. QD-92 + QD-93.
--   Gộp theo OBJECTIVE (loại chiến dịch) — VIỆC 0b: chi_chien_dich_ngay KHÔNG có trường dạng nội dung (video/ảnh/carousel);
--     đổi tiêu chí gộp từ "dạng nội dung" (mẫu duyệt) sang "objective" vì đó là số thật đang có. Ghi rõ ở báo cáo.
--   ĐÈN mức CHIẾN DỊCH, 5 trạng thái (QĐ-b). Dải trần = dải giá trị đơn thật quy kết cho chiến dịch (bình quân) → tra
--     cac_toi_da_ky (WP-76). RPC TUYỆT ĐỐI KHÔNG trả con số trần ra client (biên chỉ ở app Tài chính).
--   ⚠ CHƯA có map campaign↔ad trong schema → chưa có đường campaign→đơn thật → don_qua_ket=0 → mọi chiến dịch chỉ ra
--     'khong_do_duoc' (objective dẫn web) hoặc 'chua_du_so' (tin nhắn, 0 đơn). 3 trạng thái con_du/sat_tran/vuot_tran là
--     CƠ CHẾ mở sẵn, với tới khi có đường quy kết (WP-77 vế a CAPI). "XONG CƠ CHẾ", KHÔNG tag XONG (QĐ-a, không lặp WP-79).
--   Ngưỡng cảnh báo lưu bảng ads_nguong có khoảng hiệu lực (QĐ-c, khuôn QD-68/90) — không nhét cứng vào code. Cả 5 [TẠM].
--   ⚠ Cổng backup QD-61 (run_sql.mjs). IDEMPOTENT (add col if not exists · create table if not exists · seed guard · c-or-r func).
--   HOÀN TÁC: drop function ads_bang_ky/ads_tong_so_sanh/ads_viec_phai_lam/ads_nguong_lay/ads_obj_web;
--     drop table ads_nguong; alter table ads_tai_khoan_brand drop column ten_hien_thi.
begin;
create extension if not exists btree_gist;

-- ═══════════════ 1a. ads_tai_khoan_brand + ten_hien_thi (tên hiển thị TK quảng cáo; chưa kéo tên ở lệnh này) ═══════════════
alter table kho.ads_tai_khoan_brand add column if not exists ten_hien_thi text;
comment on column kho.ads_tai_khoan_brand.ten_hien_thi is
  'WP-93: tên hiển thị TK quảng cáo (CEO/kéo sau điền). NULL → UI hiện act_id thô. CẤM bịa tên.';

-- ═══════════════ 1b. ads_nguong — ngưỡng cảnh báo, khoảng hiệu lực (QĐ-c, khuôn db/201/QD-90) ═══════════════
create table if not exists kho.ads_nguong (
  id           bigserial primary key,
  ma           text not null,
  gia_tri      numeric not null,
  hieu_luc_tu  date not null,
  hieu_luc_den date,
  ly_do        text,
  nguoi_ghi    text,
  tao_luc      timestamptz not null default now(),
  check (hieu_luc_den is null or hieu_luc_den >= hieu_luc_tu)
);
alter table kho.ads_nguong drop constraint if exists ads_nguong_khong_chong;
alter table kho.ads_nguong add constraint ads_nguong_khong_chong
  exclude using gist (ma with =, daterange(hieu_luc_tu, coalesce(hieu_luc_den,'infinity'::date), '[]') with &&);
alter table kho.ads_nguong enable row level security;
revoke all on kho.ads_nguong from public, anon;
grant select on kho.ads_nguong to authenticated;
drop policy if exists ads_nguong_doc on kho.ads_nguong;
create policy ads_nguong_doc on kho.ads_nguong for select to authenticated
  using (kho.current_vai_tro() in ('ceo','ke_toan','ads_user'));

-- Seed 5 ngưỡng QĐ-c (guard: chỉ nạp khi ma chưa có khoảng đang mở). hieu_luc_tu = 2026-01-01 [GĐ] để bao data hiện có
--   (như QD-90 lấy đầu mốc); khi CEO đổi ngưỡng → đóng khoảng cũ + mở mới từ ngày đổi.
insert into kho.ads_nguong(ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
select v.ma, v.gt, date '2026-01-01', 'khởi tạo WP-93 [TẠM]', 'he_thong'
from (values
  ('chi_cao_khong_hoi_thoai', 500000),
  ('tang_dot_bien_pct',       50),
  ('tang_dot_bien_tuyet_doi', 300000),
  ('ad_moi_du_ngay',          3),
  ('den_sat_tran_pct',        85)
) as v(ma, gt)
where not exists (select 1 from kho.ads_nguong n where n.ma = v.ma and n.hieu_luc_den is null);
-- Vá dòng [TẠM] đã seed nhầm hieu_luc_tu muộn (chạy lần trước) → kéo về 2026-01-01 để bao data lịch sử.
update kho.ads_nguong set hieu_luc_tu = date '2026-01-01'
  where ly_do = 'khởi tạo WP-93 [TẠM]' and hieu_luc_tu > date '2026-01-01';

-- Đọc ngưỡng đúng NGÀY hiệu lực (khoảng bao ngày p_ngay).
create or replace function kho.ads_nguong_lay(p_ma text, p_ngay date) returns numeric
  language sql stable security definer set search_path = kho as $$
  select gia_tri from kho.ads_nguong
  where ma = p_ma and hieu_luc_tu <= p_ngay and (hieu_luc_den is null or p_ngay <= hieu_luc_den)
  order by hieu_luc_tu desc limit 1
$$;

-- Phân loại objective: có "dẫn web / nền tảng không đóng hội thoại" không (căn cứ đo L-19: OUTCOME_SALES/OFFSITE_CONVERSIONS).
create or replace function kho.ads_obj_web(p text) returns boolean language sql immutable as $$
  select coalesce(p,'') = any(array[
    'OUTCOME_SALES','OFFSITE_CONVERSIONS','OUTCOME_TRAFFIC','LINK_CLICKS','CONVERSIONS',
    'OUTCOME_AWARENESS','REACH','BRAND_AWARENESS','VIDEO_VIEWS','OUTCOME_APP_PROMOTION','PRODUCT_CATALOG_SALES'])
$$;

-- ═══════════════ 1c. ads_bang_ky — MỘT DÒNG/CHIẾN DỊCH + dòng TỔNG. Gộp theo objective. Đèn 5 trạng thái. ═══════════════
create or replace function kho.ads_bang_ky(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_sat numeric; v_dong jsonb; v_tong jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_bang_ky: chỉ ceo/ke_toan/ads_user'; end if;
  v_sat := kho.ads_nguong_lay('den_sat_tran_pct', p_den_ngay);   -- ngưỡng con_du (không lộ ra client)
  with cds as (
    select c.campaign_id, max(c.campaign_name) ten, max(c.objective) objective, max(c.act_id) act_id,
           sum(c.chi_tieu) chi, sum(c.hien_thi) ht, sum(c.luot_bam) lb
    from kho.chi_chien_dich_ngay c
    where c.ngay >= p_tu_ngay and c.ngay <= p_den_ngay
    group by c.campaign_id
  ),
  -- Đường quy kết campaign→đơn thật: CHƯA có map campaign↔ad → 0 đơn (cac/tran = NULL). Mở khi có (WP-77 CAPI).
  attr as ( select campaign_id, 0::int don_qua_ket, null::numeric cac, null::numeric tran from cds ),
  j as (
    select cds.*, a.don_qua_ket, a.cac, a.tran,
      kho.ads_obj_web(cds.objective) web,
      m.ten_hien_thi, m.ten_tai_khoan,
      case when kho.ads_obj_web(cds.objective) then 0 else null end so_hoi_thoai
    from cds join attr a on a.campaign_id = cds.campaign_id
      left join kho.ads_tai_khoan_brand m on m.act_id = cds.act_id and m.hieu_luc_den is null
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', campaign_id, 'campaign_name', ten, 'objective', objective, 'nhom_gop', objective,
      'act_id', act_id, 'ten_tai_khoan', coalesce(ten_hien_thi, ten_tai_khoan),
      'chi', chi, 'luot_hien_thi', ht, 'luot_bam', lb,
      'ctr', case when ht > 0 then round(lb::numeric * 100 / ht, 2) else null end,
      'cpm', case when ht > 0 then round(chi * 1000 / ht) else null end,
      'cpc', case when lb > 0 then round(chi / lb) else null end,
      'so_hoi_thoai', so_hoi_thoai,
      'chi_moi_hoi_thoai', case when coalesce(so_hoi_thoai,0) > 0 then round(chi / so_hoi_thoai) else null end,
      'den', case when web then 'khong_do_duoc'
                  when coalesce(don_qua_ket,0) = 0 then 'chua_du_so'
                  when cac <  tran * v_sat/100.0 then 'con_du'
                  when cac <= tran then 'sat_tran'
                  else 'vuot_tran' end,
      'co_an', (coalesce(chi,0) = 0),
      'hoi_thoai_theo_chien_dich', case when web then 'nen_khong_dong' else 'chua_co_map' end
    ) order by chi desc nulls last), '[]'::jsonb),
    jsonb_build_object(
      'chi', coalesce(sum(chi),0), 'luot_hien_thi', coalesce(sum(ht),0), 'luot_bam', coalesce(sum(lb),0),
      'ctr', case when sum(ht) > 0 then round(sum(lb)::numeric * 100 / sum(ht), 2) else null end,   -- TRÊN TỔNG, không bình quân tỷ lệ
      'cpm', case when sum(ht) > 0 then round(sum(chi) * 1000 / sum(ht)) else null end,
      'cpc', case when sum(lb) > 0 then round(sum(chi) / sum(lb)) else null end,
      'so_chien_dich', count(*))
  into v_dong, v_tong from j;
  return jsonb_build_object('tu', p_tu_ngay, 'den', p_den_ngay, 'nhom', 'objective', 'dong', v_dong, 'tong', v_tong);
end $$;
revoke execute on function kho.ads_bang_ky(date,date) from public, anon;
grant  execute on function kho.ads_bang_ky(date,date) to authenticated;

-- ═══════════════ 1d. ads_tong_so_sanh — kỳ này vs kỳ liền trước CÙNG ĐỘ DÀI + % lệch ═══════════════
create or replace function kho.ads_tong_so_sanh(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_len int; v_ptu date; v_pden date; v_a record; v_b record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_tong_so_sanh: chỉ ceo/ke_toan/ads_user'; end if;
  v_len := (p_den_ngay - p_tu_ngay) + 1;
  v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb
    into v_a from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay;
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb
    into v_b from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden;
  return jsonb_build_object(
    'do_dai_ngay', v_len,
    'ky_nay', jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,'chi',v_a.chi,'hien_thi',v_a.ht,'luot_bam',v_a.lb,
       'ctr', case when v_a.ht>0 then round(v_a.lb::numeric*100/v_a.ht,2) else null end,
       'cpm', case when v_a.ht>0 then round(v_a.chi*1000/v_a.ht) else null end,
       'cpc', case when v_a.lb>0 then round(v_a.chi/v_a.lb) else null end),
    'ky_truoc', jsonb_build_object('tu',v_ptu,'den',v_pden,'chi',v_b.chi,'hien_thi',v_b.ht,'luot_bam',v_b.lb,
       'ctr', case when v_b.ht>0 then round(v_b.lb::numeric*100/v_b.ht,2) else null end,
       'cpm', case when v_b.ht>0 then round(v_b.chi*1000/v_b.ht) else null end,
       'cpc', case when v_b.lb>0 then round(v_b.chi/v_b.lb) else null end),
    'lech_pct', jsonb_build_object(
       'chi', case when v_b.chi>0 then round((v_a.chi-v_b.chi)*100.0/v_b.chi,1) else null end,
       'hien_thi', case when v_b.ht>0 then round((v_a.ht-v_b.ht)*100.0/v_b.ht,1) else null end,
       'luot_bam', case when v_b.lb>0 then round((v_a.lb-v_b.lb)*100.0/v_b.lb,1) else null end));
end $$;
revoke execute on function kho.ads_tong_so_sanh(date,date) from public, anon;
grant  execute on function kho.ads_tong_so_sanh(date,date) to authenticated;

-- ═══════════════ 1e. ads_viec_phai_lam — 3 loại việc, ngưỡng ĐỌC từ ads_nguong, câu giải thích lời thường ═══════════════
create or replace function kho.ads_viec_phai_lam(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_chicao numeric; v_tpct numeric; v_ttd numeric; v_moingay numeric; v_len int; v_ptu date; v_pden date; v_res jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_viec_phai_lam: chỉ ceo/ke_toan/ads_user'; end if;
  v_chicao := kho.ads_nguong_lay('chi_cao_khong_hoi_thoai', p_den_ngay);
  v_tpct   := kho.ads_nguong_lay('tang_dot_bien_pct', p_den_ngay);
  v_ttd    := kho.ads_nguong_lay('tang_dot_bien_tuyet_doi', p_den_ngay);
  v_moingay:= kho.ads_nguong_lay('ad_moi_du_ngay', p_den_ngay);
  v_len := (p_den_ngay - p_tu_ngay) + 1; v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  with cur as (
    select campaign_id, max(campaign_name) ten, max(objective) obj, sum(chi_tieu) chi, min(ngay) tu
    from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay group by campaign_id
  ),
  prev as ( select campaign_id, sum(chi_tieu) chi from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden group by campaign_id ),
  v1 as (  -- chi cao, 0 hội thoại (objective dẫn web → nền không đóng hội thoại)
    select 'chi_cao_khong_hoi_thoai' loai, c.campaign_id, c.ten, c.chi,
      'Chiến dịch "'||coalesce(c.ten,c.campaign_id)||'" chi '||to_char(c.chi,'FM999,999,999')||'đ nhưng không có hội thoại nào đóng ở đây (loại dẫn web) — kiểm xem có đúng ý đồ chạy không.' cau
    from cur c where kho.ads_obj_web(c.obj) and c.chi > v_chicao
  ),
  v2 as (  -- chi tăng đột biến so kỳ trước (chỉ khi kỳ trước có chi > 0)
    select 'chi_tang_dot_bien' loai, c.campaign_id, c.ten, c.chi,
      'Chiến dịch "'||coalesce(c.ten,c.campaign_id)||'" chi tăng '||round((c.chi-p.chi)*100.0/p.chi)||'% (+'||to_char(c.chi-p.chi,'FM999,999,999')||'đ) so kỳ trước — xem có chủ đích không.' cau
    from cur c join prev p on p.campaign_id=c.campaign_id
    where p.chi > 0 and (c.chi-p.chi)*100.0/p.chi > v_tpct and (c.chi-p.chi) > v_ttd
  ),
  v3 as (  -- ad/chiến dịch mới chưa đủ ngày để đánh giá
    select 'ad_moi_chua_du_ngay' loai, c.campaign_id, c.ten, c.chi,
      'Chiến dịch "'||coalesce(c.ten,c.campaign_id)||'" mới xuất hiện '||(p_den_ngay - c.tu + 1)||' ngày — chưa đủ '||v_moingay::int||' ngày để đánh giá, theo dõi thêm.' cau
    from cur c where (p_den_ngay - c.tu + 1) < v_moingay
  )
  select coalesce(jsonb_agg(jsonb_build_object('loai',loai,'campaign_id',campaign_id,'ten',ten,'chi',chi,'cau',cau)),'[]'::jsonb)
    into v_res from (select * from v1 union all select * from v2 union all select * from v3) x;
  return jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,
    'nguong', jsonb_build_object('chi_cao_khong_hoi_thoai',v_chicao,'tang_dot_bien_pct',v_tpct,'tang_dot_bien_tuyet_doi',v_ttd,'ad_moi_du_ngay',v_moingay),
    'viec', v_res);
end $$;
revoke execute on function kho.ads_viec_phai_lam(date,date) from public, anon;
grant  execute on function kho.ads_viec_phai_lam(date,date) to authenticated;

do $$ begin
  if to_regclass('kho.ads_nguong') is null then raise exception 'THIẾU ads_nguong'; end if;
  if to_regprocedure('kho.ads_bang_ky(date,date)') is null then raise exception 'THIẾU ads_bang_ky'; end if;
  if to_regprocedure('kho.ads_tong_so_sanh(date,date)') is null then raise exception 'THIẾU ads_tong_so_sanh'; end if;
  if to_regprocedure('kho.ads_viec_phai_lam(date,date)') is null then raise exception 'THIẾU ads_viec_phai_lam'; end if;
  raise notice 'db/205 OK: ads_nguong(% dòng) + ten_hien_thi + ads_bang_ky/ads_tong_so_sanh/ads_viec_phai_lam.', (select count(*) from kho.ads_nguong);
end $$;
commit;
