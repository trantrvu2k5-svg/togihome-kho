-- db/232 · WP-100 L-100.2 · TẦNG DB sức khoẻ mẫu quảng cáo (chưa kéo Meta — kéo ở L-100.3).
--   A. cột thước mẫu vào chi_ads_ngay (video NULL = "không đo được", KHÔNG phải 0; 3 xếp hạng là CHỮ).
--   B. sổ thay đổi Meta ads_thay_doi (khoá duy nhất chống ghi trùng khi kéo lại; grant QD-96).
--   C. tách FB/IG chi_ads_nen_tang_ngay (bảng RIÊNG vì breakdown nhân dòng; la_uoc_tinh mặc định true;
--      CẤM dùng tính tổng — tổng luôn lấy từ chi_ads_ngay).
--   D. 3 ngưỡng [TẠM] vào ads_nguong (khoảng hiệu lực, khuôn QD-93).
--   E. RPC ads_suc_khoe_mau — NƠI DUY NHẤT tính (front-end không tính lại).

begin;

-- ── A. CỘT THƯỚC MẪU (chi_ads_ngay) ─────────────────────────────────────────────
--   video: NULL = "không đo được" (mẫu ảnh), KHÔNG mặc định 0. 3 xếp hạng: CHỮ (nhãn Meta), không ép số.
alter table kho.chi_ads_ngay
  add column if not exists tan_suat            numeric,   -- tần suất (impressions/reach) Meta trả theo ngày
  add column if not exists luot_phat           bigint,    -- lượt phát video (video_play_actions)
  add column if not exists thruplay            bigint,    -- xem-hết / ThruPlay
  add column if not exists xem_p25             bigint,
  add column if not exists xem_p50             bigint,
  add column if not exists xem_p75             bigint,
  add column if not exists xem_p100            bigint,
  add column if not exists xep_hang_chat_luong text,      -- quality_ranking (nhãn: ABOVE_AVERAGE / AVERAGE / BELOW_AVERAGE_*)
  add column if not exists xep_hang_tuong_tac  text,      -- engagement_rate_ranking
  add column if not exists xep_hang_chuyen_doi text;      -- conversion_rate_ranking

-- ── B. SỔ THAY ĐỔI META (ads_thay_doi) ──────────────────────────────────────────
create table if not exists kho.ads_thay_doi (
  id              bigint generated always as identity primary key,
  act_id          text        not null,
  event_time      timestamptz not null,
  event_type      text        not null,       -- loại sự kiện Meta (activity_log): update_ad_run_status, update_budget…
  doi_tuong       text,                        -- tên chiến dịch / nhóm / mẫu
  ma_doi_tuong    text,                        -- id đối tượng (campaign/adset/ad id)
  mo_ta           text,                        -- diễn giải thay đổi (extra_data Meta)
  nguoi_thuc_hien text,                        -- actor_name
  tao_luc         timestamptz not null default now()
);
-- khoá duy nhất chống ghi trùng khi KÉO LẠI cùng khoảng. ma_doi_tuong có thể NULL → coalesce về '' cho khoá.
create unique index if not exists ads_thay_doi_khoa
  on kho.ads_thay_doi (act_id, event_time, event_type, coalesce(ma_doi_tuong, ''));

-- ── C. TÁCH FACEBOOK / INSTAGRAM (chi_ads_nen_tang_ngay) — BẢNG RIÊNG ────────────
--   breakdown publisher_platform nhân dòng → KHÔNG nhét vào bảng chính (hỏng tổng).
--   la_uoc_tinh = true: tài liệu Meta ghi số theo breakdown là ƯỚC TÍNH. CẤM dùng bảng này tính tổng chi.
create table if not exists kho.chi_ads_nen_tang_ngay (
  id            bigint generated always as identity primary key,
  act_id        text    not null,
  ad_id         text    not null,
  ngay          date    not null,
  nen_tang      text    not null,              -- facebook / instagram / audience_network / messenger
  chi_tieu      numeric not null,
  hien_thi      bigint,
  luot_bam_link integer,
  tien_te       text    not null,
  la_uoc_tinh   boolean not null default true
);
create unique index if not exists chi_ads_nen_tang_khoa
  on kho.chi_ads_nen_tang_ngay (act_id, ad_id, ngay, nen_tang);

-- GRANT khuôn QD-96: KHÔNG grant thẳng authenticated (mặc định đóng). Client đọc/ghi QUA RPC. Cột A cũng vậy —
--   chi_ads_ngay đã không grant authenticated, cột thêm tự thừa hưởng "đóng".

-- ── D. NGƯỠNG [TẠM] (ads_nguong, khoảng hiệu lực — khuôn QD-93) ──────────────────
insert into kho.ads_nguong (ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
select * from (values
  ('tan_suat_do'::text,             3.5::numeric, current_date, '[TẠM] tần suất > 3,5 = tệp mỏi (một mức chung; quyền đọc tệp lạnh/bám-đuổi bị chặn nên không tách)'::text, 'db/232'::text),
  ('ctr_duoi_nen_phan_tram'::text,  50::numeric,  current_date, '[TẠM] coi là "dưới nền" khi < 50% nền 7 ngày (dùng cho cả tỷ-lệ-bắt-đầu-xem và CTR link)'::text,          'db/232'::text),
  ('hien_thi_toi_thieu_doc'::text,  1000::numeric,current_date, '[TẠM] dưới 1000 hiển thị thì KHÔNG kết luận (chặn báo động giả cho mẫu mới chạy một ngày)'::text,        'db/232'::text)
) v(ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
where not exists (select 1 from kho.ads_nguong n where n.ma = v.ma and n.hieu_luc_den is null);

-- ── E. RPC ads_suc_khoe_mau — NƠI DUY NHẤT TÍNH ─────────────────────────────────
create or replace function kho.ads_suc_khoe_mau(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  v_tan_suat_do numeric; v_duoi_nen numeric; v_hien_min numeric; v_cut numeric;
  v_nen_ctr numeric; v_nen_cpm numeric; v_nen_bat_dau numeric; v_nen_giu numeric;
  v_so_nen int; v_so_nen_video int;
  v_mau jsonb;
begin
  v_tan_suat_do := kho.ads_nguong_lay('tan_suat_do', p_den_ngay);
  v_duoi_nen    := kho.ads_nguong_lay('ctr_duoi_nen_phan_tram', p_den_ngay);
  v_hien_min    := kho.ads_nguong_lay('hien_thi_toi_thieu_doc', p_den_ngay);
  v_cut := coalesce(v_duoi_nen, 50) / 100.0;   -- ngưỡng "dưới nền" dạng tỷ lệ

  -- ── NỀN 7 NGÀY: trung bình CỦA CHÍNH các tài khoản này (7 ngày kết ở p_den_ngay) ──
  --   Từng mẫu gộp trong cửa sổ trước, RỒI trung bình qua mẫu. Nền hai thước VIDEO CHỈ trên mẫu video
  --   (co_video) — gộp mẫu ảnh (luot_phat NULL) vào là kéo nền xuống → báo động giả hàng loạt.
  with per as (
    select ad_id,
      sum(chi_tieu) chi, sum(hien_thi) ht, sum(luot_bam_link) link,
      sum(luot_phat) lp, sum(thruplay) tp,
      bool_or(luot_phat is not null) co_video
    from kho.chi_ads_ngay
    where ngay between (p_den_ngay - 6) and p_den_ngay
    group by ad_id)
  select
    avg(link::numeric / nullif(ht,0)) filter (where ht > 0),
    avg(chi / nullif(ht,0) * 1000)    filter (where ht > 0),
    avg(lp::numeric / nullif(ht,0))   filter (where co_video and ht > 0),
    avg(tp::numeric / nullif(lp,0))   filter (where co_video and lp > 0),
    count(*) filter (where ht > 0),
    count(*) filter (where co_video and ht > 0)
    into v_nen_ctr, v_nen_cpm, v_nen_bat_dau, v_nen_giu, v_so_nen, v_so_nen_video
  from per;

  -- ── TỪNG MẪU trong [p_tu_ngay, p_den_ngay] ──
  with g as (
    select ad_id,
      (array_agg(ad_name order by ngay desc) filter (where ad_name is not null))[1] ten,
      sum(chi_tieu) chi, sum(hien_thi) ht, sum(luot_bam_link) link,
      sum(luot_phat) lp, sum(thruplay) tp,
      avg(tan_suat) filter (where tan_suat is not null) tan_suat,  -- [proxy] TB tần suất ngày (thiếu reach để cộng dồn)
      bool_or(luot_phat is not null) co_video,
      (array_agg(xep_hang_chat_luong order by ngay desc) filter (where xep_hang_chat_luong is not null))[1] xh_cl,
      (array_agg(xep_hang_tuong_tac  order by ngay desc) filter (where xep_hang_tuong_tac  is not null))[1] xh_tt,
      (array_agg(xep_hang_chuyen_doi order by ngay desc) filter (where xep_hang_chuyen_doi is not null))[1] xh_cd
    from kho.chi_ads_ngay
    where ngay between p_tu_ngay and p_den_ngay
    group by ad_id),
  t as (
    select g.*,
      case when ht > 0 then link::numeric / ht end ctr,
      case when ht > 0 then chi / ht * 1000 end cpm,
      case when co_video and ht > 0 then lp::numeric / ht end r_bat_dau,
      case when co_video and lp > 0 then tp::numeric / lp end r_giu
    from g),
  k as (
    select t.*,
      -- KẾT LUẬN: thang ngoại lệ, DỪNG ở tầng ĐẦU đỏ. Nhãn "chưa đủ số" / "không đo được" KHÔNG lẫn tầng lỗi.
      case
        when ht is null or ht < coalesce(v_hien_min, 1000) then 'chưa đủ số để đọc'
        -- 1) bắt đầu xem tụt (chỉ mẫu video, cần nền video)
        when co_video and v_nen_bat_dau is not null and r_bat_dau is not null
             and r_bat_dau < v_nen_bat_dau * v_cut then 'bắt đầu xem tụt so nền'
        -- 2) CTR link dưới nền
        when v_nen_ctr is not null and ctr is not null
             and ctr < v_nen_ctr * v_cut then 'CTR dưới nền 7 ngày'
        -- 3) CPM cao hơn nền
        when v_nen_cpm is not null and cpm is not null
             and cpm > v_nen_cpm then 'CPM cao hơn nền'
        -- 4) xếp hạng dưới trung bình (bất kỳ 1 trong 3)
        when xh_cl like 'BELOW_AVERAGE%' or xh_tt like 'BELOW_AVERAGE%' or xh_cd like 'BELOW_AVERAGE%'
             then 'xếp hạng dưới trung bình'
        -- 5) tần suất vượt → tệp đã mỏi
        when tan_suat is not null and tan_suat > coalesce(v_tan_suat_do, 3.5)
             then 'tệp đã mỏi (tần suất ' || to_char(tan_suat, 'FM990.0') || ')'
        else 'đang tốt'
      end ket_luan
    from t)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ad_id', ad_id, 'ten', ten, 'chi', chi, 'hien_thi', ht,
      'tan_suat', tan_suat,
      -- video: số HOẶC nhãn "không đo được" (mẫu ảnh). KHÔNG ra 0.
      'ty_le_bat_dau_xem', case when co_video then to_jsonb(r_bat_dau) else to_jsonb('không đo được'::text) end,
      'ty_le_giu_xem',     case when co_video then to_jsonb(r_giu)     else to_jsonb('không đo được'::text) end,
      'ctr_link', ctr, 'cpm', cpm,
      'xep_hang_chat_luong', xh_cl, 'xep_hang_tuong_tac', xh_tt, 'xep_hang_chuyen_doi', xh_cd,
      'ket_luan', ket_luan,
      -- tách nền tảng: đọc bảng RIÊNG → BẮT BUỘC kèm cờ ước tính; tổng chi Ở TRÊN vẫn từ bảng chính.
      'tach_nen_tang', (
        select case when count(*) = 0 then null else jsonb_build_object(
          'la_uoc_tinh', true,
          'ghi_chu', 'số tách nền tảng là ƯỚC TÍNH; tổng chi lấy từ bảng chính',
          'theo_nen_tang', jsonb_agg(jsonb_build_object('nen_tang', nt, 'chi', c) order by nt))
        end
        from (select nen_tang nt, sum(chi_tieu) c from kho.chi_ads_nen_tang_ngay ntg
              where ntg.ad_id = k.ad_id and ntg.ngay between p_tu_ngay and p_den_ngay
              group by nen_tang) s)
    ) order by chi desc nulls last), '[]'::jsonb) into v_mau from k;

  return jsonb_build_object(
    'khoang', jsonb_build_object('tu', p_tu_ngay, 'den', p_den_ngay),
    'nguong', jsonb_build_object('tan_suat_do', v_tan_suat_do, 'ctr_duoi_nen_phan_tram', v_duoi_nen, 'hien_thi_toi_thieu_doc', v_hien_min),
    'nen_7ngay', jsonb_build_object(
      'ctr_link', v_nen_ctr, 'cpm', v_nen_cpm,
      'bat_dau_xem', v_nen_bat_dau, 'giu_xem', v_nen_giu,      -- CHỈ trên mẫu video
      'so_mau_trong_nen', v_so_nen, 'so_mau_video_trong_nen', v_so_nen_video),
    'mau', v_mau);
end $$;

grant execute on function kho.ads_suc_khoe_mau(date, date) to authenticated, service_role;

commit;
