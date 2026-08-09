-- 034 — ĐƯỜNG GHI giá vốn từ plugin lên Supabase: RPC ghi_gia_von_don + chốt fail-đóng khi đơn thiết kế chưa có giá vốn.
--   node ops/run_sql.mjs ../db/034_ghi_gia_von_don.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.ghi_gia_von_don(text, numeric, numeric, numeric, numeric);
--   alter table kho.don_hang_gia_von drop column if exists nguoi_day;
--   -- kiem_giam_gia: chạy lại bản 031 (bỏ CHỐT 0) — xem git v-kho-25/030.
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- VẾT: ai đẩy giá vốn (lúc nào đã có cap_nhat_luc).
alter table kho.don_hang_gia_von add column if not exists nguoi_day uuid references kho.nguoi_dung(id);

-- RPC ghi giá vốn — guard whitelist FAIL-ĐÓNG ceo/kho/thiet_ke. upsert theo ma_don, kèm vết người đẩy.
create or replace function kho.ghi_gia_von_don(ma_don text, khoi_1 numeric, khoi_2 numeric, khoi_3 numeric, gia_chuyen_giao numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
#variable_conflict use_column
declare v_uid uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke') then   -- NULL/anon/vai lạ -> CHẶN
    raise exception 'ghi_gia_von_don: chỉ ceo/kho/thiet_ke được đẩy giá vốn';
  end if;
  if not exists (select 1 from kho.don_hang d where d.ma_don = ghi_gia_von_don.ma_don) then
    raise exception 'ghi_gia_von_don: không có đơn "%"', ghi_gia_von_don.ma_don;
  end if;
  select nd.id into v_uid from kho.nguoi_dung nd where nd.auth_uid = auth.uid();
  insert into kho.don_hang_gia_von (ma_don, khoi_1, khoi_2, khoi_3, gia_chuyen_giao, nguoi_day, cap_nhat_luc)
    values (ghi_gia_von_don.ma_don, ghi_gia_von_don.khoi_1, ghi_gia_von_don.khoi_2, ghi_gia_von_don.khoi_3,
            ghi_gia_von_don.gia_chuyen_giao, v_uid, now())
  on conflict (ma_don) do update set
    khoi_1 = excluded.khoi_1, khoi_2 = excluded.khoi_2, khoi_3 = excluded.khoi_3,
    gia_chuyen_giao = excluded.gia_chuyen_giao, nguoi_day = excluded.nguoi_day, cap_nhat_luc = excluded.cap_nhat_luc;
  return jsonb_build_object('ok', true, 'ma_don', ghi_gia_von_don.ma_don, 'nguoi_day', v_uid, 'luc', now());
end $$;
grant execute on function kho.ghi_gia_von_don(text, numeric, numeric, numeric, numeric) to authenticated;
revoke all on function kho.ghi_gia_von_don(text, numeric, numeric, numeric, numeric) from anon;

-- Mở rộng kiem_giam_gia: CHỐT 0 — đơn THIẾT KẾ (du_an) chốt mà CHƯA có giá vốn -> FAIL ĐÓNG.
--   Đẩy giá vốn (don_hang_gia_von.gia_chuyen_giao) -> mở khoá. GUC chan.off_von chỉ để test đối chứng.
create or replace function kho.kiem_giam_gia(d kho.don_hang)
  returns void language plpgsql security definer set search_path = kho as $$
declare
  v_pct numeric; v_tran numeric; v_tran_tn numeric; v_san numeric; v_vt text; v_mon jsonb; v_hesom numeric;
begin
  -- CHỐT 0: đơn thiết kế chốt mà chưa có giá vốn -> chặn (đẩy giá vốn từ plugin trước)
  if current_setting('chan.off_von', true) is distinct from '1'
     and d.gia_chot is not null and d.dong = 'du_an'
     and not exists (select 1 from kho.don_hang_gia_von g where g.ma_don = d.ma_don and g.gia_chuyen_giao is not null) then
    raise exception 'Đơn thiết kế "%" chưa có giá vốn — chưa chốt được. Đẩy giá vốn từ plugin lên trước.', d.ma_don;
  end if;

  if d.gia_cong_thuc is null or d.gia_cong_thuc <= 0 then return; end if;
  v_pct := (coalesce(d.chiet_khau,0) / d.gia_cong_thuc) * 100;

  if current_setting('chan.off_lydo', true) is distinct from '1'
     and v_pct > 0 and coalesce(btrim(d.ly_do_giam),'') = '' then
    raise exception 'Giảm giá phải có lý do (ly_do_giam)';
  end if;

  if current_setting('chan.off_san', true) is distinct from '1' and d.gia_chot is not null then
    select jsonb_agg(jsonb_build_object('sku', m.sp_id)) into v_mon
      from kho.don_hang_mon m where m.don_id = d.id and m.sp_id in (select ma from kho.san_pham_mau_gia_von);
    if v_mon is not null then
      select he_so_m into v_hesom from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
      if v_hesom is null then
        if current_setting('chan.hesom_old', true) = '1' then null;
        else raise exception 'Chưa có he_so_m cho kỳ này — không chốt được đơn (chạy tinh_he_so_m)'; end if;
      else
        v_san := kho.gia_san_don_i(v_mon, coalesce(d.dong,'le'));
        if v_san is not null and d.gia_chot < v_san then
          raise exception 'Giá chốt % dưới giá sàn — không thể chốt (kể cả CEO duyệt)', d.gia_chot;
        end if;
      end if;
    end if;
  end if;

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
      if v_vt = 'ceo' then null;
      elsif v_vt = 'truong_nhom' then
        if v_pct > coalesce(v_tran_tn,8) + 1e-9 then
          raise exception 'Giảm % vượt quyền trưởng nhóm (%) — cần CEO', round(v_pct,2)||'%', round(v_tran_tn,2)||'%';
        end if;
      else raise exception 'Người duyệt "%" không đủ thẩm quyền giảm giá', coalesce(v_vt,'(không rõ)'); end if;
    end if;
  end if;
end $$;

commit;
