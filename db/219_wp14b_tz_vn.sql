-- WP-14b · L-2 · MÚI GIỜ DB = Asia/Ho_Chi_Minh; NGÀY NGHIỆP VỤ KHÔNG ĐI QUA UTC.
-- Lý do: SHOW timezone = UTC → now()::date / current_date trả sai ngày mọi lúc 00:00–07:00 VN,
--   làm ~170 chỗ nghiệp vụ SQL sai cùng kiểu (DEFAULT ngày chứng từ · p_ngay null→DB điền ·
--   hạn báo giá · hạn TT · xếp lịch · cảnh báo đặt hàng · cửa sổ N ngày). Sửa GỐC thay vì 170 điểm.
--   Đây là BỆNH LẦN 2 (lần 1: bộ kéo Meta lệch −1 ngày).
-- An toàn (đo L-2 bước 0): 0 CHECK/index/generated dùng now()/current_date (không dòng nào vi phạm khi đổi).
-- ⚠ NỢ NEO PARTITION: su_kien_quet bound cũ neo '+00' (tuyệt đối, KHÔNG dịch). tao_phan_manh_thang
--   (db/081) dùng make_date → SAU đổi TZ, partition MỚI tạo ở VN-midnight (+07), lệch mốc UTC cũ.
--   18 partition có sẵn tới ~2028-01 nên chưa cấp bách; NEO offset '+00' cho hàm ở lệnh sau.

alter database postgres     set timezone to 'Asia/Ho_Chi_Minh';
alter role authenticator    set timezone to 'Asia/Ho_Chi_Minh';
alter role authenticated    set timezone to 'Asia/Ho_Chi_Minh';
alter role anon             set timezone to 'Asia/Ho_Chi_Minh';
alter role service_role      set timezone to 'Asia/Ho_Chi_Minh';
alter role postgres          set timezone to 'Asia/Ho_Chi_Minh';

-- self-check: setting đã ghi vào catalog (session hiện tại chưa đổi — chỉ session MỚI nhận)
do $$
declare n int;
begin
  select count(*) into n from pg_db_role_setting s
    where array_to_string(s.setconfig, ',') ilike '%timezone=%ho_chi_minh%';
  if n < 6 then raise exception 'WP-14b: mới ghi % scope timezone (phải ≥6 = 1 db + 5 role)', n; end if;
  raise notice 'WP-14b: timezone=Asia/Ho_Chi_Minh ghi vào % scope (db+role) — session MỚI sẽ nhận', n;
end $$;
