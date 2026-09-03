-- WP-11d · sửa DỮ LIỆU: kỳ 2026-08 nhập tay lệch ngay_ap_dung = 2026-07-01 (trùng kỳ 07)
-- → mọi chỗ chọn "kỳ hiện hành" bằng `order by ngay_ap_dung desc limit 1` trả BẤT ĐỊNH,
-- hôm nay trả 2026-07 (số kỳ 7 chảy cho ngữ cảnh tháng 8). Sửa đúng 1 dòng 1 cột + chặn trùng vĩnh viễn.
-- KHÔNG đụng kỳ 07, KHÔNG đụng cột khác, KHÔNG đụng grant/RPC.

do $$
declare v_cu text; v_trung int;
begin
  select to_char(ngay_ap_dung,'YYYY-MM-DD') into v_cu from kho.tham_so_tai_chinh where ma_ky='2026-08';
  -- 3a · UPDATE đúng 1 dòng
  update kho.tham_so_tai_chinh set ngay_ap_dung = date '2026-08-01' where ma_ky='2026-08';
  raise notice 'kỳ 2026-08 ngay_ap_dung: % -> 2026-08-01', v_cu;
  -- 3b · trước khi thêm UNIQUE: còn dòng trùng ngay_ap_dung không?
  select count(*) into v_trung from (select ngay_ap_dung from kho.tham_so_tai_chinh where ngay_ap_dung is not null group by ngay_ap_dung having count(*)>1) t;
  if v_trung <> 0 then raise exception 'còn % ngày trùng — không ép UNIQUE', v_trung; end if;
end $$;

-- 3b · UNIQUE chống trùng ngày (NULL nhiều dòng vẫn cho phép — kỳ chưa đặt ngày)
alter table kho.tham_so_tai_chinh add constraint tstc_ngay_ap_dung_duy_nhat unique (ngay_ap_dung);

-- 3c · CHECK gốc bệnh: tháng của ngay_ap_dung PHẢI khớp ma_ky ('YYYY-MM'). NULL được bỏ qua.
alter table kho.tham_so_tai_chinh add constraint tstc_ngay_khop_ma_ky
  check (ngay_ap_dung is null or to_char(ngay_ap_dung,'YYYY-MM') = ma_ky);

-- 3d · self-check
do $$
declare v_trung int; v_c1 int; v_c2 int;
begin
  select count(*) into v_trung from (select ngay_ap_dung from kho.tham_so_tai_chinh where ngay_ap_dung is not null group by ngay_ap_dung having count(*)>1) t;
  select count(*) into v_c1 from pg_constraint where conname='tstc_ngay_ap_dung_duy_nhat';
  select count(*) into v_c2 from pg_constraint where conname='tstc_ngay_khop_ma_ky';
  if v_trung <> 0 then raise exception 'WP-11d: còn % ngày trùng', v_trung; end if;
  if v_c1 <> 1 or v_c2 <> 1 then raise exception 'WP-11d: thiếu ràng buộc (unique=% check=%)', v_c1, v_c2; end if;
  raise notice 'WP-11d ky OK: 0 ngày trùng · UNIQUE + CHECK có mặt';
end $$;
