-- db/234 · WP-100 L-100.4 · VÁ THANG ĐỌC (số thật F5 lộ 2 lỗi làm màn nói sai). KHÔNG đụng bảng/cột/dữ liệu.
--   LỖI 1: tầng "bắt đầu xem tụt" mượn ngưỡng CTR (50%) → gần như không bao giờ bắn; tầng dưới (CPM) nói thay.
--           Bằng chứng: nền bắt-đầu-xem 73,2%, "BÀN ĐẢO GỖ GẤP 4/9" 47% (tụt rõ) mà kết luận ra "CPM cao hơn nền".
--           → ngưỡng RIÊNG bat_dau_xem_duoi_nen_phan_tram=80 (dưới 80% nền = tầng 1 đỏ; nền nay → mốc ~58,6%).
--   LỖI 2: "CPM cao hơn nền" không có biên → ~nửa số mẫu đỏ vĩnh viễn, VÀ v77 định nghĩa CPM là "đấu giá đắt lên,
--           KHÔNG phải lỗi mẫu" (không dẫn tới hành động). → (a) biên cpm_tren_nen_phan_tram=130; (b) CPM RỜI thang
--           kết luận, thành GHI CHÚ KÈM. ket_luan và ghi_chu là HAI cột riêng — front-end không ghép hộ.

begin;

-- hieu_luc_tu = 2026-01-01 (KHÔNG current_date): [TẠM] chưa từng có giá trị cũ nào để bảo toàn, lùi là an toàn.
--   Lý do lùi (L-100.5): áp lúc 06/09 → hieu_luc_tu=06/09 → truy vấn den≤05/09 rơi về số CHÔN trong code (nhánh
--   mặc định). Lùi về đầu năm để MỌI truy vấn đọc ngưỡng TỪ BẢNG, rồi xoá nhánh mặc định (bên dưới) — số [TẠM]
--   không được sống vô hình trong code.
insert into kho.ads_nguong (ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
select * from (values
  ('bat_dau_xem_duoi_nen_phan_tram'::text, 80::numeric,  date '2026-01-01', '[TẠM] tỷ lệ bắt-đầu-xem < 80% nền 7 ngày = tầng 1 đỏ (tầng này TRƯỚC ĐÂY mượn ngưỡng CTR nên không bắn)'::text, 'db/234'::text),
  ('cpm_tren_nen_phan_tram'::text,         130::numeric, date '2026-01-01', '[TẠM] CPM > 130% nền mới coi là đắt (ghi chú, KHÔNG phải kết luận — CPM không dẫn tới hành động)'::text,          'db/234'::text)
) v(ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
where not exists (select 1 from kho.ads_nguong n where n.ma = v.ma and n.hieu_luc_den is null);

-- Prod đã áp bản cũ (hieu_luc_tu=06/09) → LÙI hàng đang mở về 2026-01-01. Idempotent (chỉ hàng > mốc). Một hàng mở
--   mỗi ma nên không đụng EXCLUDE gist.
update kho.ads_nguong set hieu_luc_tu = date '2026-01-01'
  where ma in ('bat_dau_xem_duoi_nen_phan_tram', 'cpm_tren_nen_phan_tram')
    and hieu_luc_den is null and hieu_luc_tu > date '2026-01-01';

create or replace function kho.ads_suc_khoe_mau(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  v_tan_suat_do numeric; v_duoi_nen numeric; v_hien_min numeric; v_cut numeric;
  v_bat_dau_nen numeric; v_cut_bat_dau numeric; v_cpm_tren numeric; v_cut_cpm numeric;
  v_nen_ctr numeric; v_nen_cpm numeric; v_nen_bat_dau numeric; v_nen_giu numeric;
  v_so_nen int; v_so_nen_video int;
  v_mau jsonb;
begin
  v_tan_suat_do := kho.ads_nguong_lay('tan_suat_do', p_den_ngay);
  v_duoi_nen    := kho.ads_nguong_lay('ctr_duoi_nen_phan_tram', p_den_ngay);
  v_hien_min    := kho.ads_nguong_lay('hien_thi_toi_thieu_doc', p_den_ngay);
  v_bat_dau_nen := kho.ads_nguong_lay('bat_dau_xem_duoi_nen_phan_tram', p_den_ngay);   -- [L-100.4] tầng 1 có ngưỡng RIÊNG
  v_cpm_tren    := kho.ads_nguong_lay('cpm_tren_nen_phan_tram', p_den_ngay);           -- [L-100.4] biên CPM (ghi chú)
  -- [L-100.5] KHÔNG mặc định chôn trong code: ngưỡng vắng ở bảng là LỖI ỒN, không âm thầm dùng số cũ (đó đúng là
  --   cách một con số [TẠM] sống vô hình). Thiếu bất kỳ ngưỡng nào cho ngày này → dừng thẳng, nói rõ thiếu cái gì.
  if v_tan_suat_do is null or v_duoi_nen is null or v_hien_min is null or v_bat_dau_nen is null or v_cpm_tren is null then
    raise exception 'ads_suc_khoe_mau: thiếu ngưỡng trong ads_nguong cho ngày % (tan_suat_do=% ctr_duoi_nen=% hien_thi_min=% bat_dau_nen=% cpm_tren=%)',
      p_den_ngay, v_tan_suat_do, v_duoi_nen, v_hien_min, v_bat_dau_nen, v_cpm_tren;
  end if;
  v_cut         := v_duoi_nen / 100.0;      -- "dưới nền" CTR
  v_cut_bat_dau := v_bat_dau_nen / 100.0;   -- "dưới nền" bắt-đầu-xem
  v_cut_cpm     := v_cpm_tren / 100.0;      -- "trên nền" CPM

  -- ── NỀN 7 NGÀY: trung bình của CHÍNH các tài khoản này. Hai thước video CHỈ trên mẫu video. ──
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

  with g as (
    select ad_id,
      (array_agg(ad_name order by ngay desc) filter (where ad_name is not null))[1] ten,
      sum(chi_tieu) chi, sum(hien_thi) ht, sum(luot_bam_link) link,
      sum(luot_phat) lp, sum(thruplay) tp,
      avg(tan_suat) filter (where tan_suat is not null) tan_suat,
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
      -- KẾT LUẬN: thang ngoại lệ, DỪNG ở tầng ĐẦU đỏ. CPM ĐÃ RỜI thang (thành ghi_chu).
      case
        when ht is null or ht < v_hien_min then 'chưa đủ số để đọc'
        -- 1) bắt đầu xem tụt (ngưỡng RIÊNG 80% nền; chỉ mẫu video)
        when co_video and v_nen_bat_dau is not null and r_bat_dau is not null
             and r_bat_dau < v_nen_bat_dau * v_cut_bat_dau then 'bắt đầu xem tụt so nền'
        -- 2) CTR link dưới nền
        when v_nen_ctr is not null and ctr is not null
             and ctr < v_nen_ctr * v_cut then 'CTR dưới nền 7 ngày'
        -- 3) xếp hạng dưới trung bình
        when xh_cl like 'BELOW_AVERAGE%' or xh_tt like 'BELOW_AVERAGE%' or xh_cd like 'BELOW_AVERAGE%'
             then 'xếp hạng dưới trung bình'
        -- 4) tần suất vượt → tệp đã mỏi
        when tan_suat is not null and tan_suat > v_tan_suat_do
             then 'tệp đã mỏi (tần suất ' || to_char(tan_suat, 'FM990.0') || ')'
        else 'đang tốt'
      end ket_luan,
      -- GHI CHÚ KÈM: CPM cao hơn nền ×biên. Độc lập với ket_luan (đính kèm dù "đang tốt" hay tầng đỏ).
      case when v_nen_cpm is not null and cpm is not null and cpm > v_nen_cpm * v_cut_cpm
           then 'giá đấu đang đắt hơn nền' end ghi_chu
    from t)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ad_id', ad_id, 'ten', ten, 'chi', chi, 'hien_thi', ht,
      'tan_suat', tan_suat,
      'ty_le_bat_dau_xem', case when co_video then to_jsonb(r_bat_dau) else to_jsonb('không đo được'::text) end,
      'ty_le_giu_xem',     case when co_video then to_jsonb(r_giu)     else to_jsonb('không đo được'::text) end,
      'ctr_link', ctr, 'cpm', cpm,
      'xep_hang_chat_luong', xh_cl, 'xep_hang_tuong_tac', xh_tt, 'xep_hang_chuyen_doi', xh_cd,
      'ket_luan', ket_luan, 'ghi_chu', ghi_chu,
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
    'nguong', jsonb_build_object('tan_suat_do', v_tan_suat_do, 'ctr_duoi_nen_phan_tram', v_duoi_nen,
      'hien_thi_toi_thieu_doc', v_hien_min, 'bat_dau_xem_duoi_nen_phan_tram', v_bat_dau_nen, 'cpm_tren_nen_phan_tram', v_cpm_tren),
    'nen_7ngay', jsonb_build_object(
      'ctr_link', v_nen_ctr, 'cpm', v_nen_cpm,
      'bat_dau_xem', v_nen_bat_dau, 'giu_xem', v_nen_giu,
      'so_mau_trong_nen', v_so_nen, 'so_mau_video_trong_nen', v_so_nen_video),
    'mau', v_mau);
end $$;

-- ── [L-100.5] READER cho MÀN (client không đọc thẳng bảng — QD-96). ──

-- SỔ THAY ĐỔI: 30 ngày, p_so_dong gần nhất. Tên người thực hiện CHE thành chữ đầu "N.V.A" NGAY Ở RPC
--   (DB lưu nguyên; không gửi tên đầy đủ về trình duyệt — app ads không phải sổ nhân sự). Ghép tên tài khoản nếu có map.
create or replace function kho.ads_thay_doi_gan_day(p_so_dong int default 15)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'tong', (select count(*) from kho.ads_thay_doi where event_time >= now() - interval '30 days'),
    'so_tai_khoan', (select count(distinct act_id) from kho.ads_thay_doi where event_time >= now() - interval '30 days'),
    'dong', coalesce((select jsonb_agg(x order by x_luc desc) from (
      select jsonb_build_object(
        'luc', td.event_time, 'act_id', td.act_id, 'ten_tk', tb.ten_hien_thi,
        'viec', coalesce(td.event_type, '—'), 'doi_tuong', td.doi_tuong,
        'nguoi', coalesce(nullif((select string_agg(upper(left(w,1)), '.') from regexp_split_to_table(trim(td.nguoi_thuc_hien), '\s+') w where w <> ''), ''), '—')
      ) x, td.event_time x_luc
      from kho.ads_thay_doi td
      left join kho.ads_tai_khoan_brand tb on tb.act_id = td.act_id and tb.hieu_luc_den is null
      where td.event_time >= now() - interval '30 days'
      order by td.event_time desc limit greatest(p_so_dong, 1)
    ) q), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- TÁCH NỀN TẢNG: gộp theo nền tảng trong khoảng. Trả cờ la_uoc_tinh (đọc từ cột, KHÔNG gõ cứng) + câu ghi chú kèm.
--   %chi = phần trăm TRONG tổng-4-dòng (nội bộ khối), KHÔNG so với tổng chi thật.
create or replace function kho.chi_ads_nen_tang_tong(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb; v_uoc boolean; v_tong numeric;
begin
  select bool_and(la_uoc_tinh), sum(chi_tieu) into v_uoc, v_tong
    from kho.chi_ads_nen_tang_ngay where ngay between p_tu_ngay and p_den_ngay;
  select jsonb_build_object(
    'la_uoc_tinh', coalesce(v_uoc, true),
    'ghi_chu', 'Số tách theo nền tảng là ước tính của Meta. Tổng chi vẫn lấy từ bảng chính.',
    'dong', coalesce((select jsonb_agg(jsonb_build_object(
        'nen_tang', nen_tang, 'chi', chi, 'hien_thi', ht,
        'ctr', case when ht > 0 then round(link::numeric / ht * 100, 2) end,
        'phan_tram_chi', case when v_tong > 0 then round(chi / v_tong * 100, 1) end
      ) order by chi desc) from (
        select nen_tang, sum(chi_tieu) chi, sum(hien_thi) ht, sum(luot_bam_link) link
        from kho.chi_ads_nen_tang_ngay where ngay between p_tu_ngay and p_den_ngay group by nen_tang
      ) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;

grant execute on function kho.ads_thay_doi_gan_day(int), kho.chi_ads_nen_tang_tong(date, date) to authenticated, service_role;

commit;
