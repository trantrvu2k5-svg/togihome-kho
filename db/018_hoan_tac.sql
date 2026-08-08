-- HOÀN TÁC 018 — trả TÊN nhóm + tên mã ván MDF 6LY về đúng bản hiện tại (5LY / "5mm").
--   CHỈ đổi cột ten của kho.nhom + kho.vat_tu. KHÔNG đụng mã (ma), số lượng, giá vốn. Không xoá.
--   Neo bằng id nhóm (ỔN ĐỊNH qua đổi tên) = 666b0933… "GỖ MDF 5LY". Chạy lại nhiều lần được.
--   node ops/run_sql.mjs ../db/018_hoan_tac.sql
begin;

update kho.nhom
   set ten = 'GỖ MDF 5LY'
 where id = '666b0933-e958-4fd9-bdd5-e73bf9857c7e' and ten = 'GỖ MDF 6LY';

update kho.vat_tu
   set ten = replace(ten, '6mm', '5mm')
 where nhom_id = '666b0933-e958-4fd9-bdd5-e73bf9857c7e' and ten like '%6mm%';

commit;
