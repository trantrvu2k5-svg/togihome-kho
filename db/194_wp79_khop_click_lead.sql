-- db/194 · WP-79 L-09 · MÁY KHỚP click↔lead CỬA-SỔ-1:1. QD-85.
--   Zalo/Messenger không phát khoá xác định (L-08b chốt) → chỉ còn khoá THỜI GIAN+KÊNH, gán khi ĐÚNG 1 click × ĐÚNG 1 lead.
--   Ghi TẠI CHỖ (khuôn don_gan_lead QD-83): UPDATE dòng hiện hành, KHÔNG đụng dau_van (nhịp kéo vẫn khong_doi → khớp bền).
--   ma_click giữ NGUYÊN VĂN (QD-84) — KHÔNG phải ad_id, KHÔNG nâng nguon_khach (tao_don khoá theo ad_id, suy_ref vẫn 'khac').
--   ⚠ KHÔNG IDEMPOTENT (add column / or-replace hàm). Cổng backup QD-61, CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: alter table kho.lead drop column ma_click, loai_ma_click, khoa_khop, khop_luc;
--            drop function kho.khop_click_lead(timestamptz,timestamptz,boolean);
begin;

-- ── 4 cột enrichment trên lead (đều nullable). khoa_khop='cua_so_1_1' phân biệt chất lượng khoá (§4 QD-85). ──
alter table kho.lead add column ma_click      text null;
alter table kho.lead add column loai_ma_click text null;
alter table kho.lead add column khoa_khop     text null check (khoa_khop is null or khoa_khop in ('cua_so_1_1','psid'));
alter table kho.lead add column khop_luc      timestamptz null;
comment on column kho.lead.ma_click  is 'MÃ CLICK nguyên văn từ click_chat khi khớp cửa-sổ-1:1 (QD-84/85). KHÔNG phải ad_id.';
comment on column kho.lead.khoa_khop is 'cua_so_1_1 = khớp thời-gian+kênh 1:1 (suy_ref); psid = khớp xác định (treo, chưa có nguồn psid). QD-85.';

-- ── Máy khớp. p_dry=true → chỉ ĐẾM, KHÔNG ghi (dùng đo độ phủ VIỆC 4c). Trả từng lead + kết quả để báo cáo. ──
--   Cửa sổ: click xảy ra TRƯỚC, khách nhắn (lead.cham_cuoi_luc) trong 30' SAU. Lead window=[t-30',t]; click window=[c,c+30'].
--   Kênh của lead suy từ tiền tố page_id: pzl_→zalo · igo_→instagram · còn lại (số)→messenger.
create function kho.khop_click_lead(p_tu timestamptz, p_den timestamptz, p_dry boolean default false)
returns table(kq_lead uuid, kq_ket text, kq_ma_click text, kq_click uuid, kq_lech_phut numeric, kq_kenh text)
language plpgsql security definer set search_path to 'kho' as $fn$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_epoch timestamptz;
  r record; v_n int; v_click record; v_m int; v_kenh text;
begin
  -- Cổng: ceo hoặc tiến trình hệ thống (GUC lead_he_thong, khuôn lead_ghi QD-76). Ghi vào lead nên KHÔNG mở cho vai thường.
  if not (v_vai = 'ceo' or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'khop_click_lead: chỉ ceo hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)';
  end if;
  select to_timestamp(gia_tri::numeric) into v_epoch from kho.tham_so_van_hanh where ma = 'wp79b_ma_click_tu';
  if v_epoch is null then raise exception 'khop_click_lead: thiếu mốc wp79b_ma_click_tu (db/193)'; end if;

  for r in
    select l.id,
           l.cham_cuoi_luc as t_l,
           case when l.page_id like 'pzl%' then 'zalo'
                when l.page_id like 'igo%' then 'instagram'
                else 'messenger' end as kenh
    from kho.v_lead_hien_hanh l
    where l.cham_cuoi_luc is not null
      and l.cham_cuoi_luc >= v_epoch                 -- chỉ SAU mốc bắt mã click; trước mốc TRỐNG vĩnh viễn (QD-84)
      and l.cham_cuoi_luc >= p_tu and l.cham_cuoi_luc <= p_den
      and l.muc_chac_chan <> 'xac_dinh'              -- ad_id THẮNG (QD-73), không hạ mức
      and l.khoa_khop is null                        -- idempotent: đã khớp thì bỏ qua
    order by l.cham_cuoi_luc
  loop
    -- n = số click cùng kênh, sau epoch, không bot, trong cửa sổ [t_l - 30', t_l]
    select count(*) into v_n from kho.click_chat c
      where c.kenh = r.kenh and c.la_bot = false
        and c.ghi_nhan_luc >= v_epoch
        and c.ghi_nhan_luc <= r.t_l
        and c.ghi_nhan_luc >= r.t_l - interval '30 minutes';
    if v_n = 0 then
      kq_lead:=r.id; kq_ket:='khong_co_click'; kq_ma_click:=null; kq_click:=null; kq_lech_phut:=null; kq_kenh:=r.kenh; return next; continue;
    elsif v_n > 1 then
      kq_lead:=r.id; kq_ket:='nhieu_click'; kq_ma_click:=null; kq_click:=null; kq_lech_phut:=null; kq_kenh:=r.kenh; return next; continue;
    end if;

    -- đúng 1 click → lấy nó
    select c.* into v_click from kho.click_chat c
      where c.kenh = r.kenh and c.la_bot = false
        and c.ghi_nhan_luc >= v_epoch
        and c.ghi_nhan_luc <= r.t_l
        and c.ghi_nhan_luc >= r.t_l - interval '30 minutes'
      limit 1;

    -- m = số lead hiện hành cùng kênh, sau epoch, chưa xác định, rơi vào cửa sổ của click [c, c+30']
    select count(*) into v_m from kho.v_lead_hien_hanh l2
      where (case when l2.page_id like 'pzl%' then 'zalo'
                  when l2.page_id like 'igo%' then 'instagram'
                  else 'messenger' end) = r.kenh
        and l2.cham_cuoi_luc is not null
        and l2.cham_cuoi_luc >= v_epoch
        and l2.cham_cuoi_luc >= v_click.ghi_nhan_luc
        and l2.cham_cuoi_luc <= v_click.ghi_nhan_luc + interval '30 minutes'
        and l2.muc_chac_chan <> 'xac_dinh';
    if v_m > 1 then
      kq_lead:=r.id; kq_ket:='nhieu_lead'; kq_ma_click:=v_click.ma_click; kq_click:=v_click.id;
      kq_lech_phut:=round(extract(epoch from (r.t_l - v_click.ghi_nhan_luc))/60.0, 1); kq_kenh:=r.kenh; return next; continue;
    end if;

    -- ĐÚNG 1 × ĐÚNG 1 → gán suy_ref (trừ khi dry-run). UPDATE tại chỗ, KHÔNG đụng dau_van.
    if not p_dry then
      update kho.lead set
        muc_chac_chan = 'suy_ref',
        ma_click      = v_click.ma_click,
        loai_ma_click = v_click.loai_ma_click,
        khoa_khop     = 'cua_so_1_1',
        khop_luc      = now()
      where id = r.id;
    end if;
    kq_lead:=r.id; kq_ket:='gan'; kq_ma_click:=v_click.ma_click; kq_click:=v_click.id;
    kq_lech_phut:=round(extract(epoch from (r.t_l - v_click.ghi_nhan_luc))/60.0, 1); kq_kenh:=r.kenh; return next;
  end loop;
  return;
end $fn$;
revoke execute on function kho.khop_click_lead(timestamptz,timestamptz,boolean) from public, anon;
grant execute on function kho.khop_click_lead(timestamptz,timestamptz,boolean) to authenticated;

do $$ begin
  if to_regprocedure('kho.khop_click_lead(timestamptz,timestamptz,boolean)') is null then raise exception 'THIẾU khop_click_lead'; end if;
  raise notice 'db/194 OK: lead +4 cột khớp · khop_click_lead(p_tu,p_den,p_dry) cửa-sổ-1:1.';
end $$;
commit;
