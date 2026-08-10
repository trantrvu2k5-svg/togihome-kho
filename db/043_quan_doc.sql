-- 043 — MÀN QUẢN ĐỐC: loại đơn mau_moi + đánh dấu gấp (guard) + viec_uu_tien + can_ceo_quyet.
--   Xếp việc ở DB (KHÔNG ở JS) để app xưởng + app sale dùng lại CÙNG luật. ⚠ CHỜ TEST XANH. CHƯA áp prod.
--
--   PHÁT HIỆN: mau_moi = LOẠI đơn (loai), KHÔNG phải trạng thái — vì đơn mẫu-mới vẫn chạy production (cho_cat→xong_sx)
--   cho kanban, chỉ LOẠI khỏi doanh thu/he_so_m (không thể vừa là trạng thái SX vừa là mau_moi).
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.kanban_xuong(), kho.can_ceo_quyet(), kho.viec_uu_tien();
--   drop trigger if exists trg_chan_gap_khong_ly_do on kho.don_hang; drop function if exists kho.chan_gap_khong_ly_do();
--   alter table kho.don_hang drop column if exists danh_dau_gap, drop column if exists ma_ns_danh_dau,
--     drop column if exists ly_do_gap, drop column if exists gap_luc;
--   -- tinh_he_so_m: chạy lại bản db/03x (bỏ nhánh loai='mau_moi'); loai CHECK: bỏ 'mau_moi' khỏi mảng.
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ C1. LOẠI ĐƠN mau_moi ═══════════════
-- Thêm 'mau_moi' vào loai CHECK (tên thật: chk_loai). Giữ nguyên các loại cũ.
alter table kho.don_hang drop constraint if exists chk_loai;
alter table kho.don_hang add constraint chk_loai
  check (loai is null or loai = any(array['le_sang','le_rieng','combo','combo_moi','full_can','bao_hanh','cat_lai','mau_moi']));

-- tinh_he_so_m: LOẠI đơn mau_moi khỏi trung bình gcg + ship (y như loại bao_gia). Chỉ thêm điều kiện, giữ công thức.
create or replace function kho.tinh_he_so_m(p_ma_ky text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare
  t record; v_hh numeric; v_gcg_tb numeric; v_ship_tb numeric;
  v_sum_gcg numeric; v_sum_ship numeric; v_sum_phi numeric; v_thieu text := '';
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'tinh_he_so_m: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ma_ky;
  if not found then raise notice 'tinh_he_so_m(%): chưa có dòng tham số cho kỳ', p_ma_ky; return null; end if;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  select avg(g.gia_chuyen_giao) into v_gcg_tb
    from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky and d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo')
      and d.loai is distinct from 'mau_moi';    -- [043] mẫu mới KHÔNG vào doanh thu
  select avg(d.ship_thuc_tra) into v_ship_tb
    from kho.don_hang d where d.ma_ky_ap_dung = p_ma_ky and d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo')
      and d.loai is distinct from 'mau_moi';    -- [043]
  if t.dt_muc_tieu     is null then v_thieu := v_thieu || 'dt_muc_tieu, '; end if;
  if t.so_don_ke_hoach is null or t.so_don_ke_hoach = 0 then v_thieu := v_thieu || 'so_don_ke_hoach, '; end if;
  if t.phi_don_le      is null then v_thieu := v_thieu || 'phi_don_le, '; end if;
  if v_gcg_tb is null then v_thieu := v_thieu || 'đơn có gia_chuyen_giao đóng dấu kỳ (gcg_TB rỗng), '; end if;
  if v_thieu <> '' then raise notice 'tinh_he_so_m(%): THIẾU %', p_ma_ky, rtrim(v_thieu, ', '); return null; end if;
  v_sum_gcg  := v_gcg_tb              * t.so_don_ke_hoach;
  v_sum_ship := coalesce(v_ship_tb,0) * t.so_don_ke_hoach;
  v_sum_phi  := t.phi_don_le          * t.so_don_ke_hoach;
  return (t.dt_muc_tieu * (1 - v_hh) - v_sum_ship - v_sum_phi) / v_sum_gcg;
end $$;

-- ═══════════════ C2. ĐÁNH DẤU GẤP (bắt buộc lý do; ceo/xuong; sale KHÔNG) ═══════════════
alter table kho.don_hang add column if not exists danh_dau_gap    boolean not null default false;
alter table kho.don_hang add column if not exists ma_ns_danh_dau  uuid references kho.nguoi_dung(id);
alter table kho.don_hang add column if not exists ly_do_gap       text;
alter table kho.don_hang add column if not exists gap_luc         timestamptz;

create or replace function kho.chan_gap_khong_ly_do() returns trigger
  language plpgsql set search_path = kho as $$
declare v_vai text; v_uid uuid;
begin
  if new.danh_dau_gap is not distinct from old.danh_dau_gap
     and new.ly_do_gap is not distinct from old.ly_do_gap then return new; end if;   -- không đụng gấp
  if new.danh_dau_gap then
    v_vai := coalesce(kho.current_vai_tro(),'');
    if v_vai not in ('ceo','xuong') then
      raise exception 'Đánh dấu GẤP chỉ ceo/xuong (kẻo đơn nào cũng gấp) — vai "%"', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
    if new.ly_do_gap is null or btrim(new.ly_do_gap) = '' then
      raise exception 'Đánh dấu GẤP BẮT BUỘC có lý do'; end if;
    select id into v_uid from kho.nguoi_dung where auth_uid = auth.uid();
    new.ma_ns_danh_dau := coalesce(new.ma_ns_danh_dau, v_uid);
    new.gap_luc := coalesce(new.gap_luc, now());
  else
    new.ma_ns_danh_dau := null; new.ly_do_gap := null; new.gap_luc := null;   -- bỏ gấp -> xoá dấu
  end if;
  return new;
end $$;
drop trigger if exists trg_chan_gap_khong_ly_do on kho.don_hang;
create trigger trg_chan_gap_khong_ly_do before update on kho.don_hang
  for each row execute function kho.chan_gap_khong_ly_do();

-- ═══════════════ C3. viec_uu_tien() — xếp 5 luật + lý do CHỮ (dùng chung app xưởng/sale) ═══════════════
--   Chỉ đơn ĐANG SẢN XUẤT (cho_cat/da_cat/dang_lam). Rank nhỏ = làm trước. Kèm món "nút cổ chai" + tổ gợi ý.
--   Luật: 1 quá hạn · 2 gấp có duyệt · 3 đứng yên >3 ngày · 4 còn ít ngày tới hạn · 5 mẫu mới.
create or replace function kho.viec_uu_tien()
  returns table(ma_don text, ten_mon text, to_goi_y text, rank_uu_tien int, ly_do text,
                ngay_hen_khach date, so_ngay_lien_quan int)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then
    raise exception 'viec_uu_tien: chỉ ceo/xuong'; end if;
  return query
  with don_sx as (   -- đơn đang sản xuất
    select d.id, d.ma_don, d.trang_thai, d.loai, d.ngay_hen_khach, d.danh_dau_gap, d.ma_ns_danh_dau, d.ly_do_gap
    from kho.don_hang d where d.trang_thai in ('cho_cat','da_cat','dang_lam')
  ),
  bottleneck as (   -- món nút cổ chai (bước chậm nhất chưa xong) + số ngày đứng yên
    select ds.id, ds.ma_don, ds.trang_thai as don_tt, ds.loai, ds.ngay_hen_khach, ds.danh_dau_gap, ds.ly_do_gap,
      m.ten as ten_mon, m.trang_thai as mon_tt,
      (current_date - coalesce((select max(k.luc) from kho.don_hang_mon_nhat_ky k where k.mon_id = m.id), m.tao_luc)::date) as ngay_dung
    from don_sx ds
    join lateral (
      select m2.* from kho.don_hang_mon m2 where m2.don_id = ds.id and m2.trang_thai <> 'xong_sx'
      order by case m2.trang_thai when 'cho_cat' then 1 when 'da_cat' then 2 when 'dang_lam' then 3 else 9 end
      limit 1
    ) m on true
  ),
  xep as (
    select b.*,
      case
        when b.ngay_hen_khach is not null and b.ngay_hen_khach < current_date then 1
        when b.danh_dau_gap and b.ma_don is not null then 2
        when b.ngay_dung > 3 then 3
        when b.ngay_hen_khach is not null then 4
        when b.loai = 'mau_moi' then 5
        else 4 end as rk
    from bottleneck b
  )
  select x.ma_don, x.ten_mon,
    case x.mon_tt when 'cho_cat' then 'CNC (cắt)' when 'da_cat' then 'Dán cạnh / khoan' when 'dang_lam' then 'Lắp ráp' else '—' end,
    x.rk,
    case x.rk
      when 1 then 'Quá hạn ' || (current_date - x.ngay_hen_khach) || ' ngày (hẹn ' || to_char(x.ngay_hen_khach,'DD/MM') || ')'
      when 2 then 'GẤP — có người duyệt: ' || coalesce(x.ly_do_gap,'(không rõ)')
      when 3 then 'Đứng yên ' || x.ngay_dung || ' ngày ở bước ' || x.mon_tt
      when 4 then case when x.ngay_hen_khach is not null then 'Còn ' || (x.ngay_hen_khach - current_date) || ' ngày tới hạn' else 'Thường' end
      when 5 then 'Mẫu mới (không hạn khách)'
      else 'Thường' end,
    x.ngay_hen_khach,
    case x.rk when 1 then (current_date - x.ngay_hen_khach) when 3 then x.ngay_dung
      when 4 then coalesce(x.ngay_hen_khach - current_date, 9999) else 0 end
  from xep x
  order by x.rk asc,
    case x.rk when 1 then -(current_date - x.ngay_hen_khach) when 3 then -x.ngay_dung
      when 4 then coalesce(x.ngay_hen_khach - current_date, 9999) else 0 end asc,
    x.ma_don;
end $$;
grant execute on function kho.viec_uu_tien() to authenticated;

-- ═══════════════ C4. can_ceo_quyet() — khối đỏ (chỉ khi có tình huống) ═══════════════
create or replace function kho.can_ceo_quyet()
  returns table(loai_tinh_huong text, mo_ta text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then
    raise exception 'can_ceo_quyet: chỉ ceo/xuong'; end if;
  -- 1. Hai đơn cùng quá hạn, cùng chờ MỘT tổ (cùng bước nút cổ chai)
  return query
  with v as (select * from kho.viec_uu_tien())
  select 'hai_qua_han_mot_to'::text,
    'Hai+ đơn quá hạn cùng chờ tổ "' || v.to_goi_y || '": ' || string_agg(v.ma_don, ', ')
  from v where v.rank_uu_tien = 1 group by v.to_goi_y having count(*) >= 2;
  -- 2. Đơn gấp chen vào khi có đơn khác đang trễ
  return query
  with v as (select * from kho.viec_uu_tien())
  select 'gap_chen_don_tre'::text,
    'Đơn gấp (' || (select string_agg(ma_don, ', ') from v where v.rank_uu_tien = 2) ||
    ') chen khi có đơn quá hạn (' || (select string_agg(ma_don, ', ') from v where v.rank_uu_tien = 1) || ')'
  where exists (select 1 from v where v.rank_uu_tien = 2)
    and exists (select 1 from v where v.rank_uu_tien = 1);
  -- 3. Món đứng yên quá 5 ngày
  return query
  select 'mon_dung_qua_5'::text, 'Món đứng yên >5 ngày: ' || string_agg(m.ten || ' (' || m.so_ngay_dung || 'n)', ', ')
  from kho.mon_dung_yen(5) m having count(*) >= 1;
end $$;
grant execute on function kho.can_ceo_quyet() to authenticated;

-- ═══════════════ kanban_xuong() — thẻ đơn cho bảng 5 cột (chỉ phần sản xuất) ═══════════════
--   cot = bước chậm nhất (trang_thai_don_tu_mon). "X/Y món" = X đã qua bước cột / Y tổng. Cờ trễ/gấp/mẫu-mới.
create or replace function kho.kanban_xuong()
  returns table(ma_don text, cot text, to_goi_y text, dong text, ten_rut_gon text,
                so_mon_qua int, so_mon_tong int, la_tre boolean, la_gap boolean, la_mau_moi boolean, ngay_hen_khach date)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then
    raise exception 'kanban_xuong: chỉ ceo/xuong'; end if;
  return query
  select d.ma_don,
    coalesce(kho.trang_thai_don_tu_mon(d.id), d.trang_thai) as cot,
    case coalesce(kho.trang_thai_don_tu_mon(d.id), d.trang_thai)
      when 'cho_cat' then 'CNC (cắt)' when 'da_cat' then 'Dán cạnh / khoan' when 'dang_lam' then 'Lắp ráp'
      when 'xong_sx' then 'Xong SX' when 'cho_giao' then 'Chờ giao' else '—' end as to_goi_y,
    d.dong,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.tao_luc nulls last, m.id limit 1), d.ma_don) as ten,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id
       and m.trang_thai is distinct from coalesce(kho.trang_thai_don_tu_mon(d.id), d.trang_thai)) as so_qua,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id) as so_tong,
    (d.ngay_hen_khach is not null and d.ngay_hen_khach < current_date) as la_tre,
    d.danh_dau_gap,
    (d.loai = 'mau_moi') as la_mau_moi,
    d.ngay_hen_khach
  from kho.don_hang d
  where d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao')   -- CHỈ sản xuất (không báo giá/thiết kế/đã giao)
  order by d.ma_don;
end $$;
grant execute on function kho.kanban_xuong() to authenticated;

commit;
