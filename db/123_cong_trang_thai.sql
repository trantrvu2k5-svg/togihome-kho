-- 123 — VÁ CỔNG TRẠNG THÁI (WP-03 / L-66): trạng thái đơn chỉ đổi qua CỔNG NGHIỆP VỤ của nó.
--   CĂN CỨ ERP §6.4: phát hành lệnh sản xuất là một BƯỚC RIÊNG, KHÔNG phải hệ quả phụ của việc xuất file/tem.
--   (a) day_tem_ban_ve: BỎ "bắc cầu" set trang_thai='cho_cat' (db/053:335-337) — tem đến trước bàn giao thì chỉ LƯU
--       tem, trạng thái GIỮ NGUYÊN. ban_giao_xuong (db/071) là nơi DUY NHẤT chuyển cho_cat.
--       PHÁT SINH (không sửa lô này): day_so_san_xuat (db/068) cũng set cho_cat nhưng KHÔNG có caller (chết);
--       dua_vao_chuyen (db/045) set cho_cat là NÚT THỦ CÔNG "Đưa vào chuyền" của quản đốc (cổng nghiệp vụ hợp lệ).
--   (b) pt_ghi: RAISE khi loai='thu_khi_giao' mà đơn chưa ở {cho_giao,da_giao} — gợi ý dùng loai='coc'. Loại khác giữ nguyên.
--   IDEMPOTENT: create or replace cả 2 hàm. HOÀN TÁC: chạy lại db/053 (day_tem_ban_ve) + db/116 (pt_ghi).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ (a) day_tem_ban_ve — GỠ bắc cầu cho_cat ═══════════
create or replace function kho.day_tem_ban_ve(p_ma_don text, p_tam jsonb)
  returns jsonb language plpgsql security definer set search_path to 'kho'
as $function$
declare v_pb integer; t jsonb; v_don kho.don_hang; v_le_mau_san boolean; v_vai text; v_ten text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai = 'tk_ban_hang' then
    raise exception 'day_tem_ban_ve: thiết kế bán hàng không xuất file cắt (chỉ dựng 3D cho khách)';
  end if;
  if v_vai not in ('ceo','kho','thiet_ke') then
    raise exception 'day_tem_ban_ve: chỉ ceo/kho/thiết kế sản xuất';
  end if;
  select * into v_don from kho.don_hang d where d.ma_don = p_ma_don;
  if v_don.ma_don is null then
    raise exception 'day_tem_ban_ve: không có đơn "%"', p_ma_don;
  end if;

  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then
      raise exception 'day_tem_ban_ve: đơn "%" CHƯA AI NHẬN việc thiết kế — nhận việc trước khi đẩy tem', p_ma_don;
    end if;
    if v_don.ma_ns_thiet_ke <> kho.current_ns() then
      select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
      raise exception 'day_tem_ban_ve: đơn "%" đang do % cầm — chỉ người cầm mới đẩy tem', p_ma_don, coalesce(v_ten,'người khác');
    end if;
  end if;

  -- [CỔNG KHOÁ CẮT] — không cắt ván khi khách chưa duyệt bản thiết kế (trừ đơn le mẫu sẵn).
  v_le_mau_san := (v_don.dong = 'le'
                   and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau_san
     and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'day_tem_ban_ve: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT — chưa được cắt ván.', p_ma_don;
  end if;

  select coalesce(max(phien_ban),0)+1 into v_pb from kho.tem_ban_ve where ma_don = p_ma_don;
  for t in select * from jsonb_array_elements(p_tam) loop
    insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,duong_dan_svg)
      values(p_ma_don, v_pb, t->>'ma_tam', t->>'vai_tro',
             (t->>'dai')::numeric, (t->>'rong')::numeric, (t->>'day')::numeric,
             coalesce(t->'canh_dan','[]'::jsonb), (t->>'kien')::int,
             p_ma_don||'/'||v_pb||'/'||replace(replace(t->>'ma_tam','|','_'),'#','_')||'.svg');
  end loop;

  -- WP-03: tem KHÔNG còn bắc cầu vào chuyền (ERP §6.4 — tem không phát hành lệnh SX). buoc_thiet_ke là bộ đếm
  --   THIẾT KẾ (không phải trang_thai đơn) → giữ, đánh dấu design đã ra file cắt.
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where ma_don = p_ma_don;

  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'phien_ban',v_pb,
                            'so_tam',jsonb_array_length(p_tam),'vao_chuyen',false);
end $function$;

-- ═══════════ (b) pt_ghi — chặn thu_khi_giao trước khi giao ═══════════
create or replace function kho.pt_ghi(p_phieu jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v_nguoi text := coalesce((select ho_ten from kho.nguoi_dung where id=kho.current_ns()),'');
  v_ma text := btrim(coalesce(p_phieu->>'ma_don','')); v_id bigint; v_st numeric := coalesce(nullif(p_phieu->>'so_tien','')::numeric,0);
  v_tt text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'pt_ghi: chỉ ceo/ke_toan'; end if;
  if v_ma='' then raise exception 'pt_ghi: thiếu ma_don'; end if;
  select trang_thai into v_tt from kho.don_hang where ma_don=v_ma;
  if v_tt is null then raise exception 'pt_ghi: đơn % không tồn tại', v_ma; end if;
  if v_st <= 0 then raise exception 'pt_ghi: số tiền phải > 0'; end if;
  if coalesce(p_phieu->>'loai','') not in ('coc','thu_khi_giao','thu_no','doi_soat_cod') then
    raise exception 'pt_ghi: loại phiếu không hợp lệ'; end if;
  -- WP-03: thu-khi-giao chỉ SAU khi giao (đơn ở cho_giao/da_giao). Đơn chưa giao mà thu → là CỌC.
  if p_phieu->>'loai' = 'thu_khi_giao' and v_tt not in ('cho_giao','da_giao') then
    raise exception 'pt_ghi: đơn % đang ở "%" — thu-khi-giao chỉ sau khi giao (cho_giao/da_giao). Nhận tiền trước khi giao dùng loai=''coc''.', v_ma, v_tt;
  end if;
  insert into kho.phieu_thu(ma_don,ngay,so_tien,loai,ghi_chu,nguoi_ghi)
    values(v_ma, coalesce(nullif(p_phieu->>'ngay','')::date, current_date), v_st, p_phieu->>'loai',
           nullif(p_phieu->>'ghi_chu',''), coalesce(nullif(p_phieu->>'nguoi_ghi',''), v_nguoi))
    returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

commit;
