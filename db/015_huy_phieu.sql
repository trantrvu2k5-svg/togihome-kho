-- 015 — HUỶ PHIẾU BẰNG PHIẾU NGƯỢC. Huỷ = THÊM phiếu ngược + đảo tác động, KHÔNG xoá dòng nào.
--   Chạy lại nhiều lần được (idempotent: drop/add constraint, add column if not exists, create or replace function).
--   node ops/run_sql.mjs ../db/015_huy_phieu.sql
begin;

-- ── CẤU TRÚC ──────────────────────────────────────────────────────────
-- (1) trang_thai nhận thêm 'da_huy' (phiếu gốc bị huỷ mang trạng thái này; phiếu ngược vẫn 'ghi_so').
alter table kho.phieu drop constraint if exists phieu_trang_thai_check;
alter table kho.phieu add  constraint phieu_trang_thai_check
  check (trang_thai in ('nhap','ghi_so','da_huy'));

-- (2) lo_nhap.lo_da_huy: đánh dấu lô thuộc phiếu bị huỷ. CẤM xoá dòng lô — chỉ gắn cờ + con_lai=0.
alter table kho.lo_nhap add column if not exists lo_da_huy boolean not null default false;

-- (3) Quyền CỘT mới: lo_nhap hiện chỉ cấp SELECT (theo cột) cho anon+authenticated → cấp y hệt, KHÔNG rộng hơn.
--     (write vào lo_nhap chỉ qua hàm security-definer nên không cần grant insert/update.)
grant select (lo_da_huy) on kho.lo_nhap to anon, authenticated;

-- (4) cap_so_phieu đã generic (dùng p_loai làm tiền tố) → HN/HX chạy ngay, KHÔNG cần sửa.
-- (5) policy phieu_sua_nhap = UPDATE khi (ceo/kho AND trang_thai='nhap'): thêm 'da_huy' KHÔNG đụng nó;
--     nó vẫn chỉ cho app sửa trực tiếp phiếu 'nhap' (nháp). huy_phieu chạy SECURITY DEFINER nên bỏ qua RLS,
--     đổi trang_thai 'ghi_so'->'da_huy' không bị policy này chặn. Không cần sửa policy.

-- ── HÀM HUỶ PHIẾU ─────────────────────────────────────────────────────
create or replace function kho.huy_phieu(p_so_phieu text, p_ly_do text)
  returns text language plpgsql security definer set search_path = kho as $$
declare
  vt text; uid uuid; kid uuid; g record; sp_ng text; pid_ng uuid;
  vid uuid; qty numeric; newton numeric; newgia numeric; rec record;
begin
  vt := current_vai_tro();
  if vt is null or vt not in ('ceo','kho') then raise exception 'Chỉ CEO/kho được huỷ phiếu'; end if;
  if p_ly_do is null or btrim(p_ly_do) = '' then
    raise exception 'Phải nhập lý do huỷ (sổ lệch mà không rõ vì sao thì vô dụng)'; end if;

  select * into g from phieu where so_phieu = p_so_phieu;
  if not found then raise exception 'Không có phiếu %', p_so_phieu; end if;
  if g.trang_thai = 'da_huy' then raise exception 'Phiếu % đã bị huỷ rồi — không huỷ hai lần', p_so_phieu; end if;
  if g.trang_thai <> 'ghi_so' then
    raise exception 'Chỉ huỷ được phiếu ĐÃ GHI SỔ — phiếu % đang ở trạng thái "%"', p_so_phieu, g.trang_thai; end if;

  kid := g.kho_id;
  select id into uid from nguoi_dung where auth_uid = auth.uid();

  -- KIỂM TRA QUAN TRỌNG NHẤT: phiếu NHẬP mà lô đã bị xuất một phần → CẤM huỷ, phải dùng phiếu điều chỉnh.
  if g.loai = 'nhap' then
    for rec in select l.con_lai, l.so_luong_nhap, v.ma
               from lo_nhap l join vat_tu v on v.id = l.vat_tu_id
               where l.phieu_id = g.id loop
      if rec.con_lai < rec.so_luong_nhap then
        raise exception 'Không huỷ được: lô của mã % đã xuất % (còn %/% cái). Phải dùng phiếu ĐIỀU CHỈNH thay vì huỷ.',
          rec.ma, (rec.so_luong_nhap - rec.con_lai), rec.con_lai, rec.so_luong_nhap;
      end if;
    end loop;
  end if;

  -- Phiếu ngược: mã HN (huỷ nhập) / HX (huỷ xuất), trạng thái ghi_so, trỏ phiếu gốc.
  sp_ng := cap_so_phieu(case when g.loai = 'nhap' then 'HN' else 'HX' end);
  insert into phieu(so_phieu, loai, kho_id, trang_thai, ncc_id, ly_do, phieu_goc_id, ghi_so_luc, ghi_so_boi, nguoi_thao_tac)
    values(sp_ng, 'dieu_chinh', kid, 'ghi_so', g.ncc_id, p_ly_do, g.id, now(), uid, uid)
    returning id into pid_ng;
  -- Dòng đảo dấu của phiếu gốc.
  insert into phieu_dong(phieu_id, vat_tu_id, so_luong, don_gia, thanh_tien, ncc_id, ly_do)
    select pid_ng, pd.vat_tu_id, -pd.so_luong, pd.don_gia,
           case when pd.thanh_tien is not null then -pd.thanh_tien end, pd.ncc_id, p_ly_do
    from phieu_dong pd where pd.phieu_id = g.id;

  if g.loai = 'nhap' then
    -- HUỶ NHẬP: mỗi mã → gắn lo_da_huy, con_lai=0, trừ ton, TÍNH LẠI giá vốn từ lô CÒN SỐNG.
    for vid in select distinct l.vat_tu_id from lo_nhap l where l.phieu_id = g.id loop
      select coalesce(sum(so_luong_nhap),0) into qty from lo_nhap where phieu_id = g.id and vat_tu_id = vid;
      update lo_nhap set lo_da_huy = true, con_lai = 0 where phieu_id = g.id and vat_tu_id = vid;
      update ton set so_luong = so_luong - qty, sua_luc = now()
        where vat_tu_id = vid and kho_id = kid returning so_luong into newton;
      -- giá vốn = Σ(con_lai*gia_von_lo) / Σ con_lai của lô SỐNG có giá (KHÔNG nghịch đảo công thức bình quân).
      select case when coalesce(sum(con_lai) filter (where gia_von_lo is not null), 0) > 0
                  then round( sum(con_lai * gia_von_lo) filter (where gia_von_lo is not null)
                            / sum(con_lai)              filter (where gia_von_lo is not null) )
                  else null end
        into newgia
        from lo_nhap where vat_tu_id = vid and kho_id = kid and lo_da_huy = false and con_lai > 0;
      update ton set gia_von_bq = newgia, sua_luc = now() where vat_tu_id = vid and kho_id = kid;
      insert into giao_dich(vat_tu_id, kho_id, loai, so_luong, phieu_id, so_du_sau, nguon, canh_bao, nguoi_thao_tac)
        values(vid, kid, 'dieu_chinh', -qty, pid_ng, newton, 'phieu', case when newton < 0 then 'ton_am' end, uid);
    end loop;
  else
    -- HUỶ XUẤT: cộng trả con_lai về đúng lô đã bị trừ (theo giao_dich gốc có lo_nhap_id), cộng lại ton.
    for rec in select lo_nhap_id, so_luong from giao_dich where phieu_id = g.id and lo_nhap_id is not null loop
      update lo_nhap set con_lai = con_lai + (-rec.so_luong) where id = rec.lo_nhap_id;   -- so_luong âm (xuất) → cộng trả
    end loop;
    for rec in select vat_tu_id as vid, sum(-so_luong) as qty from giao_dich where phieu_id = g.id group by vat_tu_id loop
      update ton set so_luong = so_luong + rec.qty, sua_luc = now()
        where vat_tu_id = rec.vid and kho_id = kid returning so_luong into newton;   -- giá vốn KHÔNG đổi (xuất không đụng giá vốn)
      insert into giao_dich(vat_tu_id, kho_id, loai, so_luong, phieu_id, so_du_sau, nguon, canh_bao, nguoi_thao_tac)
        values(rec.vid, kid, 'dieu_chinh', rec.qty, pid_ng, newton, 'phieu', case when newton < 0 then 'ton_am' end, uid);
    end loop;
  end if;

  update phieu set trang_thai = 'da_huy', sua_luc = now() where id = g.id;
  return sp_ng;
end $$;

revoke all on function kho.huy_phieu(text, text) from public;
grant execute on function kho.huy_phieu(text, text) to authenticated;

commit;
