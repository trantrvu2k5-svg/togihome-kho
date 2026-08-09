-- 031 — (1) FAIL ĐÓNG khi thiếu he_so_m: chốt giá sàn không được im lặng bỏ qua nữa.
--        (2) Thêm vai trò truong_nhom_sale vào CHECK nguoi_dung (duyệt giảm 5-8%).
--   node ops/run_sql.mjs ../db/031_failclose_hesom_role_truong.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   alter table kho.nguoi_dung drop constraint nguoi_dung_vai_tro_check,
--     add constraint nguoi_dung_vai_tro_check check (vai_tro = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan']));
--   -- (kiem_giam_gia: chạy lại bản 030 để trả về hành vi cũ — bỏ qua khi he_so_m null)
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- (2) Thêm vai trò truong_nhom_sale — KHÔNG đụng ceo/kho/tho (chỉ thêm giá trị hợp lệ mới).
alter table kho.nguoi_dung drop constraint nguoi_dung_vai_tro_check;
alter table kho.nguoi_dung add constraint nguoi_dung_vai_tro_check
  check (vai_tro = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','truong_nhom_sale']));

-- (1) FAIL ĐÓNG — kiem_giam_gia: có món catalog + gia_chot mà thiếu he_so_m -> RAISE (không lưu đơn),
--     thay vì bỏ qua chốt giá sàn. GUC chan.hesom_old='1' -> hành vi CŨ (bỏ qua) — CHỈ để test đối chứng.
create or replace function kho.kiem_giam_gia(d kho.don_hang)
  returns void language plpgsql security definer set search_path = kho as $$
declare
  v_pct numeric; v_tran numeric; v_tran_tn numeric; v_san numeric; v_vt text; v_mon jsonb; v_hesom numeric;
begin
  if d.gia_cong_thuc is null or d.gia_cong_thuc <= 0 then return; end if;
  v_pct := (coalesce(d.chiet_khau,0) / d.gia_cong_thuc) * 100;

  -- CHỐT 3: có giảm mà thiếu lý do
  if current_setting('chan.off_lydo', true) is distinct from '1'
     and v_pct > 0 and coalesce(btrim(d.ly_do_giam),'') = '' then
    raise exception 'Giảm giá phải có lý do (ly_do_giam)';
  end if;

  -- CHỐT 1: giá sàn — FAIL ĐÓNG khi thiếu he_so_m
  if current_setting('chan.off_san', true) is distinct from '1' and d.gia_chot is not null then
    select jsonb_agg(jsonb_build_object('sku', m.sp_id)) into v_mon
      from kho.don_hang_mon m
      where m.don_id = d.id and m.sp_id in (select ma from kho.san_pham_mau_gia_von);
    if v_mon is not null then                        -- có món catalog -> giá sàn PHẢI tính được
      select he_so_m into v_hesom from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
      if v_hesom is null then
        if current_setting('chan.hesom_old', true) = '1' then
          null;                                       -- BẢN CŨ: bỏ qua (khe hở) — chỉ test đối chứng
        else
          raise exception 'Chưa có he_so_m cho kỳ này — không chốt được đơn (chạy tinh_he_so_m)';
        end if;
      else
        v_san := kho.gia_san_don_i(v_mon, coalesce(d.dong,'le'));
        if v_san is not null and d.gia_chot < v_san then
          raise exception 'Giá chốt % dưới giá sàn — không thể chốt (kể cả CEO duyệt)', d.gia_chot;
        end if;
      end if;
    end if;
  end if;

  -- CHỐT 2: trần + thẩm quyền duyệt
  if current_setting('chan.off_tran', true) is distinct from '1' and v_pct > 0 then
    select coalesce(max(kho.tran_giam_gia(m.sp_id, d.dong, coalesce(d.ngay_chot, current_date))),
                    kho.tran_giam_gia(null, d.dong, coalesce(d.ngay_chot, current_date)))
      into v_tran from kho.don_hang_mon m where m.don_id = d.id and m.sp_id is not null;
    v_tran := coalesce(v_tran, kho.tran_giam_gia(null, d.dong, coalesce(d.ngay_chot, current_date)));
    if v_pct > v_tran + 1e-9 then
      if d.ma_ns_duyet_giam is null then
        raise exception 'Giảm % vượt trần % — cần người duyệt', round(v_pct,2)||'%', round(v_tran,2)||'%';
      end if;
      select cap into v_vt from kho.quyen_duyet_giam where ns_id = d.ma_ns_duyet_giam::uuid;
      select tran_truong_nhom into v_tran_tn from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
      if v_vt = 'ceo' then
        null;
      elsif v_vt = 'truong_nhom' then
        if v_pct > coalesce(v_tran_tn,8) + 1e-9 then
          raise exception 'Giảm % vượt quyền trưởng nhóm (%) — cần CEO', round(v_pct,2)||'%', round(v_tran_tn,2)||'%';
        end if;
      else
        raise exception 'Người duyệt "%" không đủ thẩm quyền giảm giá', coalesce(v_vt,'(không rõ)');
      end if;
    end if;
  end if;
end $$;

commit;
