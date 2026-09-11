-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 258 — WP-113 lô A (đóng): khop_click_lead set LUỒNG cùng câu UPDATE muc→suy_ref (một nguồn luật lead_luong).
--   Trước: khop UPDATE muc='suy_ref' nhưng để luong='khong_biet' → hiện hành lệch (muc suy_ref / luong khong_biet)
--   tới lần lead_ghi kế mới lành. Nay set luong=kho.lead_luong(ad_id,'suy_ref',ref_web) NGAY trong câu khớp.
--   Chữa phần đã lệch từ db/257 tới giờ: UPDATE tại-chỗ (đúng cách khop ghi) các dòng khop-matched luong sai.
--   HOÀN TÁC: chạy lại bản khop_click_lead trước (db trước db/258).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.khop_click_lead(p_tu timestamp with time zone, p_den timestamp with time zone, p_dry boolean DEFAULT false)
 returns TABLE(kq_lead uuid, kq_ket text, kq_ma_click text, kq_click uuid, kq_lech_phut numeric, kq_kenh text)
 language plpgsql security definer set search_path to 'kho' as $function$
declare
  v_vai text := coalesce(kho.current_vai_tro(),''); v_epoch timestamptz;
  r record; v_n int; v_click record; v_m int;
begin
  if not (v_vai = 'ceo' or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'khop_click_lead: chỉ ceo hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)'; end if;
  select to_timestamp(gia_tri::numeric) into v_epoch from kho.tham_so_van_hanh where ma = 'wp79b_ma_click_tu';
  if v_epoch is null then raise exception 'khop_click_lead: thiếu mốc wp79b_ma_click_tu (db/193)'; end if;

  for r in
    select l.id, l.cham_cuoi_luc as t_l,
           case when l.page_id like 'pzl%' then 'zalo' when l.page_id like 'igo%' then 'instagram' else 'messenger' end as kenh
    from kho.v_lead_hien_hanh l
    where l.cham_cuoi_luc is not null and l.cham_cuoi_luc >= v_epoch
      and l.cham_cuoi_luc >= p_tu and l.cham_cuoi_luc <= p_den
      and l.muc_chac_chan <> 'xac_dinh' and l.khoa_khop is null
    order by l.cham_cuoi_luc
  loop
    select count(*) into v_n from kho.click_chat c
      where c.kenh = r.kenh and c.la_bot = false and c.ghi_nhan_luc >= v_epoch
        and c.ghi_nhan_luc <= r.t_l and c.ghi_nhan_luc >= r.t_l - interval '30 minutes';
    if v_n = 0 then
      kq_lead:=r.id; kq_ket:='khong_co_click'; kq_ma_click:=null; kq_click:=null; kq_lech_phut:=null; kq_kenh:=r.kenh; return next; continue;
    elsif v_n > 1 then
      kq_lead:=r.id; kq_ket:='nhieu_click'; kq_ma_click:=null; kq_click:=null; kq_lech_phut:=null; kq_kenh:=r.kenh; return next; continue;
    end if;
    select c.* into v_click from kho.click_chat c
      where c.kenh = r.kenh and c.la_bot = false and c.ghi_nhan_luc >= v_epoch
        and c.ghi_nhan_luc <= r.t_l and c.ghi_nhan_luc >= r.t_l - interval '30 minutes' limit 1;
    select count(*) into v_m from kho.v_lead_hien_hanh l2
      where (case when l2.page_id like 'pzl%' then 'zalo' when l2.page_id like 'igo%' then 'instagram' else 'messenger' end) = r.kenh
        and l2.cham_cuoi_luc is not null and l2.cham_cuoi_luc >= v_epoch
        and l2.cham_cuoi_luc >= v_click.ghi_nhan_luc and l2.cham_cuoi_luc <= v_click.ghi_nhan_luc + interval '30 minutes'
        and l2.muc_chac_chan <> 'xac_dinh';
    if v_m > 1 then
      kq_lead:=r.id; kq_ket:='nhieu_lead'; kq_ma_click:=v_click.ma_click; kq_click:=v_click.id;
      kq_lech_phut:=round(extract(epoch from (r.t_l - v_click.ghi_nhan_luc))/60.0, 1); kq_kenh:=r.kenh; return next; continue;
    end if;
    if not p_dry then
      update kho.lead set
        muc_chac_chan = 'suy_ref',
        luong         = kho.lead_luong(ad_id, 'suy_ref', ref_web),   -- [WP-113] set LUỒNG cùng câu (một nguồn luật)
        ma_click      = v_click.ma_click, loai_ma_click = v_click.loai_ma_click,
        khoa_khop     = 'cua_so_1_1', khop_luc = now()
      where id = r.id;
    end if;
    kq_lead:=r.id; kq_ket:='gan'; kq_ma_click:=v_click.ma_click; kq_click:=v_click.id;
    kq_lech_phut:=round(extract(epoch from (r.t_l - v_click.ghi_nhan_luc))/60.0, 1); kq_kenh:=r.kenh; return next;
  end loop;
  return;
end $function$;

-- Chữa phần đã lệch (UPDATE tại-chỗ, đúng cách khop): dòng khop-matched (khoa_khop set, muc=suy_ref) mà luong sai.
update kho.lead set luong = kho.lead_luong(ad_id, muc_chac_chan, ref_web)
  where khoa_khop is not null and muc_chac_chan = 'suy_ref'
    and luong is distinct from kho.lead_luong(ad_id, muc_chac_chan, ref_web);

commit;
