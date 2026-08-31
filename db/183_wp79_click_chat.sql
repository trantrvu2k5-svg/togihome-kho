-- db/183 · WP-79 L-79b · SỔ CLICK NÚT CHAT (kho.click_chat) + RPC ghi_click_chat. QD-78.
--   ⚠ KHÔNG IDEMPOTENT: create table / create policy / create trigger sẽ LỖI nếu chạy lại. Chạy ĐÚNG MỘT LẦN.
--   Cú click nút chat web = SỔ GHI THÊM bên hệ kho (web sắp thay Shopify — tín hiệu nguồn không chết theo web).
--   Ref sai/rác VẪN ghi (đeo cờ ref_hop_le=false, QD-69 việc-thật-thắng-số-suy); chỉ kenh sai mới RAISE.
--   ⚠ Cổng backup QD-61: dump fail → DỪNG. CẤM tự bật BO_QUA_BACKUP (bài học db/176 — chỉ CEO tự gõ mới hợp lệ).
--   HOÀN TÁC: drop function kho.ghi_click_chat(text,text,text,text,text); drop table kho.click_chat cascade;
--     drop function kho.cc_chan_sua();
begin;

-- ── Bảng sổ append-only. KHÔNG partition: ~3k dòng/tháng (click/lead ~3) — KHÔNG phải họ su_kien_quet (triệu dòng). ──
create table kho.click_chat (
  id            uuid primary key default gen_random_uuid(),
  stt           bigserial unique,                 -- "dòng cuối" theo stt (KHÔNG theo thời gian — bài học L-53)
  ghi_nhan_luc  timestamptz not null default now(),
  kenh          text not null check (kenh in ('zalo','messenger','instagram')),
  ref_web       text not null,                    -- chuỗi THÔ y như web gửi, không sửa
  loai_ma       text null,                        -- tách từ ref (KHÔNG FK sang loai_thuong_mai — ref rác vẫn ghi)
  ma_ny         text null,                        -- tách từ ref
  ref_hop_le    boolean not null default false,
  dich          text not null,                    -- URL đã chuyển hướng tới
  nguon_trang   text null,                        -- Referer
  ua            text null,
  la_bot        boolean not null default false
);
comment on table kho.click_chat is 'WP-79/QD-78: sổ click nút chat web (append-only). KHÔNG partition có chủ đích: ~3k dòng/tháng, không phải họ su_kien_quet. KHÔNG lưu IP/nội dung.';
create index ix_cc_ghi_nhan on kho.click_chat (ghi_nhan_luc desc);
create index ix_cc_kenh_ghi on kho.click_chat (kenh, ghi_nhan_luc desc);   -- hình dạng L-79d tra: lọc kênh + cửa sổ 30'

-- ── Append-only: RLS+FORCE (phòng thủ) + trigger là CỔNG THẬT (Worker ghi đường owner/Hyperdrive → BYPASSRLS). ──
alter table kho.click_chat enable row level security;
alter table kho.click_chat force row level security;
revoke all on kho.click_chat from public, anon, authenticated;
create policy cc_chen on kho.click_chat for insert to authenticated with check (true);
create policy cc_doc  on kho.click_chat for select to authenticated using (true);
-- KHÔNG có policy update/delete → RLS chặn; và trigger chặn kể cả role bypass:
create or replace function kho.cc_chan_sua() returns trigger language plpgsql as $fn$
begin
  raise exception 'click_chat: sổ APPEND-ONLY — CẤM % (chỉ INSERT)', tg_op;
end $fn$;
create trigger cc_chan_sua before update or delete on kho.click_chat for each row execute function kho.cc_chan_sua();

-- ── RPC ghi (cửa DUY NHẤT). SECURITY DEFINER. KHÔNG set_config/GUC (L-79c gọi qua Hyperdrive — GUC rơi giữa 2 câu). ──
create function kho.ghi_click_chat(p_ref text, p_kenh text, p_dich text, p_nguon_trang text, p_ua text)
returns uuid language plpgsql security definer set search_path to 'kho' as $fn$
declare v_after text; v_loai text; v_ma_ny text; v_hop_le boolean := false; v_bot boolean; v_id uuid;
begin
  -- chỉ kenh sai mới TỪ CHỐI (ref rác vẫn ghi — QD-69)
  if p_kenh is null or p_kenh not in ('zalo','messenger','instagram') then
    raise exception 'ghi_click_chat: kenh không hợp lệ: %', coalesce(p_kenh,'(null)');
  end if;
  -- tách ref dạng web-<loai>-<ma_ny> ; loại KHÔNG có gạch (sofa/tu/ban_an…) nên loai = tới gạch ĐẦU sau 'web-'
  if p_ref ~ '^web-[^-]+-.+$' then
    v_after := substring(p_ref from 5);                       -- bỏ 'web-'
    v_loai  := split_part(v_after, '-', 1);
    v_ma_ny := substring(v_after from length(v_loai) + 2);    -- phần sau '<loai>-'
    if exists (select 1 from kho.loai_thuong_mai t where t.ma = v_loai) then
      v_hop_le := true;                                       -- khớp loại → hợp lệ, giữ loai_ma/ma_ny
    else
      v_hop_le := false; v_loai := null; v_ma_ny := null;     -- loại lạ → cờ false, để NULL
    end if;
  else
    v_hop_le := false; v_loai := null; v_ma_ny := null;       -- sai dạng/rác/rỗng → cờ false, để NULL (VẪN ghi)
  end if;
  v_bot := coalesce(p_ua,'') ~* '(bot|crawl|spider|preview|facebookexternalhit)';
  insert into kho.click_chat(kenh, ref_web, loai_ma, ma_ny, ref_hop_le, dich, nguon_trang, ua, la_bot)
    values(p_kenh, coalesce(p_ref,''), v_loai, v_ma_ny, v_hop_le, coalesce(p_dich,''), p_nguon_trang, p_ua, v_bot)
    returning id into v_id;
  return v_id;
end $fn$;
-- Grant: chỉ đường OWNER (Worker). KHÔNG grant anon/authenticated — cửa duy nhất là Worker.
revoke execute on function kho.ghi_click_chat(text,text,text,text,text) from public, anon, authenticated;

do $$ begin
  if to_regprocedure('kho.ghi_click_chat(text,text,text,text,text)') is null then raise exception 'THIẾU ghi_click_chat'; end if;
  raise notice 'db/183 OK: click_chat + ghi_click_chat + cc_chan_sua (append-only).';
end $$;
commit;
