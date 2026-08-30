-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 176 — WP-70 L-02a (QD-76): SỬA MAPPING nguon_khach (LỖI L-01) + mở cửa GUC cho bộ kéo + mốc kéo.
--   (1) nguon_khach: CHỈ mức xác định (ad_id NOT NULL) mới → 'quang_cao'; suy_ref/doi_chieu_lo/khong_biet → 'khac'.
--       Trước: mọi mức ≠ khong_biet → 'quang_cao' = bơm SỐ SUY vào sổ tài chính (màn Kênh&CAC db/115 chia CAC theo nguồn).
--       Nhãn suy GIỮ NGUYÊN trong lead.muc_chac_chan (màn CAC hiện tỷ lệ khong_biet); chỉ nguon_khach phải SẠCH (QD-69/10/15).
--   (2) lead_ghi: thêm cửa GUC kho.lead_he_thong (khuôn WP-21) — bộ kéo nền (vai NULL) đặt GUC mới ghi được. Không mở vai mới.
--   (3) lead_moc_keo: mốc kéo mỗi trang (UPDATE được — MỐC, không append-only) để L-02b không kéo lại từ đầu.
--
--   HOÀN TÁC: khôi phục tao_don + lead_ghi bản db/175 từ git; drop function kho.lead_moc_ghi(text,timestamptz,text,int);
--     drop table kho.lead_moc_keo.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- (1) tao_don — mapping SẠCH. DROP ký cũ TRƯỚC rồi tạo MỘT bản.
drop function if exists kho.tao_don(jsonb, boolean, uuid);
CREATE OR REPLACE FUNCTION kho.tao_don(p_don jsonb, p_chot boolean DEFAULT false, p_lead_id uuid DEFAULT NULL::uuid)
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
      case when p_lead_id is not null then (select case when l.ad_id is not null then 'quang_cao' else 'khac' end from kho.lead l where l.id=p_lead_id) else nullif(btrim(p_don->>'nguon_khach'),'') end,
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

-- (2) lead_ghi — thêm cửa GUC. (create or replace, cùng chữ ký (jsonb) → không overload.)
CREATE OR REPLACE FUNCTION kho.lead_ghi(p_lead jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_dv text; v_last text;
  v_page text := p_lead->>'page_id'; v_ht text := p_lead->>'hoi_thoai_id'; v_id uuid; v_stt bigint;
begin
  if not (v_vai in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then raise exception 'lead_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)'; end if;
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
end $function$;
grant execute on function kho.lead_ghi(jsonb) to authenticated;

-- (3) lead_moc_keo — MỐC kéo mỗi trang (một dòng/trang, UPDATE được). Ghi qua lead_moc_ghi (DEFINER); client chỉ SELECT.
create table if not exists kho.lead_moc_keo (
  page_id                text primary key,
  moc_cap_nhat           timestamptz,
  last_conversation_id   text,
  lan_keo_luc            timestamptz,
  so_ban_ghi_lan_cuoi    int
);
revoke insert, update, delete on kho.lead_moc_keo from public, anon, authenticated;
grant select on kho.lead_moc_keo to authenticated;

create or replace function kho.lead_moc_ghi(p_page_id text, p_moc_cap_nhat timestamptz default null,
    p_last_conversation_id text default null, p_so_ban_ghi int default null)
returns kho.lead_moc_keo language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); r kho.lead_moc_keo;
begin
  if not (v_vai in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'lead_moc_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.lead_he_thong)'; end if;
  if p_page_id is null then raise exception 'lead_moc_ghi: thiếu page_id'; end if;
  insert into kho.lead_moc_keo(page_id, moc_cap_nhat, last_conversation_id, lan_keo_luc, so_ban_ghi_lan_cuoi)
    values(p_page_id, p_moc_cap_nhat, p_last_conversation_id, now(), p_so_ban_ghi)
  on conflict (page_id) do update set
    moc_cap_nhat = excluded.moc_cap_nhat, last_conversation_id = excluded.last_conversation_id,
    lan_keo_luc = now(), so_ban_ghi_lan_cuoi = excluded.so_ban_ghi_lan_cuoi
  returning * into r;
  return r;
end $fn$;
grant execute on function kho.lead_moc_ghi(text, timestamptz, text, int) to authenticated;

commit;
