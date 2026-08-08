-- 018 — SỬA TÊN ván MDF ghi sai độ dày: nhóm "GỖ MDF 5LY" -> "GỖ MDF 6LY", tên mã "5mm" -> "6mm".
--   CEO xác nhận: xưởng dùng MDF 6 ly; nhóm 5LY + tên "5mm" là GHI SAI lúc nhập, không phải ván khác.
--   CHỈ đổi cột ten. MÃ (ma) GIỮ NGUYÊN (kể cả đuôi -5). KHÔNG đụng so_luong / gia_von_bq. Không DELETE/DROP.
--   Neo bằng id nhóm 666b0933… (KHÔNG dùng LIKE '%5LY%' vì "15LY" cũng chứa "5LY").
--   Nhật ký: trigger tg_nk_nhom / tg_nk_vat_tu tự ghi vào nhat_ky_danh_muc — KHÔNG insert tay.
--   Chạy lại nhiều lần được (guard ten=… / like '%5mm%' -> lần 2 khớp 0 dòng, không nhân log).
--   node ops/run_sql.mjs ../db/018_sua_ten_van_6ly.sql
begin;

-- (1) Tên NHÓM: 5LY -> 6LY
update kho.nhom
   set ten = 'GỖ MDF 6LY'
 where id = '666b0933-e958-4fd9-bdd5-e73bf9857c7e' and ten = 'GỖ MDF 5LY';

-- (2) Tên MÃ trong nhóm đó: "…5mm" -> "…6mm" (chỉ sửa phần độ dày; mã giữ nguyên)
update kho.vat_tu
   set ten = replace(ten, '5mm', '6mm')
 where nhom_id = '666b0933-e958-4fd9-bdd5-e73bf9857c7e' and ten like '%5mm%';

commit;
