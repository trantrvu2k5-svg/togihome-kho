-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 175 — WP-70 L-01 (QD-73/74/75): SỔ LEAD (prospect Pancake) append-only + danh mục chu_de đóng + tao_don nhận lead.
--   ERP 5.5.1: prospect ở chức năng RIÊNG, tách khỏi customer/order; thắng → chuyển thành khách. lead = prospect.
--   KHÔNG UI, KHÔNG mạng (chưa gọi Pancake — bộ kéo là L-02). Bảng để RỖNG (CEO điền chu_de tay; lead do L-02 kéo).
--   ⚠ CẤM cột nội dung tin nhắn trong lead (không thêm, không để dành).
--
--   HOÀN TÁC: drop function kho.tao_don(jsonb,boolean,uuid); (khôi phục bản (jsonb,boolean) từ git);
--     alter table kho.don_hang drop column lead_id;
--     drop function kho.lead_ghi(jsonb); drop view kho.v_lead_hien_hanh;
--     drop table kho.lead; drop sequence kho.lead_stt_seq; drop table kho.chu_de;
--     drop function kho.chu_de_cam_sua() cascade;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (a) chu_de — DANH MỤC ĐÓNG (QD-74). Sửa = TÁCH KHOẢNG + lý do (khuôn QD-68); CẤM UPDATE đè ma/ten.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists kho.chu_de (
  ma          text primary key,
  ten         text not null,
  hieu_luc_tu date not null default current_date,
  hieu_luc_den date,
  ly_do       text,
  dang_bat    boolean not null default true
);
-- CẤM sửa đè ma/ten (đóng): chỉ được đổi hieu_luc_den/dang_bat/ly_do (để tách khoảng). Đổi tên = mã mới.
create or replace function kho.chu_de_cam_sua() returns trigger language plpgsql set search_path to 'kho' as $fn$
begin
  if NEW.ma <> OLD.ma or NEW.ten <> OLD.ten then
    raise exception 'chu_de: CẤM sửa đè ma/ten — danh mục ĐÓNG, sửa = tách khoảng (đóng hieu_luc_den cũ + mã mới), khuôn QD-68';
  end if;
  return NEW;
end $fn$;
drop trigger if exists trg_chu_de_cam_sua on kho.chu_de;
create trigger trg_chu_de_cam_sua before update on kho.chu_de for each row execute function kho.chu_de_cam_sua();
-- Seed 0 dòng — CEO điền 5–8 chủ đề sau (việc tay).
grant select on kho.chu_de to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (b) lead — SỔ APPEND-ONLY (khuôn giao_dich db/119 · QD-44/75). CẤM cột nội dung tin nhắn.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists kho.lead (
  id                   uuid primary key default gen_random_uuid(),
  stt                  bigint not null,                          -- "dòng cuối" tường minh (bài học WP-11)
  nguon                text not null default 'pancake',
  page_id              text not null,
  hoi_thoai_id         text not null,
  khach_pancake_id     text,
  loai                 text check (loai in ('inbox','comment','rating')),
  thoi_diem_hoi_thoai  timestamptz not null,
  luong                text not null check (luong in ('qua_web','mess_truc_tiep','khong_biet')),
  chu_de_ma            text references kho.chu_de(ma),
  muc_chac_chan        text not null check (muc_chac_chan in ('xac_dinh','suy_ref','doi_chieu_lo','khong_biet')),
  ad_id                text,
  ref_web              text,
  sdt                  text,
  dau_van              text not null,                            -- hash tập trường theo dõi (khử trùng)
  ghi_nhan_luc         timestamptz not null default now()
);
create sequence if not exists kho.lead_stt_seq owned by kho.lead.stt;
select setval('kho.lead_stt_seq', coalesce((select max(stt) from kho.lead),0)+1, false);
alter table kho.lead alter column stt set default nextval('kho.lead_stt_seq');
create unique index if not exists uq_lead_stt on kho.lead(stt);
create index if not exists ix_lead_ht_stt on kho.lead(page_id, hoi_thoai_id, stt desc);
create index if not exists ix_lead_thoi_diem on kho.lead(thoi_diem_hoi_thoai);

-- append-only: revoke ghi/sửa/xoá của MỌI vai qua PostgREST; chỉ SELECT (RLS) + lead_ghi (DEFINER owner) ghi.
alter table kho.lead enable row level security;
revoke insert, update, delete on kho.lead from public, anon, authenticated;
drop policy if exists lead_doc on kho.lead;
create policy lead_doc on kho.lead for select using (kho.current_vai_tro() is not null);

-- (c) view hiện hành = mỗi (page_id, hoi_thoai_id) lấy dòng stt LỚN NHẤT.
create or replace view kho.v_lead_hien_hanh as
  select distinct on (page_id, hoi_thoai_id) *
  from kho.lead
  order by page_id, hoi_thoai_id, stt desc;
grant select on kho.v_lead_hien_hanh to authenticated;

-- (d) lead_ghi — CỬA GHI DUY NHẤT. Tự tính dau_van; trùng dòng hiện hành → 'khong_doi' (idempotent, khuôn WP-33).
create or replace function kho.lead_ghi(p_lead jsonb)
returns jsonb language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_dv text; v_last text;
  v_page text := p_lead->>'page_id'; v_ht text := p_lead->>'hoi_thoai_id'; v_id uuid; v_stt bigint;
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'lead_ghi: chỉ ceo/ke_toan'; end if;
  if v_page is null or v_ht is null then raise exception 'lead_ghi: thiếu page_id/hoi_thoai_id'; end if;
  v_dv := md5(concat_ws('|', coalesce(p_lead->>'nguon','pancake'), v_page, v_ht,
     p_lead->>'khach_pancake_id', p_lead->>'loai', p_lead->>'thoi_diem_hoi_thoai',
     p_lead->>'luong', p_lead->>'chu_de_ma', p_lead->>'muc_chac_chan',
     p_lead->>'ad_id', p_lead->>'ref_web', p_lead->>'sdt'));
  select dau_van into v_last from kho.lead where page_id=v_page and hoi_thoai_id=v_ht order by stt desc limit 1;
  if v_last is not null and v_last = v_dv then return jsonb_build_object('ket','khong_doi'); end if;
  insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,chu_de_ma,muc_chac_chan,ad_id,ref_web,sdt,dau_van)
  values(coalesce(nullif(p_lead->>'nguon',''),'pancake'), v_page, v_ht,
     nullif(p_lead->>'khach_pancake_id',''), nullif(p_lead->>'loai',''),
     (p_lead->>'thoi_diem_hoi_thoai')::timestamptz, p_lead->>'luong',
     nullif(p_lead->>'chu_de_ma',''), p_lead->>'muc_chac_chan',
     nullif(p_lead->>'ad_id',''), nullif(p_lead->>'ref_web',''), nullif(p_lead->>'sdt',''), v_dv)
  returning id, stt into v_id, v_stt;
  return jsonb_build_object('ket','da_ghi','id',v_id,'stt',v_stt);
end $fn$;
grant execute on function kho.lead_ghi(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (e) tao_don nhận p_lead_id — DROP ký cũ TRƯỚC (tránh overload ambiguous, 03 §C / 04 §D) rồi tạo MỘT bản.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
alter table kho.don_hang add column if not exists lead_id uuid references kho.lead(id);
drop function if exists kho.tao_don(jsonb, boolean);
CREATE OR REPLACE FUNCTION kho.tao_don(p_don jsonb, p_chot boolean DEFAULT false, p_lead_id uuid DEFAULT NULL)
 RETURNS TABLE(id uuid, ma_don text, trang_thai text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho', 'public'
AS $function$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ma  text := nullif(btrim(p_don->>'ma_don'),'');
  v_id  uuid;
begin
  -- 1) VAI: chỉ sale/ceo (theo current_vai_tro → auth_uid, KHÔNG map nguoi_dung.id).
  if v_vai not in ('sale','ceo') then
    raise exception 'tao_don: chỉ sale/ceo được tạo đơn (vai "%")', v_vai; end if;
  -- 2) MÃ ĐƠN do client sinh (giữ nguyên cách sinh); RPC chỉ gác THIẾU + TRÙNG, lỗi rõ chữ, không nuốt.
  if v_ma is null then raise exception 'tao_don: thiếu ma_don'; end if;
  if exists (select 1 from kho.don_hang d where d.ma_don = v_ma) then
    raise exception 'tao_don: mã đơn "%" đã tồn tại — không tạo trùng', v_ma; end if;
  -- 3) INSERT: trang_thai HARD-CODE 'bao_gia'. Nhận đúng bộ trường client gửi (donToRow) TRỪ trang_thai.
  --    nguoi_tao: server tự gán current_ns() (không tin client). Trigger BEFORE INSERT (gan_sale_phu_trach,
  --    moc_bao_gia, dong_bo_khach, giu_hen_ban_dau, kiem_chuyen…) vẫn chạy như thường.
  insert into kho.don_hang(
    ma_don, trang_thai,
    ngay_chot, thuong_hieu, sdt_khach, ten_khach, tinh_khach, dia_chi_khach,
    dong, loai, chiet_khau, gia_cong_thuc, gia_chot, ma_ns_duyet_giam, ly_do_giam,
    ly_do_huy, ly_do_thua, ghi_chu_thua, tk_coc, tien_coc, so_tien_thuc_thu,
    lap_ai, file_tk, gio_thiet_ke, nguoi_tk, don_vi_van_chuyen, khoi_luong_kg, dia_ban,
    ship_thuc_tra, lap_thuc_tra, ngay_di_hang, ngay_giao, ngay_du_kien, ngay_hen_khach,
    lo, ghi_chu, link, phong_cach, ngan_sach_trieu, tu_dung, nguon_khach,
    kgs, hoa_don, nguoi_tao, lead_id)
  values(
    v_ma, 'bao_gia',
    nullif(p_don->>'ngay_chot','')::date, nullif(btrim(p_don->>'thuong_hieu'),''),
      nullif(btrim(p_don->>'sdt_khach'),''), nullif(btrim(p_don->>'ten_khach'),''),
      nullif(btrim(p_don->>'tinh_khach'),''), nullif(btrim(p_don->>'dia_chi_khach'),''),
    nullif(btrim(p_don->>'dong'),''), nullif(btrim(p_don->>'loai'),''),
      nullif(p_don->>'chiet_khau','')::numeric, nullif(p_don->>'gia_cong_thuc','')::numeric,
      nullif(p_don->>'gia_chot','')::numeric, nullif(btrim(p_don->>'ma_ns_duyet_giam'),''),
      nullif(btrim(p_don->>'ly_do_giam'),''),
    nullif(btrim(p_don->>'ly_do_huy'),''), nullif(btrim(p_don->>'ly_do_thua'),''),
      nullif(btrim(p_don->>'ghi_chu_thua'),''), nullif(btrim(p_don->>'tk_coc'),''),
      nullif(p_don->>'tien_coc','')::numeric, nullif(p_don->>'so_tien_thuc_thu','')::numeric,
    nullif(btrim(p_don->>'lap_ai'),''), nullif(btrim(p_don->>'file_tk'),''),
      nullif(p_don->>'gio_thiet_ke','')::numeric, nullif(btrim(p_don->>'nguoi_tk'),''),
      nullif(btrim(p_don->>'don_vi_van_chuyen'),''), nullif(p_don->>'khoi_luong_kg','')::numeric,
      nullif(btrim(p_don->>'dia_ban'),''),
    nullif(p_don->>'ship_thuc_tra','')::numeric, nullif(p_don->>'lap_thuc_tra','')::numeric,
      nullif(p_don->>'ngay_di_hang','')::date, nullif(p_don->>'ngay_giao','')::date,
      nullif(p_don->>'ngay_du_kien','')::date, nullif(p_don->>'ngay_hen_khach','')::date,
    nullif(btrim(p_don->>'lo'),''), nullif(btrim(p_don->>'ghi_chu'),''),
      nullif(btrim(p_don->>'link'),''), nullif(btrim(p_don->>'phong_cach'),''),
      nullif(p_don->>'ngan_sach_trieu','')::numeric, coalesce((p_don->>'tu_dung')::boolean, false),
      case when p_lead_id is not null then (select case when l.muc_chac_chan='khong_biet' then 'khac' else 'quang_cao' end from kho.lead l where l.id=p_lead_id) else nullif(btrim(p_don->>'nguon_khach'),'') end,
    case when jsonb_typeof(p_don->'kgs') = 'array'
         then array(select jsonb_array_elements_text(p_don->'kgs')) end,
    case when jsonb_typeof(p_don->'hoa_don') in ('object','array') then p_don->'hoa_don' end,
    coalesce(nullif(p_don->>'nguoi_tao','')::uuid, kho.current_ns()), p_lead_id)
  returning don_hang.id into v_id;
  -- 4) CHỐT tuỳ chọn — CÙNG transaction. chot_don (db/148) RAISE (thiếu nguồn/thương hiệu, món giá…) thì
  --    exception nổi ra khỏi tao_don → cả INSERT rollback theo (không để đơn cụt). KHÔNG bọc EXCEPTION.
  if p_chot then
    perform kho.chot_don(v_id, nullif(btrim(p_don->>'nguon_khach'),''), nullif(btrim(p_don->>'thuong_hieu'),''));
  end if;
  -- 5) trả id + ma_don + trạng thái CUỐI (bao_gia nếu không chốt, moi_len_don nếu chốt).
  return query select d.id, d.ma_don, d.trang_thai from kho.don_hang d where d.id = v_id;
end $function$;
grant execute on function kho.tao_don(jsonb, boolean, uuid) to authenticated;

commit;
