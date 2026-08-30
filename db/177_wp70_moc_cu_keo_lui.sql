-- db/177 · WP-70 L-02e · MỐC CŨ (kéo lùi) — vá LỖ 1: chạm trần thì phần cũ không ai kéo.
--   L-02c-c: cả 3 trang chạm trần 1200 (forward theo updated_at desc) và ghi mốc = MỚI NHẤT.
--   Lần sau chỉ lấy phần mới hơn mốc → khối "còn tồn" phía sau (updated_at cũ hơn ranh giới cửa sổ)
--   nằm lại mãi. Nếu 1200 mới nhất chưa phủ hết kỳ đang tính → màn CAC ra số THIẾU mà không ai biết.
--
--   VÁ: lead_moc_keo thêm 2 cột frontier LÙI:
--     · moc_cu               = updated_at CŨ NHẤT đã kéo tới (đi tiếp về quá khứ từ đây).
--     · moc_cu_hoi_thoai_id  = last_conversation_id tại frontier (con trỏ đi tiếp).
--   Bộ kéo 2 chế độ: --moi (xuôi từ moc_cap_nhat, như cũ) · --lui (tiếp từ moc_cu về quá khứ).
--   RPC lead_moc_cu_ghi (DEFINER, cùng cửa GUC/vai như lead_moc_ghi) — client chỉ SELECT.
--
--   HOÀN TÁC: alter table kho.lead_moc_keo drop column moc_cu, drop column moc_cu_hoi_thoai_id;
--     drop function kho.lead_moc_cu_ghi(text, timestamptz, text, int);
--
--   ⚠ CẤM cờ BO_QUA_BACKUP từ db/177 (siết 29/08, QD-61) — migration này CHẠY BACKUP BÌNH THƯỜNG.

-- (1) 2 cột frontier lùi (nullable — trang chưa kéo lùi lần nào thì để NULL).
alter table kho.lead_moc_keo add column if not exists moc_cu              timestamptz;
alter table kho.lead_moc_keo add column if not exists moc_cu_hoi_thoai_id text;

-- (2) lead_moc_cu_ghi — ghi frontier LÙI. Cùng cửa (ceo/ke_toan | GUC kho.lead_he_thong) như lead_moc_ghi.
--     Chỉ đụng 2 cột moc_cu*; KHÔNG chạm moc_cap_nhat (frontier xuôi) — hai đầu độc lập.
--     Dòng chưa tồn tại (trang mới) → tạo dòng chỉ có frontier lùi.
create or replace function kho.lead_moc_cu_ghi(p_page_id text, p_moc_cu timestamptz default null,
    p_moc_cu_hoi_thoai_id text default null, p_so_ban_ghi int default null)
returns kho.lead_moc_keo language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); r kho.lead_moc_keo;
begin
  if not (v_vai in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then
    raise exception 'lead_moc_cu_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.lead_he_thong)'; end if;
  if p_page_id is null then raise exception 'lead_moc_cu_ghi: thiếu page_id'; end if;
  insert into kho.lead_moc_keo(page_id, moc_cu, moc_cu_hoi_thoai_id, lan_keo_luc, so_ban_ghi_lan_cuoi)
    values(p_page_id, p_moc_cu, p_moc_cu_hoi_thoai_id, now(), p_so_ban_ghi)
  on conflict (page_id) do update set
    moc_cu = excluded.moc_cu, moc_cu_hoi_thoai_id = excluded.moc_cu_hoi_thoai_id,
    lan_keo_luc = now(), so_ban_ghi_lan_cuoi = excluded.so_ban_ghi_lan_cuoi
  returning * into r;
  return r;
end $fn$;
grant execute on function kho.lead_moc_cu_ghi(text, timestamptz, text, int) to authenticated;
