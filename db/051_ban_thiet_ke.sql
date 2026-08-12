-- 051 — QUẢN LÝ BẢN THIẾT KẾ: phiên bản render trình khách duyệt + cổng khoá cắt theo bản duyệt.
--   TÁCH khỏi tem_ban_ve (bản CẮT, sau chốt): ban_thiet_ke = ảnh RENDER khách xem, TRƯỚC chốt. Nối bằng
--   CỔNG MỘT CHIỀU: đơn chưa có bản 'khach_duyet' -> CẤM sinh tem (day_tem_ban_ve raise Ở SERVER).
--   Ảnh nén HAI CỠ trong trình duyệt (nhỏ 400px / to 1600px, WebP) -> 4 cột đường dẫn+byte. Ảnh gốc KHÔNG lưu.
--   Link gửi khách: hạn 7 ngày, khách xem KHÔNG đăng nhập, CHỈ ảnh+tên món+ghi chú (không giá/khách/đơn khác).
--   node ops/run_sql.mjs ../db/051_ban_thiet_ke.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.xem_link_khach(text); drop function if exists kho.nap_anh_link(text,jsonb);
--   drop function if exists kho.link_gui_khach(uuid); drop function if exists kho.phan_hoi_ban(uuid,text,text);
--   drop function if exists kho.gui_ban_thiet_ke(text,text,jsonb);
--   drop table if exists kho.link_ban_khach; drop table if exists kho.anh_ban_thiet_ke; drop table if exists kho.ban_thiet_ke;
--   -- day_tem_ban_ve: khôi phục bản 050 (bỏ cổng khoá cắt) — xem git.
--   delete from storage.buckets where id='ban-thiet-ke';
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ BẢNG ════════
create table if not exists kho.ban_thiet_ke (
  id            uuid primary key default gen_random_uuid(),
  ma_don        text not null references kho.don_hang(ma_don) on delete cascade,
  phien_ban     integer not null,                                   -- TỰ TĂNG theo đơn (gui_ban_thiet_ke)
  ma_ns_gui     uuid not null references kho.nguoi_dung(id),
  luc_gui       timestamptz not null default now(),
  ghi_chu       text,
  -- 5 trạng thái: 4 CEO khai + 'thay_the' = "trạng thái cũ" (bản từng duyệt, bị bản mới thay — nhãn n-cu ở mẫu)
  trang_thai    text not null default 'cho_duyet'
                check (trang_thai in ('cho_duyet','khach_duyet','khach_doi_y','chua_dung_yeu_cau','thay_the')),
  ma_ns_phan_hoi uuid references kho.nguoi_dung(id),
  luc_phan_hoi   timestamptz,
  ghi_chu_phan_hoi text,
  -- File 3D TUỲ CHỌN: CHỈ gửi khi đơn đã chốt (không gửi mọi bản). CHẶN CỨNG >100MB.
  file_3d_path  text,
  file_3d_byte  bigint check (file_3d_byte is null or file_3d_byte <= 104857600),  -- 100MB = 104857600
  unique (ma_don, phien_ban)
);
create index if not exists idx_btk_don on kho.ban_thiet_ke(ma_don);

create table if not exists kho.anh_ban_thiet_ke (
  id            uuid primary key default gen_random_uuid(),
  ban_id        uuid not null references kho.ban_thiet_ke(id) on delete cascade,
  duong_dan_nho text not null,     -- bản NHỎ (400px) — danh sách chỉ tải cái này
  duong_dan_to  text not null,     -- bản TO (1600px) — chỉ tải khi bấm xem to
  byte_nho      bigint,
  byte_to       bigint,
  thu_tu        integer not null default 0
);
create index if not exists idx_abtk_ban on kho.anh_ban_thiet_ke(ban_id);

-- Link gửi khách (hạn 7 ngày). noi_dung = ẢNH CHỤP CURATED (chỉ tên món + ghi chú), anh_url do app ký (signed URL).
create table if not exists kho.link_ban_khach (
  token     text primary key,
  ban_id    uuid not null references kho.ban_thiet_ke(id) on delete cascade,
  het_han   timestamptz not null,
  noi_dung  jsonb not null,        -- {mon:[{ten,thu_tu}], ghi_chu} — SERVER dựng, không nhận text từ client
  anh_url   jsonb default '[]',    -- [{nho,to,thu_tu}] signed URL do app ký (nap_anh_link)
  tao_boi   uuid references kho.nguoi_dung(id),
  tao_luc   timestamptz not null default now()
);

-- ════════ TRIGGER: CHỈ MỘT bản 'khach_duyet' mỗi đơn ════════
create or replace function kho.btk_mot_ban_duyet() returns trigger language plpgsql as $$
begin
  if new.trang_thai = 'khach_duyet' then
    -- bản mới duyệt -> mọi bản KHÁC của cùng đơn đang 'khach_duyet' tự chuyển 'thay_the' (trạng thái cũ)
    update kho.ban_thiet_ke
       set trang_thai = 'thay_the'
     where ma_don = new.ma_don and id <> new.id and trang_thai = 'khach_duyet';
  end if;
  return new;
end $$;
drop trigger if exists trg_btk_mot_ban_duyet on kho.ban_thiet_ke;
create trigger trg_btk_mot_ban_duyet after insert or update of trang_thai on kho.ban_thiet_ke
  for each row execute function kho.btk_mot_ban_duyet();

-- ════════ RLS ════════
alter table kho.ban_thiet_ke enable row level security;
alter table kho.anh_ban_thiet_ke enable row level security;
alter table kho.link_ban_khach enable row level security;   -- chỉ RPC (definer) chạm; deny mọi truy cập thẳng

-- ĐỌC: sale/thiet_ke/tk_ban_hang/ceo thấy MỌI bản; xuong CHỈ thấy bản 'khach_duyet' (không thấy nháp)
drop policy if exists btk_doc on kho.ban_thiet_ke;
create policy btk_doc on kho.ban_thiet_ke for select using (
  kho.current_vai_tro() in ('ceo','sale','thiet_ke','tk_ban_hang')
  or (kho.current_vai_tro() = 'xuong' and trang_thai = 'khach_duyet')
);
drop policy if exists abtk_doc on kho.anh_ban_thiet_ke;
create policy abtk_doc on kho.anh_ban_thiet_ke for select using (
  kho.current_vai_tro() in ('ceo','sale','thiet_ke','tk_ban_hang')
  or (kho.current_vai_tro() = 'xuong'
      and exists (select 1 from kho.ban_thiet_ke b where b.id = ban_id and b.trang_thai = 'khach_duyet'))
);
-- GHI: mọi thao tác qua RPC SECURITY DEFINER; không mở policy ghi trực tiếp (an toàn hơn).

-- ════════ BUCKET riêng (private) + storage RLS ════════
insert into storage.buckets (id, name, public) values ('ban-thiet-ke','ban-thiet-ke', false)
  on conflict (id) do nothing;
drop policy if exists btk_obj_doc on storage.objects;
create policy btk_obj_doc on storage.objects for select using (
  bucket_id = 'ban-thiet-ke' and kho.current_vai_tro() = any (array['ceo','kho','sale','thiet_ke','tk_ban_hang','xuong'])
);
drop policy if exists btk_obj_ghi on storage.objects;
create policy btk_obj_ghi on storage.objects for insert with check (
  bucket_id = 'ban-thiet-ke' and kho.current_vai_tro() = any (array['ceo','thiet_ke','tk_ban_hang'])
);

-- ════════ RPC 1: gửi bản thiết kế (sinh phiên bản mới) ════════
create or replace function kho.gui_ban_thiet_ke(p_ma_don text, p_ghi_chu text, p_anh jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_pb integer; v_ban uuid; a jsonb; i int := 0;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'gui_ban_thiet_ke: chỉ ceo/thiet_ke/tk_ban_hang'; end if;
  if not exists (select 1 from kho.don_hang where ma_don = p_ma_don) then
    raise exception 'gui_ban_thiet_ke: không có đơn "%"', p_ma_don; end if;
  if p_anh is null or jsonb_typeof(p_anh) <> 'array' or jsonb_array_length(p_anh) = 0 then
    raise exception 'gui_ban_thiet_ke: phải có ít nhất 1 ảnh'; end if;
  select id into v_ns from kho.nguoi_dung where auth_uid = auth.uid();
  select coalesce(max(phien_ban),0)+1 into v_pb from kho.ban_thiet_ke where ma_don = p_ma_don;
  insert into kho.ban_thiet_ke(ma_don, phien_ban, ma_ns_gui, ghi_chu, trang_thai)
    values (p_ma_don, v_pb, v_ns, p_ghi_chu, 'cho_duyet') returning id into v_ban;
  for a in select * from jsonb_array_elements(p_anh) loop
    insert into kho.anh_ban_thiet_ke(ban_id, duong_dan_nho, duong_dan_to, byte_nho, byte_to, thu_tu)
      values (v_ban, a->>'duong_dan_nho', a->>'duong_dan_to',
              (a->>'byte_nho')::bigint, (a->>'byte_to')::bigint, coalesce((a->>'thu_tu')::int, i));
    i := i + 1;
  end loop;
  -- LƯU Ý: KHÔNG đổi don_hang.trang_thai — ladder đơn không có nấc 'cho_duyet'; trạng thái chờ-duyệt của
  --   đơn SUY từ bản mới nhất (ban_thiet_ke.trang_thai='cho_duyet'), không cắm vào don_hang.
  return jsonb_build_object('ok', true, 'ban_id', v_ban, 'phien_ban', v_pb, 'so_anh', jsonb_array_length(p_anh));
end $$;
grant execute on function kho.gui_ban_thiet_ke(text,text,jsonb) to authenticated;

-- ════════ RPC 2: sale/tk_ban_hang/ceo phản hồi 1 bản ════════
create or replace function kho.phan_hoi_ban(p_ban_id uuid, p_ket_qua text, p_ghi_chu text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','sale','tk_ban_hang') then
    raise exception 'phan_hoi_ban: chỉ ceo/sale/tk_ban_hang'; end if;
  if p_ket_qua not in ('khach_duyet','khach_doi_y','chua_dung_yeu_cau') then
    raise exception 'phan_hoi_ban: kết quả không hợp lệ (%)', p_ket_qua; end if;
  -- 'khach_doi_y' và 'chua_dung_yeu_cau' BẮT BUỘC ghi chú: đây là nguồn PHÂN LOẠI cho chỉ số thành tích
  --   lô sau — thiết kế KHÔNG tự chấm mình, phải có lý do khách/sale nêu.
  if p_ket_qua in ('khach_doi_y','chua_dung_yeu_cau') and coalesce(btrim(p_ghi_chu),'') = '' then
    raise exception 'phan_hoi_ban: "%" bắt buộc có ghi chú (vì sao)', p_ket_qua; end if;
  select id into v_ns from kho.nguoi_dung where auth_uid = auth.uid();
  update kho.ban_thiet_ke
     set trang_thai = p_ket_qua, ma_ns_phan_hoi = v_ns, luc_phan_hoi = now(), ghi_chu_phan_hoi = p_ghi_chu
   where id = p_ban_id;
  if not found then raise exception 'phan_hoi_ban: không có bản %', p_ban_id; end if;
  return jsonb_build_object('ok', true, 'ban_id', p_ban_id, 'trang_thai', p_ket_qua);
end $$;
grant execute on function kho.phan_hoi_ban(uuid,text,text) to authenticated;

-- ════════ RPC 3: link gửi khách (hạn 7 ngày) — sinh token + nội dung CURATED ════════
create or replace function kho.link_gui_khach(p_ban_id uuid)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_token text; v_ma_don text; v_mon jsonb; v_ghi text; v_anh jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','sale','tk_ban_hang') then
    raise exception 'link_gui_khach: chỉ ceo/sale/tk_ban_hang'; end if;
  select b.ma_don, b.ghi_chu into v_ma_don, v_ghi from kho.ban_thiet_ke b where b.id = p_ban_id;
  if v_ma_don is null then raise exception 'link_gui_khach: không có bản %', p_ban_id; end if;
  select id into v_ns from kho.nguoi_dung where auth_uid = auth.uid();
  -- CURATED: CHỈ tên món + ghi chú của bản. TUYỆT ĐỐI không giá / tên khách / đơn khác.
  --   (row_number không nằm trong jsonb_agg được — tính thứ tự ở subquery rồi mới gộp.)
  select coalesce(jsonb_agg(jsonb_build_object('ten', ten, 'thu_tu', rn) order by rn), '[]') into v_mon
    from (select m.ten, row_number() over (order by m.tao_luc) rn
            from kho.don_hang d join kho.don_hang_mon m on m.don_id = d.id where d.ma_don = v_ma_don) s;
  select coalesce(jsonb_agg(jsonb_build_object('duong_dan_nho', a.duong_dan_nho, 'duong_dan_to', a.duong_dan_to, 'thu_tu', a.thu_tu) order by a.thu_tu), '[]')
    into v_anh from kho.anh_ban_thiet_ke a where a.ban_id = p_ban_id;
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into kho.link_ban_khach(token, ban_id, het_han, noi_dung, tao_boi)
    values (v_token, p_ban_id, now() + interval '7 days',
            jsonb_build_object('mon', v_mon, 'ghi_chu', v_ghi), v_ns);
  -- trả token + đường dẫn ảnh để APP KÝ signed URL (SQL không ký được) rồi nạp qua nap_anh_link
  return jsonb_build_object('ok', true, 'token', v_token, 'het_han', now() + interval '7 days', 'anh', v_anh);
end $$;
grant execute on function kho.link_gui_khach(uuid) to authenticated;

-- ════════ RPC 4: app nạp signed URL (đã ký 7 ngày) vào link ════════
create or replace function kho.nap_anh_link(p_token text, p_urls jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','sale','tk_ban_hang') then
    raise exception 'nap_anh_link: chỉ ceo/sale/tk_ban_hang'; end if;
  update kho.link_ban_khach set anh_url = coalesce(p_urls,'[]') where token = p_token;
  if not found then raise exception 'nap_anh_link: không có link'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function kho.nap_anh_link(text,jsonb) to authenticated;

-- ════════ RPC 5: KHÁCH xem (KHÔNG đăng nhập) — chỉ ảnh + tên món + ghi chú ════════
create or replace function kho.xem_link_khach(p_token text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare r kho.link_ban_khach;
begin
  select * into r from kho.link_ban_khach where token = p_token;
  if r.token is null then raise exception 'link không tồn tại'; end if;
  if r.het_han < now() then raise exception 'link đã hết hạn'; end if;
  -- CHỈ trả nội dung curated + ảnh. KHÔNG giá, KHÔNG tên khách, KHÔNG đơn khác.
  return jsonb_build_object('mon', r.noi_dung->'mon', 'ghi_chu', r.noi_dung->'ghi_chu', 'anh', r.anh_url);
end $$;
grant execute on function kho.xem_link_khach(text) to anon, authenticated;

-- ════════ VÁ day_tem_ban_ve: CỔNG KHOÁ CẮT Ở SERVER ════════
--   Chưa có bản thiết kế 'khach_duyet' -> CẤM sinh tem. Chặn Ở SERVER nên nút đẩy tem VÀ day_tem_lai của
--   plugin (lách được cổng client lô trước) ĐỀU bị chặn. NGOẠI LỆ: đơn dong='le' toàn mẫu sẵn (không có món
--   dung_moi) — khách chọn catalog, không cần duyệt 3D.
create or replace function kho.day_tem_ban_ve(p_ma_don text, p_tam jsonb)
 returns jsonb language plpgsql security definer set search_path to 'kho'
as $function$
declare v_pb integer; t jsonb; v_bac boolean := false; v_don kho.don_hang; v_le_mau_san boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke') then
    raise exception 'day_tem_ban_ve: chỉ ceo/kho/thiet_ke';
  end if;
  select * into v_don from kho.don_hang d where d.ma_don = p_ma_don;
  if v_don.ma_don is null then
    raise exception 'day_tem_ban_ve: không có đơn "%"', p_ma_don;
  end if;

  -- [CỔNG KHOÁ CẮT] — không cắt ván khi khách chưa duyệt bản thiết kế.
  v_le_mau_san := (v_don.dong = 'le'
                   and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau_san
     and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'day_tem_ban_ve: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT — chưa được cắt ván.', p_ma_don;
  end if;

  select coalesce(max(phien_ban),0)+1 into v_pb from kho.tem_ban_ve where ma_don = p_ma_don;   -- phien_ban tăng
  for t in select * from jsonb_array_elements(p_tam) loop
    insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,duong_dan_svg)
      values(p_ma_don, v_pb, t->>'ma_tam', t->>'vai_tro',
             (t->>'dai')::numeric, (t->>'rong')::numeric, (t->>'day')::numeric,
             coalesce(t->'canh_dan','[]'::jsonb), (t->>'kien')::int,
             p_ma_don||'/'||v_pb||'/'||replace(replace(t->>'ma_tam','|','_'),'#','_')||'.svg');
  end loop;

  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat'
    where ma_don = p_ma_don and trang_thai in ('xong_file','moi_len_don');
  v_bac := found;
  perform set_config('chan.tu_mon','',true);

  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'phien_ban',v_pb,
                            'so_tam',jsonb_array_length(p_tam),'vao_chuyen',v_bac);
end $function$;

commit;
