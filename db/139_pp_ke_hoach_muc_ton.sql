-- 139 — WP-41 (QD-60): phân loại phương pháp kế hoạch cung ứng + mức tồn min/max.
--   Nguồn: ERP Sagegg&Alfnes §8.3 (planning methods) + §7.3.2 (reorder point / order-up-to level).
--   MỘT TẦNG DB: chỉ thêm cột + CHECK + COMMENT + backfill. KHÔNG UI, KHÔNG RPC, KHÔNG đọc bảng sổ.
--
--   ⚠ ton_toi_thieu ĐÃ CÓ TỪ db/001_schema (numeric default 0) — KHÔNG phải cột mới.
--     Đang mang DỮ LIỆU THẬT: 148 mã có mức DƯƠNG (vd BL-01=50, BA-02=2) + 54 mã = 0 (default cũ).
--     CEO 23/08 chốt: TÁI DÙNG cột này làm "mức tồn tối thiểu" của WP-41 —
--       • GIỮ 148 giá trị dương (mức min ai đó đã đặt, còn tốt hơn bắt kho nhập lại);
--       • bỏ default 0 → mã tạo MỚI mang NULL = "chưa đặt mức" (ngữ nghĩa D-11);
--       • 54 số 0 (không phân biệt được "cố ý 0" vs "chưa đặt") → NULL, rơi vào nhóm "chưa có mức" của
--         WP-42; mã nào thật sự không cần dự trữ, kho gõ lại 0 TƯỜNG MINH sau. Đổi ngay TRONG migration.
--
--   • vat_tu.pp_ke_hoach  ∈ (ton_toi_thieu | theo_don | theo_nhu_cau) — NULL = chưa phân loại.
--   • vat_tu.muc_dat_len_toi — MỚI, theo don_vi_co_so; NULL = CHƯA ĐẶT MỨC (≠ 0).
--   • niem_yet.pp_ke_hoach — cùng miền; niem_yet KHÔNG có cờ trưng bày → backfill toàn bộ.
--   • Món tự do 'theo_don' KHÔNG có bảng riêng — chỉ ghi trong QD-60, không đẻ cột ở đơn hàng.
--
--   ⚠ WP-42 (UI) sẽ đọc 3 cột vat_tu này. vat_tu cấp SELECT theo-CỘT (allowlist), 3 cột này CHƯA có
--     SELECT cho authenticated → WP-42 phải tự mở đường đọc (RPC SecDef HOẶC grant select(cột)) —
--     tránh lặp bẫy db/131 (đã vá ở db/138). LÔ NÀY cố ý KHÔNG cấp (chưa UI).
--
--   IDEMPOTENT. HOÀN TÁC:
--     alter table kho.vat_tu drop column pp_ke_hoach, drop column muc_dat_len_toi;
--     alter table kho.vat_tu alter column ton_toi_thieu set default 0;  -- (không khôi phục được 54 số 0 đã →NULL)
--     alter table kho.niem_yet drop column pp_ke_hoach;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══ 1 · vat_tu: cột MỚI pp_ke_hoach + muc_dat_len_toi ═══
alter table kho.vat_tu
  add column if not exists pp_ke_hoach text check (pp_ke_hoach in ('ton_toi_thieu','theo_don','theo_nhu_cau')),
  add column if not exists muc_dat_len_toi numeric check (muc_dat_len_toi >= 0);

-- ═══ 1b · ton_toi_thieu ĐÃ CÓ từ db/001 (default 0) — TÁI DÙNG (CEO 23/08) ═══
alter table kho.vat_tu alter column ton_toi_thieu drop default;      -- mã MỚI: NULL = chưa đặt
do $$ begin                                                          -- db/001 chưa có CHECK >= 0
  if not exists (select 1 from pg_constraint where conname='vat_tu_ton_toi_thieu_khong_am' and conrelid='kho.vat_tu'::regclass) then
    alter table kho.vat_tu add constraint vat_tu_ton_toi_thieu_khong_am check (ton_toi_thieu >= 0);
  end if;
end $$;

-- CHECK liên cột: cả hai NOT NULL → order-up-to >= reorder point (§7.3.2)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vat_tu_muc_max_ge_min' and conrelid = 'kho.vat_tu'::regclass) then
    alter table kho.vat_tu add constraint vat_tu_muc_max_ge_min
      check (ton_toi_thieu is null or muc_dat_len_toi is null or muc_dat_len_toi >= ton_toi_thieu);
  end if;
end $$;

comment on column kho.vat_tu.pp_ke_hoach is
  'WP-41/QD-60 (ERP §8.3): phương pháp kế hoạch cung ứng — ton_toi_thieu | theo_don | theo_nhu_cau. NULL = chưa phân loại.';
comment on column kho.vat_tu.ton_toi_thieu is
  'WP-41/QD-60 (ERP §7.3.2): mức tồn tối thiểu = điểm đặt lại (reorder point), theo don_vi_co_so. NULL = CHƯA ĐẶT MỨC (KHÔNG phải 0 — WP-42 hiện nhóm "chưa có mức"). Tái dùng cột db/001, đã bỏ default 0.';
comment on column kho.vat_tu.muc_dat_len_toi is
  'WP-41/QD-60 (ERP §7.3.2): đặt hàng LÊN TỚI mức này (order-up-to level), theo don_vi_co_so. NULL = CHƯA ĐẶT MỨC. Khi cả hai NOT NULL: muc_dat_len_toi >= ton_toi_thieu.';

-- ═══ 2 · niem_yet: cột pp_ke_hoach (không có cờ trưng bày → backfill toàn bộ ở §3) ═══
alter table kho.niem_yet
  add column if not exists pp_ke_hoach text check (pp_ke_hoach in ('ton_toi_thieu','theo_don','theo_nhu_cau'));
comment on column kho.niem_yet.pp_ke_hoach is
  'WP-41/QD-60: phương pháp kế hoạch cho hàng niêm yết. Mặc định theo_nhu_cau (đóng theo đơn/dự báo). Bảng không có cờ trưng bày → backfill toàn bộ.';

-- ═══ 3 · Backfill (idempotent: chỉ chạm dòng còn NULL / còn 0) ═══
update kho.vat_tu   set pp_ke_hoach = 'ton_toi_thieu' where pp_ke_hoach is null;   -- ván/phụ kiện/sơn đều là vật tư
update kho.niem_yet set pp_ke_hoach = 'theo_nhu_cau'  where pp_ke_hoach is null;   -- toàn bộ (không có cờ trưng bày)
-- ton_toi_thieu: GIỮ 148 giá trị dương; 54 số 0 (default cũ, mơ hồ) → NULL (CEO 23/08). One-time backfill.
update kho.vat_tu set ton_toi_thieu = null where ton_toi_thieu = 0;
-- muc_dat_len_toi: để NULL toàn bộ — kho nhập tay (WP-42).

commit;
