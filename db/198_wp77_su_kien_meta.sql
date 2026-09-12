-- db/198 · WP-77 vế (a) tầng DB · Hàng đợi sự kiện Meta CAPI + bơm khi đơn chốt. QD-87.
--   Chốt đơn KHÔNG gọi Meta (QD-69 + tốc độ <500ms): chot_don chỉ GHI MỘT DÒNG hàng đợi. Worker (để TẮT) gửi sau.
--   su_kien_meta = HÀNG ĐỢI: PAYLOAD append-only (trigger chặn DELETE + sửa payload), TRẠNG THÁI mutable (cho→da_gui/loi).
--   event_id = ma_don (ổn định, Meta khử trùng). ⚠ Web sconcept.vn bắn pixel qua CÙNG dataset → đếm đôi TREO (QD-87).
--   SĐT băm sha256 theo chuẩn Meta (chữ số + mã QG, BỎ dấu +): '84'||bỏ-số-0-đầu. Dùng LẠI chuan_hoa_sdt (db/190).
--   Giá trị = don_hang.doanh_thu GỒM VAT (QĐ-04 §C). Công tắc meta_capi_bat mặc định FALSE — CẤM tự bật.
--   ⚠ KHÔNG IDEMPOTENT (create table/trigger). Cổng backup QD-61.
--   HOÀN TÁC: drop table kho.su_kien_meta cascade; drop table kho.cau_hinh_meta; drop function sm_lay_cho, sm_danh_dau;
--     + chạy lại db/148 (chot_don bản không enqueue).
begin;

-- ── HÀNG ĐỢI ──
create table kho.su_kien_meta (
  id            uuid primary key default gen_random_uuid(),
  stt           bigserial unique,
  don_id        uuid not null references kho.don_hang(id),
  loai_su_kien  text not null default 'Purchase' check (loai_su_kien in ('Purchase')),
  event_id      text not null,                         -- = ma_don (ổn định — bắn lại cùng đơn cùng id)
  gia_tri       numeric,                               -- doanh_thu GỒM VAT (QĐ-04 §C)
  tien_te       text not null default 'VND',
  sdt_bam       text,                                  -- sha256(mã QG+số, bỏ +) — null nếu đơn không SĐT hợp lệ
  email_bam     text,                                  -- null được
  ad_id         text,                                  -- từ lead (null được, KHÔNG đoán)
  ma_hoi_thoai  uuid,                                  -- = don_hang.lead_id (null được)
  thoi_diem_don timestamptz not null default now(),
  trang_thai    text not null default 'cho' check (trang_thai in ('cho','da_gui','loi')),
  so_lan_thu    int  not null default 0,
  phan_hoi_meta jsonb,
  gui_luc       timestamptz,
  ghi_luc       timestamptz not null default now(),
  unique (don_id, loai_su_kien)                        -- CHỐNG ĐẾM ĐÔI + re-chốt: 1 đơn 1 Purchase
);
create index ix_sm_cho on kho.su_kien_meta (trang_thai, stt) where trang_thai = 'cho';

-- append-only PAYLOAD: chặn DELETE (mọi lúc) + chặn UPDATE nếu ĐỘNG cột payload; CHO đổi cột trạng thái (worker).
create or replace function kho.sm_chan_sua() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'DELETE' then raise exception 'su_kien_meta: hàng đợi append-only — CẤM DELETE (chỉ INSERT + đổi trạng thái)'; end if;
  -- UPDATE: chỉ cho đổi trang_thai/so_lan_thu/phan_hoi_meta/gui_luc. Đụng payload → CẤM.
  if (new.don_id, new.loai_su_kien, new.event_id, new.gia_tri, new.tien_te, new.sdt_bam, new.email_bam, new.ad_id, new.ma_hoi_thoai, new.thoi_diem_don)
     is distinct from
     (old.don_id, old.loai_su_kien, old.event_id, old.gia_tri, old.tien_te, old.sdt_bam, old.email_bam, old.ad_id, old.ma_hoi_thoai, old.thoi_diem_don) then
    raise exception 'su_kien_meta: PAYLOAD append-only — CẤM sửa nội dung (chỉ đổi trạng thái gửi)';
  end if;
  return new;
end $fn$;
create trigger sm_chan_sua before update or delete on kho.su_kien_meta for each row execute function kho.sm_chan_sua();

alter table kho.su_kien_meta enable row level security;
alter table kho.su_kien_meta force row level security;
revoke all on kho.su_kien_meta from public, anon, authenticated;
create policy sm_doc on kho.su_kien_meta for select to authenticated using (kho.current_vai_tro() in ('ceo','ke_toan'));

-- ── CẤU HÌNH (text config; tham_so_van_hanh chỉ chứa numeric nên tách bảng nhỏ) ──
create table kho.cau_hinh_meta (khoa text primary key, gia_tri text, sua_luc timestamptz not null default now());
insert into kho.cau_hinh_meta(khoa, gia_tri) values
  ('meta_capi_bat', 'false'),          -- CÔNG TẮC — mặc định TẮT. Bật là quyết định CEO.
  ('meta_test_event_code', '');        -- có mã → mọi lần gửi kèm (chỉ vào tab thử nghiệm); trống → gửi THẬT
revoke all on kho.cau_hinh_meta from public, anon, authenticated;
create policy chm_doc on kho.cau_hinh_meta for select to authenticated using (kho.current_vai_tro() in ('ceo','ke_toan'));
alter table kho.cau_hinh_meta enable row level security;

-- ── RPC WORKER (đường owner/hệ thống — GUC kho.meta_he_thong, khuôn lead_he_thong) ──
create or replace function kho.sm_lay_cho(p_gioi_han int default 50)
returns setof kho.su_kien_meta language plpgsql security definer set search_path to 'kho' as $fn$
begin
  if not (coalesce(kho.current_vai_tro(),'')='ceo' or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'sm_lay_cho: chỉ ceo hoặc tiến trình hệ thống (GUC kho.meta_he_thong)'; end if;
  return query select * from kho.su_kien_meta where trang_thai='cho' and so_lan_thu < 3 order by stt limit p_gioi_han;
end $fn$;

create or replace function kho.sm_danh_dau(p_id uuid, p_trang_thai text, p_phan_hoi jsonb, p_tang_thu boolean default true)
returns void language plpgsql security definer set search_path to 'kho' as $fn$
begin
  if not (coalesce(kho.current_vai_tro(),'')='ceo' or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'sm_danh_dau: chỉ ceo hoặc tiến trình hệ thống (GUC kho.meta_he_thong)'; end if;
  if p_trang_thai not in ('cho','da_gui','loi') then raise exception 'sm_danh_dau: trạng thái lạ %', p_trang_thai; end if;
  update kho.su_kien_meta set
    trang_thai = p_trang_thai,
    so_lan_thu = so_lan_thu + (case when p_tang_thu then 1 else 0 end),
    phan_hoi_meta = p_phan_hoi,
    gui_luc = case when p_trang_thai='da_gui' then now() else gui_luc end
  where id = p_id;
end $fn$;
revoke execute on function kho.sm_lay_cho(int), kho.sm_danh_dau(uuid,text,jsonb,boolean) from public, anon;
grant  execute on function kho.sm_lay_cho(int), kho.sm_danh_dau(uuid,text,jsonb,boolean) to authenticated;

-- ── chot_don: GIỮ NGUYÊN logic chốt (verbatim db/148) + THÊM enqueue MỘT DÒNG hàng đợi (không gọi Meta). ──
create or replace function kho.chot_don(p_don_id uuid, p_nguon_khach text, p_thuong_hieu text)
  returns jsonb language plpgsql security definer set search_path = kho, public as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang; v_sdt text; v_e164 text; v_ad text;
begin
  if v_vai not in ('ceo','kho','sale','tk_ban_hang') then
    raise exception 'chot_don: chỉ ceo/kho/sale/tk_ban_hang (vai "%")', v_vai; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'chot_don: không có đơn %', p_don_id; end if;
  if v_don.trang_thai = 'moi_len_don' then
    raise exception 'chot_don: đơn "%" ĐÃ lên đơn rồi (moi_len_don)', v_don.ma_don; end if;
  if v_don.trang_thai not in ('bao_gia','bao_gia_treo') then
    raise exception 'chot_don: đơn "%" đang "%" — chỉ chốt được đơn báo giá (bao_gia/bao_gia_treo)', v_don.ma_don, v_don.trang_thai; end if;
  update kho.don_hang
     set nguon_khach = coalesce(nullif(btrim(p_nguon_khach),''), nguon_khach),
         thuong_hieu = coalesce(nullif(btrim(p_thuong_hieu),''), thuong_hieu),
         trang_thai  = 'moi_len_don'
   where id = p_don_id;

  -- [WP-77] HÀNG ĐỢI Meta: 1 dòng Purchase, KHÔNG gọi mạng ở đây. Idempotent (unique don_id+loai) → chống đếm đôi/re-chốt.
  v_sdt  := kho.chuan_hoa_sdt(v_don.sdt_khach);                         -- '0...' local (dùng lại hàm db/190)
  v_e164 := case when v_sdt is not null then '84' || substr(v_sdt, 2) else null end;   -- Meta: mã QG + số, BỎ 0 đầu, KHÔNG dấu +
  select ad_id into v_ad from kho.lead where id = v_don.lead_id;        -- null nếu đơn không lead
  insert into kho.su_kien_meta(don_id, loai_su_kien, event_id, gia_tri, tien_te, sdt_bam, ad_id, ma_hoi_thoai, thoi_diem_don, trang_thai)
    values(p_don_id, 'Purchase', v_don.ma_don, v_don.doanh_thu, 'VND',
           case when v_e164 is not null then encode(extensions.digest(v_e164, 'sha256'), 'hex') else null end,
           v_ad, v_don.lead_id, now(), 'cho')
    on conflict (don_id, loai_su_kien) do nothing;

  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', 'moi_len_don');
end $$;
grant execute on function kho.chot_don(uuid, text, text) to authenticated;

do $$ begin
  if to_regclass('kho.su_kien_meta') is null then raise exception 'THIẾU su_kien_meta'; end if;
  if (select gia_tri from kho.cau_hinh_meta where khoa='meta_capi_bat') <> 'false' then raise exception 'CÔNG TẮC phải mặc định false'; end if;
  raise notice 'db/198 OK: su_kien_meta (hàng đợi) + cau_hinh_meta (công tắc TẮT) + chot_don enqueue.';
end $$;
commit;
