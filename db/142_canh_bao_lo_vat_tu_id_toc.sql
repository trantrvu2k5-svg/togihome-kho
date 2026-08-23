-- 142 — WP-42 vá gap RPC (L-91): canh_bao_dat_hang LỘ THÊM vat_tu_id + toc_do cho UI.
--   RETURNS TABLE đổi → phải DROP + CREATE lại. LOGIC NHÓM KHÔNG ĐỔI: chỉ thêm 2 cột đã tính sẵn ra ngoài.
--     • vat_tu_id: bỏ round-trip map ma→id ở UI.
--     • toc_do: xuất bq/ngày 30n (đã tính trong CTE toc) → cột "Xuất bq/ngày" hết dấu "—".
--   IDEMPOTENT. HOÀN TÁC: chạy lại db/140.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists kho.canh_bao_dat_hang();
create function kho.canh_bao_dat_hang()
  returns table(
    vat_tu_id uuid, ma text, ten text, don_vi_co_so text,
    ton numeric, giu_cho numeric, po_dang_ve numeric, kha_dung numeric, toc_do numeric,
    ton_toi_thieu numeric, muc_dat_len_toi numeric, so_dat numeric,
    ngay_het date, ngay_dat date, lead_time int,
    ncc_id uuid, ncc_ten text, don_gia numeric,
    nhom text, thieu_muc_max boolean)
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo') then raise exception 'canh_bao_dat_hang: chỉ kho/ceo'; end if;
  return query
  with vt as (
    select v.id, v.ma, v.ten, v.don_vi_co_so, v.ton_toi_thieu, v.muc_dat_len_toi
    from kho.vat_tu v where v.pp_ke_hoach = 'ton_toi_thieu' and v.ngung_dung = false
  ),
  ton_g as ( select t.vat_tu_id, sum(t.so_luong) ton from kho.ton t group by t.vat_tu_id ),   -- Q2: gộp mọi kho
  giu_g as (
    select g.vat_tu_id, sum(g.so_luong_giu - g.so_luong_da_xuat) giu
    from kho.giu_cho g where g.trang_thai = 'mo' group by g.vat_tu_id
  ),
  po_g as (
    select dd.vat_tu_id, sum(
        (dd.so_luong - dd.so_luong_da_nhan) *
        case when nrm.k = v.don_vi_co_so then 1
             else coalesce((select vd.he_so from kho.vat_tu_don_vi vd where vd.vat_tu_id = dd.vat_tu_id and vd.don_vi = nrm.k), 1) end
      ) po
    from kho.don_mua_dong dd
    join kho.don_mua d on d.id = dd.don_mua_id
    join kho.vat_tu v on v.id = dd.vat_tu_id
    cross join lateral (select coalesce((select o.ma from kho.don_vi o where o.ma = dd.dvt or o.ten = dd.dvt), dd.dvt) k) nrm
    where d.trang_thai in ('da_gui','xac_nhan')
    group by dd.vat_tu_id
  ),
  toc as (
    select gd.vat_tu_id, (-sum(gd.so_luong)) / 30.0 toc
    from kho.giao_dich gd
    where gd.loai = 'xuat' and gd.tao_luc >= now() - interval '30 days'
    group by gd.vat_tu_id
  ),
  gia as (
    select distinct on (g.vat_tu_id) g.vat_tu_id, g.ncc_id, g.don_gia, g.lead_time_ngay, ncc.ten ncc_ten
    from kho.gia_ncc g join kho.nha_cung_cap ncc on ncc.id = g.ncc_id
    where g.ap_dung_tu <= current_date
    order by g.vat_tu_id, g.don_gia asc, g.ap_dung_tu desc
  ),
  calc as (
    select vt.id, vt.ma, vt.ten, vt.don_vi_co_so, vt.ton_toi_thieu, vt.muc_dat_len_toi,
      coalesce(tg.ton,0) ton, coalesce(gg.giu,0) giu_cho, coalesce(pg.po,0) po_dang_ve,
      coalesce(tg.ton,0) - coalesce(gg.giu,0) + coalesce(pg.po,0) kha_dung,
      coalesce(tc.toc,0) toc, ga.ncc_id, ga.ncc_ten, ga.don_gia, ga.lead_time_ngay
    from vt
    left join ton_g tg on tg.vat_tu_id = vt.id
    left join giu_g gg on gg.vat_tu_id = vt.id
    left join po_g  pg on pg.vat_tu_id = vt.id
    left join toc   tc on tc.vat_tu_id = vt.id
    left join gia   ga on ga.vat_tu_id = vt.id
  )
  select c.id, c.ma, c.ten, c.don_vi_co_so, c.ton, c.giu_cho, c.po_dang_ve, c.kha_dung, c.toc,
    c.ton_toi_thieu, c.muc_dat_len_toi,
    case when c.ton_toi_thieu is null then null
         when c.muc_dat_len_toi is not null then c.muc_dat_len_toi - c.kha_dung
         else c.ton_toi_thieu - c.kha_dung end,
    h.ngay_het,
    case when c.ton_toi_thieu is null then null
         when c.toc = 0 or c.kha_dung <= 0 then current_date
         else h.ngay_het - coalesce(c.lead_time_ngay, 0) end,
    c.lead_time_ngay, c.ncc_id, c.ncc_ten, c.don_gia,
    case when c.ton_toi_thieu is null then 'chua_co_muc'
         when c.lead_time_ngay is null then 'thieu_lead'
         else 'canh_bao' end,
    (c.ton_toi_thieu is not null and c.muc_dat_len_toi is null)
  from calc c
  cross join lateral (
    select case when c.kha_dung <= 0 then current_date
                when c.toc > 0 then current_date + least(floor(c.kha_dung / c.toc), 3650)::int
                else null end as ngay_het
  ) h
  where c.ton_toi_thieu is null or c.kha_dung < c.ton_toi_thieu;
end $$;
grant execute on function kho.canh_bao_dat_hang() to authenticated;

commit;
