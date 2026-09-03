-- WP-14b · L-3 · ĐÓNG DẤU ma_ky_ap_dung LÚC CHỐT ĐƠN. ĐẢO kết luận WP-11c: cột này THÔI là ứng viên DROP.
-- Lý do: cổng tra giá (gia_san_don/gia_bao_khach/tran_giam_gia + 7 hàm giá) chọn dòng tham_so_tai_chinh bằng
--   `order by ngay_ap_dung desc nulls last, ma_ky desc limit 1` = kỳ MỚI NHẤT, KHÔNG lọc theo ngày chốt.
--   ⟹ kỳ ra giá KHÔNG phải hàm của ngày → suy ngược theo ngày là SAI nguyên tắc (không chỉ vì múi giờ, L-2 đã vá TZ).
--   Nhãn kỳ phải GHI LẠI lúc chốt (Garrison ch.10: đóng dấu tại thời điểm giao dịch).

-- ── MỘT NGUỒN SỰ THẬT cho "kỳ giá đang dùng" (04 §A cấm nhân bản) ──
-- chot_don GỌI hàm này (không inline copy). ⚠ 10 hàm giá còn inline biểu thức y hệt (nợ CŨ, có trước L-3) →
--   consolidate cho chúng gọi lại ở lệnh riêng (cần golden byte-identical giá), KHÔNG đụng pricing sống ở đây.
create or replace function kho.ky_gia_hien_hanh()
returns text language sql stable security definer set search_path = kho, pg_temp as $$
  select ma_ky from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1
$$;

comment on column kho.don_hang.ma_ky_ap_dung is
  'kỳ tham số THỰC DÙNG lúc chốt, do chot_don ghi (kho.ky_gia_hien_hanh); KHÔNG suy từ ngày chốt. '
  'NULL = chốt TRƯỚC cơ chế này (WP-14b L-3), hoặc chốt lúc chưa có dòng tham số. Bất biến sau khi đóng dấu.';

-- ── chot_don: đóng dấu ma_ky_ap_dung (chỉ khi NULL), trả cờ thieu_tham_so ──
CREATE OR REPLACE FUNCTION kho.chot_don(p_don_id uuid, p_nguon_khach text, p_thuong_hieu text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho', 'public'
AS $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang; v_sdt text; v_e164 text; v_ad text;
        v_ky text := kho.ky_gia_hien_hanh();   -- [WP-14b L-3] kỳ giá đang dùng lúc chốt
begin
  if v_vai not in ('ceo','kho','sale','tk_ban_hang') then
    raise exception 'chot_don: chỉ ceo/kho/sale/tk_ban_hang (vai "%")', v_vai; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'chot_don: không có đơn %', p_don_id; end if;
  if v_don.trang_thai = 'moi_len_don' then
    raise exception 'chot_don: đơn "%" ĐÃ lên đơn rồi (moi_len_don)', v_don.ma_don; end if;
  if v_don.trang_thai not in ('bao_gia','bao_gia_treo') then
    raise exception 'chot_don: đơn "%" đang "%" — chỉ chốt được đơn báo giá (bao_gia/bao_gia_treo)', v_don.ma_don, v_don.trang_thai; end if;
  update kho.don_hang
     set nguon_khach = coalesce(nullif(btrim(p_nguon_khach),''), nguon_khach),
         thuong_hieu = coalesce(nullif(btrim(p_thuong_hieu),''), thuong_hieu),
         trang_thai  = 'moi_len_don',
         ma_ky_ap_dung = coalesce(ma_ky_ap_dung, v_ky)   -- [WP-14b L-3] chỉ ghi khi NULL, KHÔNG đè
   where id = p_don_id;

  -- [WP-77] HÀNG ĐỢI Meta: 1 dòng Purchase, KHÔNG gọi mạng ở đây. Idempotent (unique don_id+loai) → chống đếm đôi/re-chốt.
  v_sdt  := kho.chuan_hoa_sdt(v_don.sdt_khach);
  v_e164 := case when v_sdt is not null then '84' || substr(v_sdt, 2) else null end;
  select ad_id into v_ad from kho.lead where id = v_don.lead_id;
  insert into kho.su_kien_meta(don_id, loai_su_kien, event_id, gia_tri, tien_te, sdt_bam, ad_id, ma_hoi_thoai, thoi_diem_don, trang_thai)
    values(p_don_id, 'Purchase', v_don.ma_don, v_don.doanh_thu, 'VND',
           case when v_e164 is not null then encode(extensions.digest(v_e164, 'sha256'), 'hex') else null end,
           v_ad, v_don.lead_id, now(), 'cho')
    on conflict (don_id, loai_su_kien) do nothing;

  -- thieu_tham_so=true khi CHƯA có dòng tham số (v_ky null): KHÔNG chặn sale chốt (chặn bán hàng vì thiếu tham số hại hơn).
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', 'moi_len_don',
                            'ma_ky_ap_dung', coalesce(v_don.ma_ky_ap_dung, v_ky), 'thieu_tham_so', (v_ky is null));
end $function$;

-- ── Trigger đông cứng ma_ky_ap_dung sau khi đóng dấu (họ chot_luc QD-50 — nhãn đã đóng là lịch sử) ──
create or replace function kho.chan_sua_ma_ky_ap_dung() returns trigger
language plpgsql as $$
begin
  if old.ma_ky_ap_dung is not null and new.ma_ky_ap_dung is distinct from old.ma_ky_ap_dung then
    raise exception 'ma_ky_ap_dung đã đóng dấu "%" — bất biến, không sửa/xoá (WP-14b L-3)', old.ma_ky_ap_dung; end if;
  return new;
end $$;
drop trigger if exists trg_chan_sua_ma_ky_ap_dung on kho.don_hang;
create trigger trg_chan_sua_ma_ky_ap_dung before update on kho.don_hang
  for each row execute function kho.chan_sua_ma_ky_ap_dung();

grant execute on function kho.ky_gia_hien_hanh() to authenticated;
