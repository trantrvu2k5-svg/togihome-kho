-- db/184 · WP-79 L-79e · NỚI sổ click_chat nhận ĐƯỜNG DẪN TRANG + số id_web thô. QD-78.
--   ⚠ KHÔNG IDEMPOTENT: add column / drop+create function chạy lại sẽ LỖI (add column trùng). Chạy ĐÚNG MỘT LẦN.
--   Vì sao nới: sconcept.vn là SPA, cụm nút chat CỐ ĐỊNH toàn site — "khách ở trang nào" chỉ biết lúc click,
--     và biết dưới dạng ĐƯỜNG DẪN (pathname), CHƯA phải mã loại. Quy đổi đường-dẫn→loại là việc của HỆ (làm sau
--     khi niem_yet.id_web được điền, hiện 0/24), KHÔNG nhét vào GTM (đẻ danh mục thứ hai — trái QD-03).
--   ⚠ Cổng backup QD-61: dump fail → DỪNG. CẤM tự bật BO_QUA_BACKUP (bài học db/176 — chỉ CEO tự gõ mới hợp lệ).
--   HOÀN TÁC: drop function kho.ghi_click_chat(text,text,text,text,text,text,integer);
--     alter table kho.click_chat drop column id_web, drop column duong_dan;
--     (và tạo lại bản 5 tham số của db/183 nếu muốn về nguyên trạng).
begin;

-- ── Hai cột THÔ, đều nullable (nới, KHÔNG siết). KHÔNG thêm index: chưa ai lọc theo 2 cột này. ──
alter table kho.click_chat add column duong_dan text null;
alter table kho.click_chat add column id_web    integer null;
comment on column kho.click_chat.duong_dan is 'THÔ từ trình duyệt: pathname lúc click (vd /san-pham/sofa-...-sb19....27). CHƯA quy đổi sang loai_thuong_mai.';
comment on column kho.click_chat.id_web is 'THÔ: số cuối đường dẫn sản phẩm (khớp niem_yet.id_web). Quy đổi làm SAU khi niem_yet.id_web điền đủ (hiện 0/24). Chưa đối chiếu → chỉ lưu số.';

-- ── Sửa RPC: thêm 2 tham số CÓ MẶC ĐỊNH. BẮT BUỘC DROP bản cũ trước (đổi tham số mà create-or-replace ──
--    KHÔNG thay bản cũ → đẻ overload, gọi nhầm — bài học 03 §C vụ atp). Worker gọi 5 tham số vẫn chạy (2 cái mới default null).
drop function if exists kho.ghi_click_chat(text,text,text,text,text);
create function kho.ghi_click_chat(
    p_ref text, p_kenh text, p_dich text, p_nguon_trang text, p_ua text,
    p_duong_dan text default null, p_id_web integer default null)
returns uuid language plpgsql security definer set search_path to 'kho' as $fn$
declare v_after text; v_loai text; v_ma_ny text; v_hop_le boolean := false; v_bot boolean; v_id_web integer; v_id uuid;
begin
  -- chỉ kenh sai mới TỪ CHỐI (ref rác vẫn ghi — QD-69)
  if p_kenh is null or p_kenh not in ('zalo','messenger','instagram') then
    raise exception 'ghi_click_chat: kenh không hợp lệ: %', coalesce(p_kenh,'(null)');
  end if;
  -- tách ref dạng web-<loai>-<ma_ny> ; loại KHÔNG có gạch (sofa/tu/ban_an…) nên loai = tới gạch ĐẦU sau 'web-'
  if p_ref ~ '^web-[^-]+-.+$' then
    v_after := substring(p_ref from 5);
    v_loai  := split_part(v_after, '-', 1);
    v_ma_ny := substring(v_after from length(v_loai) + 2);
    if exists (select 1 from kho.loai_thuong_mai t where t.ma = v_loai) then
      v_hop_le := true;
    else
      v_hop_le := false; v_loai := null; v_ma_ny := null;
    end if;
  else
    v_hop_le := false; v_loai := null; v_ma_ny := null;
  end if;
  v_bot := coalesce(p_ua,'') ~* '(bot|crawl|spider|preview|facebookexternalhit)';
  -- id_web: tham số truyền THẮNG; không có thì tách số CUỐI đường dẫn (dạng `.<số>` ở cuối chuỗi); không có → NULL.
  --   KHÔNG đối chiếu niem_yet (0/24 trống → đối chiếu giờ chỉ sinh cờ sai) — chỉ lưu số.
  if p_id_web is not null then v_id_web := p_id_web;
  elsif p_duong_dan is not null then v_id_web := (substring(p_duong_dan from '\.(\d+)$'))::integer;
  else v_id_web := null; end if;
  insert into kho.click_chat(kenh, ref_web, loai_ma, ma_ny, ref_hop_le, dich, nguon_trang, ua, la_bot, duong_dan, id_web)
    values(p_kenh, coalesce(p_ref,''), v_loai, v_ma_ny, v_hop_le, coalesce(p_dich,''), p_nguon_trang, p_ua, v_bot, p_duong_dan, v_id_web)
    returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function kho.ghi_click_chat(text,text,text,text,text,text,integer) from public, anon, authenticated;

do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='kho' and p.proname='ghi_click_chat';
  if n <> 1 then raise exception 'db/184: PHẢI còn ĐÚNG 1 ghi_click_chat, đang có %', n; end if;
  raise notice 'db/184 OK: +duong_dan +id_web · ghi_click_chat còn ĐÚNG 1 hàm (7 tham số).';
end $$;
commit;
