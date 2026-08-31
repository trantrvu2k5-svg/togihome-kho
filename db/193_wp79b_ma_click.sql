-- db/193 · WP-79b L-06 · Bắt MÃ CLICK (fbclid/gclid + utm) ở trang đích, mang qua /chat vào click_chat. QD-84.
--   ⚠ fbclid = MÃ CLICK, KHÔNG phải mã quảng cáo. KHÔNG suy ad_id/chiến dịch từ nó (WP-77/Meta API mới giải).
--     Giữ NGUYÊN VĂN, không cắt/hash/đoán. CẤM đặt tên cột ad_id/campaign_id. Nhãn 'chua_giai'.
--   ⚠ KHÔNG IDEMPOTENT (add column / drop+create function). Cổng backup QD-61, CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: alter table kho.click_chat drop column ma_click, loai_ma_click, utm_source, utm_medium,
--     utm_campaign, utm_content, utm_term, trang_dat; + tạo lại ghi_click_chat bản 7 tham số db/184.
begin;

-- ── 8 cột THÔ trên click_chat (đều nullable, nguyên văn). ma_click = fbclid/gclid; loai_ma_click = 'fbclid'/'gclid'. ──
alter table kho.click_chat add column ma_click      text null;
alter table kho.click_chat add column loai_ma_click text null;
alter table kho.click_chat add column utm_source    text null;
alter table kho.click_chat add column utm_medium    text null;
alter table kho.click_chat add column utm_campaign  text null;
alter table kho.click_chat add column utm_content   text null;
alter table kho.click_chat add column utm_term      text null;
alter table kho.click_chat add column trang_dat     text null;   -- URL trang lúc bấm (khác duong_dan=pathname GTM gửi)
comment on column kho.click_chat.ma_click is 'MÃ CLICK nguyên văn (fbclid/gclid) — CHƯA GIẢI. KHÔNG phải ad_id. Meta API (WP-77) mới ra chiến dịch.';

-- ── ghi_click_chat: DROP 7-tham-số, CREATE 15-tham-số (thêm ma_click/utm/trang_dat, đều DEFAULT NULL để lượt cũ chạy). ──
drop function if exists kho.ghi_click_chat(text,text,text,text,text,text,integer);
create function kho.ghi_click_chat(
    p_ref text, p_kenh text, p_dich text, p_nguon_trang text, p_ua text,
    p_duong_dan text default null, p_id_web integer default null,
    p_ma_click text default null, p_loai_ma_click text default null,
    p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null,
    p_utm_content text default null, p_utm_term text default null, p_trang_dat text default null)
returns uuid language plpgsql security definer set search_path to 'kho'
as $fn$
declare v_after text; v_loai text; v_ma_ny text; v_hop_le boolean := false; v_bot boolean; v_id_web integer; v_id uuid;
begin
  if p_kenh is null or p_kenh not in ('zalo','messenger','instagram') then
    raise exception 'ghi_click_chat: kenh không hợp lệ: %', coalesce(p_kenh,'(null)');
  end if;
  if p_ref ~ '^web-[^-]+-.+$' then
    v_after := substring(p_ref from 5); v_loai := split_part(v_after,'-',1); v_ma_ny := substring(v_after from length(v_loai)+2);
    if exists (select 1 from kho.loai_thuong_mai t where t.ma = v_loai) then v_hop_le := true;
    else v_hop_le := false; v_loai := null; v_ma_ny := null; end if;
  else v_hop_le := false; v_loai := null; v_ma_ny := null; end if;
  v_bot := coalesce(p_ua,'') ~* '(bot|crawl|spider|preview|facebookexternalhit)';
  if p_id_web is not null then v_id_web := p_id_web;
  elsif p_duong_dan is not null then v_id_web := (substring(p_duong_dan from '\.(\d+)$'))::integer;
  else v_id_web := null; end if;
  insert into kho.click_chat(kenh, ref_web, loai_ma, ma_ny, ref_hop_le, dich, nguon_trang, ua, la_bot, duong_dan, id_web,
      ma_click, loai_ma_click, utm_source, utm_medium, utm_campaign, utm_content, utm_term, trang_dat)
    values(p_kenh, coalesce(p_ref,''), v_loai, v_ma_ny, v_hop_le, coalesce(p_dich,''), p_nguon_trang, p_ua, v_bot, p_duong_dan, v_id_web,
      -- MÃ CLICK giữ nguyên văn, CHỈ chặn độ dài trần (không làm sạch nội dung)
      left(nullif(btrim(p_ma_click),''), 512), left(nullif(btrim(p_loai_ma_click),''), 16),
      left(nullif(btrim(p_utm_source),''), 256), left(nullif(btrim(p_utm_medium),''), 256), left(nullif(btrim(p_utm_campaign),''), 256),
      left(nullif(btrim(p_utm_content),''), 256), left(nullif(btrim(p_utm_term),''), 256), left(nullif(btrim(p_trang_dat),''), 1024))
    returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function kho.ghi_click_chat(text,text,text,text,text,text,integer,text,text,text,text,text,text,text,text) from public, anon, authenticated;

-- ── VIỆC 4: MỐC bắt đầu bắt mã click (epoch giây trong tham_so_van_hanh; lead/click trước mốc TRỐNG vĩnh viễn). ──
insert into kho.tham_so_van_hanh(ma, gia_tri, don_vi, ghi_chu, sua_luc)
  values('wp79b_ma_click_tu', extract(epoch from now()), 'epoch_giay',
    'WP-79b/QD-84: mốc BẬT bắt mã click (fbclid/utm). Lead/click TRƯỚC mốc trống vĩnh viễn — KHÔNG lấp ngược.', now())
  on conflict (ma) do nothing;

do $$ begin
  if to_regprocedure('kho.ghi_click_chat(text,text,text,text,text,text,integer,text,text,text,text,text,text,text,text)') is null then raise exception 'THIẾU ghi_click_chat 15-tham-số'; end if;
  raise notice 'db/193 OK: click_chat +8 cột mã click · ghi_click_chat 15 tham số · mốc wp79b_ma_click_tu.';
end $$;
commit;
