-- 116 — DÒNG TIỀN THEO KỲ: sổ phiếu thu + sổ COD + sổ giao dịch vốn + màn 7 khối (L-49).
--   ⚠ IDEMPOTENT: create table if not exists · alter add column if not exists · create or replace hàm.
--   CĂN CỨ (Garrison ch.14 — direct method): tách khu ĐẦU TƯ & VỐN (mua/bán tài sản, vay/trả vay, góp/rút vốn) khỏi
--     kinh doanh; ghi GỘP KHÔNG BÙ TRỪ (vay mới + trả gốc = 2 dòng riêng); khép vòng: quỹ đầu + ròng KD + ròng ngoài KD = cuối.
--   NGUỒN SỰ THẬT thu tiền = kho.phieu_thu (đơn·ngày·số tiền·loại đợt). Cột don_hang.ngay_thu/so_tien_thuc_thu cũ ĐÓNG BĂNG
--     lịch sử (giữ, KHÔNG feed công thức mới). Con_phai_thu = gia_chot − Σ phieu_thu. HỢP NHẤT db/104: dieu_hanh_cong_no_khach
--     chuyển sang cùng nguồn phieu_thu (một số, màn cũ trỏ sang).
--   COD: xuất xưởng → giao_cod(dang_giao); đối soát đợt → phieu_thu 'doi_soat_cod' TỪNG đơn + da_doi_soat (1 RPC/1 tx, đơn
--     sai từ chối cả đợt); phí VC trừ trên đối soát → chi_phi_ky 'khac' ghi chú "phí VC/COD" (v1 ghi ngỏ tách loại); hoàn →
--     'hoan', KHÔNG sinh phiếu, tiền không đếm. Lãi vay ở chi_phi_ky 'khac' (KHÔNG ở giao_dich_von); gốc vay ở giao_dich_von.
--   ADS ở dòng tiền = Σ so_tien_nhap GỒM VAT (tiền thật chi ra) — KHÁC màn CAC (bóc VAT). Công nợ gồm VAT. Vật tư CHƯA có sổ kỳ.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.dong_tien_ky(text), kho.con_phai_thu(int), kho.dong_tien_rong(text),
--     kho.pt_ghi(jsonb), kho.pt_xoa(bigint), kho.pt_ds(text), kho.cod_ghi(jsonb), kho.cod_doi_soat(jsonb),
--     kho.cod_hoan(text,date,text), kho.von_ghi(jsonb), kho.von_xoa(bigint), kho.quy_ghi(text,numeric,text);
--   drop table if exists kho.phieu_thu, kho.giao_cod, kho.giao_dich_von;
--   alter table kho.tham_so_tai_chinh drop column if exists quy_dau_ky;
--   -- dieu_hanh_cong_no_khach: chạy lại db/104 (bản so_tien_thuc_thu). commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 0. QUỸ ĐẦU KỲ trên tham_so_tai_chinh ═══════════════
alter table kho.tham_so_tai_chinh add column if not exists quy_dau_ky numeric;
comment on column kho.tham_so_tai_chinh.quy_dau_ky is 'Quỹ tiền đầu kỳ (đồng). Kỳ đầu nhập tay; kỳ sau gợi ý = quỹ cuối kỳ trước, sửa phải ghi lý do vào ghi_chu.';

-- ═══════════════ 1. BẢNG phieu_thu — nguồn sự thật thu tiền ═══════════════
create table if not exists kho.phieu_thu (
  id           bigserial primary key,
  ma_don       text not null references kho.don_hang(ma_don) on delete cascade,
  ngay         date not null,
  so_tien      numeric not null check (so_tien > 0),
  loai         text not null check (loai in ('coc','thu_khi_giao','thu_no','doi_soat_cod')),
  ghi_chu      text, nguoi_ghi text, cap_nhat_luc timestamptz default now()
);
drop index if exists kho.idx_phieu_thu_ma_don;
create index if not exists idx_phieu_thu_ma_don on kho.phieu_thu(ma_don) include (so_tien);   -- phủ so_tien → pt-agg index-only (dong_tien_ky/con_phai_thu 100k)
create index if not exists idx_phieu_thu_ngay   on kho.phieu_thu(ngay);
create index if not exists idx_phieu_thu_loai   on kho.phieu_thu(loai);
grant select on kho.phieu_thu to authenticated; revoke all on kho.phieu_thu from anon;
alter table kho.phieu_thu enable row level security;
drop policy if exists phieu_thu_doc on kho.phieu_thu;
create policy phieu_thu_doc on kho.phieu_thu for select using (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- ═══════════════ 2. BẢNG giao_cod — trạng thái tiền thứ ba (COD đang giao) ═══════════════
create table if not exists kho.giao_cod (
  id             bigserial primary key,
  ma_don         text not null unique references kho.don_hang(ma_don) on delete cascade,
  ngay_xuat      date not null,
  so_tien_thu_ho numeric not null check (so_tien_thu_ho > 0),
  don_vi_vc      text,
  trang_thai     text not null default 'dang_giao' check (trang_thai in ('dang_giao','da_doi_soat','hoan')),
  ngay_ket_thuc  date,
  ghi_chu        text, nguoi_ghi text, cap_nhat_luc timestamptz default now()
);
create index if not exists idx_giao_cod_trang_thai on kho.giao_cod(trang_thai);
create index if not exists idx_giao_cod_ngay_xuat  on kho.giao_cod(ngay_xuat);
grant select on kho.giao_cod to authenticated; revoke all on kho.giao_cod from anon;
alter table kho.giao_cod enable row level security;
drop policy if exists giao_cod_doc on kho.giao_cod;
create policy giao_cod_doc on kho.giao_cod for select using (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- ═══════════════ 3. BẢNG giao_dich_von — khu đầu tư & vốn (Garrison ch.14) ═══════════════
create table if not exists kho.giao_dich_von (
  id           bigserial primary key,
  ngay         date not null,
  loai         text not null check (loai in ('vay_moi','tra_goc_vay','mua_tai_san','ban_tai_san','gop_von','rut_von')),
  so_tien      numeric not null check (so_tien > 0),
  ghi_chu      text, nguoi_ghi text, cap_nhat_luc timestamptz default now()
);
create index if not exists idx_giao_dich_von_ngay on kho.giao_dich_von(ngay);
create index if not exists idx_giao_dich_von_loai on kho.giao_dich_von(loai);
grant select on kho.giao_dich_von to authenticated; revoke all on kho.giao_dich_von from anon;
alter table kho.giao_dich_von enable row level security;
drop policy if exists giao_dich_von_doc on kho.giao_dich_von;
create policy giao_dich_von_doc on kho.giao_dich_von for select using (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- ═══════════════ 4. phieu_thu: pt_ghi / pt_xoa / pt_ds ═══════════════
create or replace function kho.pt_ghi(p_phieu jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v_nguoi text := coalesce((select ho_ten from kho.nguoi_dung where id=kho.current_ns()),'');
  v_ma text := btrim(coalesce(p_phieu->>'ma_don','')); v_id bigint; v_st numeric := coalesce(nullif(p_phieu->>'so_tien','')::numeric,0);
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'pt_ghi: chỉ ceo/ke_toan'; end if;
  if v_ma='' then raise exception 'pt_ghi: thiếu ma_don'; end if;
  if not exists(select 1 from kho.don_hang where ma_don=v_ma) then raise exception 'pt_ghi: đơn % không tồn tại', v_ma; end if;
  if v_st <= 0 then raise exception 'pt_ghi: số tiền phải > 0'; end if;
  if coalesce(p_phieu->>'loai','') not in ('coc','thu_khi_giao','thu_no','doi_soat_cod') then
    raise exception 'pt_ghi: loại phiếu không hợp lệ'; end if;
  insert into kho.phieu_thu(ma_don,ngay,so_tien,loai,ghi_chu,nguoi_ghi)
    values(v_ma, coalesce(nullif(p_phieu->>'ngay','')::date, current_date), v_st, p_phieu->>'loai',
           nullif(p_phieu->>'ghi_chu',''), coalesce(nullif(p_phieu->>'nguoi_ghi',''), v_nguoi))
    returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;
grant execute on function kho.pt_ghi(jsonb) to authenticated;

create or replace function kho.pt_xoa(p_id bigint) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'pt_xoa: chỉ ceo/ke_toan'; end if;
  delete from kho.phieu_thu where id=p_id; get diagnostics v = row_count;
  return jsonb_build_object('ok', v>0, 'da_xoa', v);
end $$;
grant execute on function kho.pt_xoa(bigint) to authenticated;

create or replace function kho.pt_ds(p_don text) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v jsonb; v_tong numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'pt_ds: chỉ ceo/ke_toan'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ngay, x.id),'[]'::jsonb), coalesce(sum(x.so_tien),0) into v, v_tong
    from (select id,ma_don,ngay,so_tien,loai,ghi_chu,nguoi_ghi,cap_nhat_luc from kho.phieu_thu where ma_don=p_don) x;
  return jsonb_build_object('ma_don',p_don,'ds',v,'tong',v_tong);
end $$;
grant execute on function kho.pt_ds(text) to authenticated;

-- ═══════════════ 5. COD: cod_ghi / cod_doi_soat / cod_hoan ═══════════════
create or replace function kho.cod_ghi(p_dong jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v_nguoi text := coalesce((select ho_ten from kho.nguoi_dung where id=kho.current_ns()),'');
  v_ma text := btrim(coalesce(p_dong->>'ma_don','')); v_st numeric := coalesce(nullif(p_dong->>'so_tien_thu_ho','')::numeric,0);
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'cod_ghi: chỉ ceo/ke_toan'; end if;
  if v_ma='' then raise exception 'cod_ghi: thiếu ma_don'; end if;
  if not exists(select 1 from kho.don_hang where ma_don=v_ma) then raise exception 'cod_ghi: đơn % không tồn tại', v_ma; end if;
  if v_st <= 0 then raise exception 'cod_ghi: số tiền thu hộ phải > 0'; end if;
  insert into kho.giao_cod(ma_don,ngay_xuat,so_tien_thu_ho,don_vi_vc,trang_thai,ghi_chu,nguoi_ghi)
    values(v_ma, coalesce(nullif(p_dong->>'ngay_xuat','')::date, current_date), v_st,
           nullif(p_dong->>'don_vi_vc',''), 'dang_giao', nullif(p_dong->>'ghi_chu',''), v_nguoi)
    on conflict (ma_don) do update set ngay_xuat=excluded.ngay_xuat, so_tien_thu_ho=excluded.so_tien_thu_ho,
      don_vi_vc=excluded.don_vi_vc, trang_thai='dang_giao', ngay_ket_thuc=null,
      ghi_chu=excluded.ghi_chu, nguoi_ghi=excluded.nguoi_ghi, cap_nhat_luc=now();
  return jsonb_build_object('ok',true,'ma_don',v_ma);
end $$;
grant execute on function kho.cod_ghi(jsonb) to authenticated;

-- Đối soát cả đợt trong 1 transaction: kiểm HẾT trước (đơn không ở dang_giao → từ chối cả đợt), rồi mới áp.
create or replace function kho.cod_doi_soat(p_dot jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare r jsonb; v_nguoi text := coalesce((select ho_ten from kho.nguoi_dung where id=kho.current_ns()),'');
  v_ma text; v_ngay date; v_thu numeric; v_thuho numeric; v_phi numeric; v_n int := 0; v_phi_tong numeric := 0;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'cod_doi_soat: chỉ ceo/ke_toan'; end if;
  -- BƯỚC 1 — kiểm cả đợt (fail-đóng): mọi đơn phải đang ở giao_cod dang_giao.
  for r in select * from jsonb_array_elements(coalesce(p_dot,'[]'::jsonb)) loop
    v_ma := btrim(coalesce(r->>'ma_don',''));
    if v_ma='' then raise exception 'cod_doi_soat: có dòng thiếu ma_don — từ chối cả đợt'; end if;
    if not exists(select 1 from kho.giao_cod where ma_don=v_ma and trang_thai='dang_giao') then
      raise exception 'cod_doi_soat: đơn % không ở trạng thái COD đang giao — TỪ CHỐI CẢ ĐỢT', v_ma; end if;
    if coalesce(nullif(r->>'so_tien','')::numeric,0) <= 0 then
      raise exception 'cod_doi_soat: đơn % số tiền thực về phải > 0 — từ chối cả đợt', v_ma; end if;
  end loop;
  -- BƯỚC 2 — áp: phiếu thu doi_soat_cod từng đơn + chuyển da_doi_soat + phí VC (chênh) → chi_phi_ky 'khac'.
  for r in select * from jsonb_array_elements(coalesce(p_dot,'[]'::jsonb)) loop
    v_ma := btrim(r->>'ma_don'); v_thu := (r->>'so_tien')::numeric; v_ngay := coalesce(nullif(r->>'ngay','')::date, current_date);
    select so_tien_thu_ho into v_thuho from kho.giao_cod where ma_don=v_ma;
    insert into kho.phieu_thu(ma_don,ngay,so_tien,loai,ghi_chu,nguoi_ghi)
      values(v_ma, v_ngay, v_thu, 'doi_soat_cod', 'đối soát COD', v_nguoi);
    update kho.giao_cod set trang_thai='da_doi_soat', ngay_ket_thuc=v_ngay, cap_nhat_luc=now() where ma_don=v_ma;
    v_phi := v_thuho - v_thu;
    if v_phi > 0 then
      insert into kho.chi_phi_ky(ma_ky, loai, so_tien, phan_khuc, ghi_chu, nguoi_nhap)
        values(to_char(v_ngay,'YYYY-MM'), 'khac', v_phi, null, 'phí VC/COD '||v_ma, v_nguoi);
      v_phi_tong := v_phi_tong + v_phi;
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok',true,'so_don',v_n,'phi_vc_tong',v_phi_tong);
end $$;
grant execute on function kho.cod_doi_soat(jsonb) to authenticated;

create or replace function kho.cod_hoan(p_don text, p_ngay date, p_ghi_chu text default null) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'cod_hoan: chỉ ceo/ke_toan'; end if;
  if not exists(select 1 from kho.giao_cod where ma_don=p_don and trang_thai='dang_giao') then
    raise exception 'cod_hoan: đơn % không ở COD đang giao', p_don; end if;
  update kho.giao_cod set trang_thai='hoan', ngay_ket_thuc=coalesce(p_ngay,current_date),
    ghi_chu = btrim(coalesce(ghi_chu||' | ','')||'HOÀN: '||coalesce(p_ghi_chu,'hàng quay lại xưởng')), cap_nhat_luc=now()
    where ma_don=p_don; get diagnostics v = row_count;
  return jsonb_build_object('ok', v>0, 'ma_don', p_don);   -- KHÔNG sinh phiếu thu; tiền không đếm vào bất kỳ khối thu nào
end $$;
grant execute on function kho.cod_hoan(text, date, text) to authenticated;

-- ═══════════════ 6. VỐN: von_ghi / von_xoa ═══════════════
create or replace function kho.von_ghi(p_gd jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v_nguoi text := coalesce((select ho_ten from kho.nguoi_dung where id=kho.current_ns()),''); v_id bigint;
  v_st numeric := coalesce(nullif(p_gd->>'so_tien','')::numeric,0);
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'von_ghi: chỉ ceo/ke_toan'; end if;
  if coalesce(p_gd->>'loai','') not in ('vay_moi','tra_goc_vay','mua_tai_san','ban_tai_san','gop_von','rut_von') then
    raise exception 'von_ghi: loại giao dịch vốn không hợp lệ'; end if;
  if v_st <= 0 then raise exception 'von_ghi: số tiền phải > 0'; end if;
  insert into kho.giao_dich_von(ngay,loai,so_tien,ghi_chu,nguoi_ghi)
    values(coalesce(nullif(p_gd->>'ngay','')::date, current_date), p_gd->>'loai', v_st, nullif(p_gd->>'ghi_chu',''), v_nguoi)
    returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;
grant execute on function kho.von_ghi(jsonb) to authenticated;

create or replace function kho.von_xoa(p_id bigint) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'von_xoa: chỉ ceo/ke_toan'; end if;
  delete from kho.giao_dich_von where id=p_id; get diagnostics v = row_count;
  return jsonb_build_object('ok', v>0, 'da_xoa', v);
end $$;
grant execute on function kho.von_xoa(bigint) to authenticated;

-- ═══════════════ 7. QUỸ đầu kỳ: quy_ghi (sửa phải ghi lý do → ghi_chu tham số) ═══════════════
create or replace function kho.quy_ghi(p_ky text, p_so_tien numeric, p_ly_do text default null) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'quy_ghi: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky='' then raise exception 'quy_ghi: thiếu ma_ky'; end if;
  if p_so_tien is null or p_so_tien < 0 then raise exception 'quy_ghi: quỹ đầu kỳ phải >= 0'; end if;
  update kho.tham_so_tai_chinh
    set quy_dau_ky = p_so_tien,
        ghi_chu = btrim(coalesce(ghi_chu||' | ','')||'quỹ đầu kỳ='||to_char(p_so_tien,'FM999,999,999,999')
                  ||coalesce(' ('||nullif(btrim(p_ly_do),'')||')',''))
    where ma_ky = p_ky; get diagnostics v = row_count;
  if v = 0 then raise exception 'quy_ghi: kỳ % chưa có tham số tài chính — tạo kỳ trước', p_ky; end if;
  return jsonb_build_object('ok',true,'ma_ky',p_ky,'quy_dau_ky',p_so_tien);
end $$;
grant execute on function kho.quy_ghi(text, numeric, text) to authenticated;

-- ═══════════════ 8. dong_tien_rong(p_ky) — chỉ các TỔNG (thu/chi/vốn), KHÔNG quét đơn 100k. Dùng cho gợi ý quỹ kỳ trước. ═══════════════
create or replace function kho.dong_tien_rong(p_ky text) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v_from date := to_date(p_ky||'-01','YYYY-MM-DD'); v_to date := (to_date(p_ky||'-01','YYYY-MM-DD')+interval '1 month')::date;
  v_thu numeric; v_chi numeric; v_vao numeric; v_ra numeric;
begin
  select coalesce(sum(so_tien),0) into v_thu from kho.phieu_thu where ngay>=v_from and ngay<v_to;
  v_chi := (select coalesce(sum(so_tien),0) from kho.chi_phi_ky where ma_ky=p_ky)
         + (select coalesce(sum(so_tien_nhap),0) from kho.chi_ads where ma_ky=p_ky)
         + (select coalesce(sum(coalesce(luong_to,0)+coalesce(bao_hiem,0)),0) from kho.luong_to where ma_ky=p_ky);
  select coalesce(sum(case when loai in ('vay_moi','ban_tai_san','gop_von') then so_tien else 0 end),0),
         coalesce(sum(case when loai in ('tra_goc_vay','mua_tai_san','rut_von') then so_tien else 0 end),0)
    into v_vao, v_ra from kho.giao_dich_von where ngay>=v_from and ngay<v_to;
  return jsonb_build_object('thu',v_thu,'chi',v_chi,'rong_kd',v_thu-v_chi,'vao',v_vao,'ra',v_ra,'rong_ngoai',v_vao-v_ra);
end $$;
grant execute on function kho.dong_tien_rong(text) to authenticated;

-- ═══════════════ 9. con_phai_thu(p_trang) — KHỐI 4: khách nợ thật, phân trang 50, tuổi 3 bậc TỔNG toàn bộ ═══════════════
--   Nợ = coalesce(gia_chot,doanh_thu,gia_cong_thuc,0) [GỒM VAT] − Σ phieu_thu; đơn da_giao, dư>0, LOẠI đơn có COD dang_giao.
create or replace function kho.con_phai_thu(p_trang int default 1) returns jsonb
  language plpgsql stable security definer set search_path = kho set jit='off' as $$
declare v_ds jsonb; v_bac jsonb; v_tong numeric; v_sodon int; v_off int := (greatest(coalesce(p_trang,1),1)-1)*50;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'con_phai_thu: chỉ ceo/ke_toan'; end if;
  with pt as (select ma_don, sum(so_tien) da_thu from kho.phieu_thu group by ma_don),
  base as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.dong, d.nguon_khach, d.ngay_giao,
           coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0) gia, coalesce(pt.da_thu,0) da_thu,
           coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0)-coalesce(pt.da_thu,0) con_lai,
           (current_date - d.ngay_giao) tuoi
    from kho.don_hang d left join pt on pt.ma_don=d.ma_don
    where d.trang_thai='da_giao' and d.ngay_giao is not null and coalesce(d.la_demo,false)=false
      and coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0)-coalesce(pt.da_thu,0) > 0
      and not exists(select 1 from kho.giao_cod g where g.ma_don=d.ma_don and g.trang_thai='dang_giao')
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'khach',khach,'dong',dong,'nguon_khach',nguon_khach,
        'gia',gia,'da_thu',da_thu,'con_lai',con_lai,'tuoi',tuoi) order by tuoi desc, con_lai desc),'[]'::jsonb)
       from (select * from base order by tuoi desc, con_lai desc offset v_off limit 50) p),
    jsonb_build_object(
      'bac1', jsonb_build_object('nhan','Chưa quá 30 ngày','tien',coalesce(sum(con_lai) filter(where tuoi<=30),0),'so_don',count(*) filter(where tuoi<=30)),
      'bac2', jsonb_build_object('nhan','31–60 ngày','tien',coalesce(sum(con_lai) filter(where tuoi>30 and tuoi<=60),0),'so_don',count(*) filter(where tuoi>30 and tuoi<=60)),
      'bac3', jsonb_build_object('nhan','Quá 60 ngày','tien',coalesce(sum(con_lai) filter(where tuoi>60),0),'so_don',count(*) filter(where tuoi>60))),
    coalesce(sum(con_lai),0), count(*)::int
  into v_ds, v_bac, v_tong, v_sodon from base;
  return jsonb_build_object('trang',greatest(coalesce(p_trang,1),1),'so_trang',greatest(ceil(v_sodon/50.0)::int,1),
    'so_don',v_sodon,'tong',v_tong,'bac',v_bac,'dong',v_ds);
end $$;
grant execute on function kho.con_phai_thu(int) to authenticated;

-- ═══════════════ 10. dong_tien_ky(p_ky) — 7 KHỐI + tổng + ròng + đối chiếu quỹ ═══════════════
create or replace function kho.dong_tien_ky(p_ky text) returns jsonb
  language plpgsql stable security definer set search_path = kho set jit='off' as $$
declare
  v_from date := to_date(p_ky||'-01','YYYY-MM-DD'); v_to date := (to_date(p_ky||'-01','YYYY-MM-DD')+interval '1 month')::date;
  v_thu jsonb; v_tong_thu numeric; v_chi jsonb; v_tong_chi numeric;
  v_vc jsonb; v_vc_tong numeric; v_vc_don int; v_hoan jsonb;
  v_no jsonb; v_canhbao jsonb; v_cb_so int; v_von jsonb; v_von_vao numeric; v_von_ra numeric;
  v_quy_luu numeric; v_quy_dau numeric; v_goi_y numeric; v_rong_kd numeric; v_rong_ngoai numeric; v_prev jsonb;
  c_luong numeric; c_ads numeric; c_cpk numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'dong_tien_ky: chỉ ceo/ke_toan'; end if;

  -- KHỐI 1 — THU theo ngày phiếu, 4 loại.
  select jsonb_object_agg(loai, jsonb_build_object('so_phieu',sp,'so_tien',st,'so_dot',sd,'so_don',so_don)), coalesce(sum(st),0)
    into v_thu, v_tong_thu
  from (select loai, count(*) sp, coalesce(sum(so_tien),0) st,
          count(distinct ngay) filter(where loai='doi_soat_cod') sd,
          count(*) filter(where loai='doi_soat_cod') so_don
        from kho.phieu_thu where ngay>=v_from and ngay<v_to group by loai) x;

  -- KHỐI 2 — CHI từ 3 sổ (chi_phi_ky + chi_ads GỒM VAT + luong_to lương+BH, KHÔNG overhead).
  c_cpk   := (select coalesce(sum(so_tien),0) from kho.chi_phi_ky where ma_ky=p_ky);
  c_ads   := (select coalesce(sum(so_tien_nhap),0) from kho.chi_ads where ma_ky=p_ky);
  c_luong := (select coalesce(sum(coalesce(luong_to,0)+coalesce(bao_hiem,0)),0) from kho.luong_to where ma_ky=p_ky);
  v_tong_chi := c_cpk + c_ads + c_luong;
  v_chi := jsonb_build_object('chi_phi_ky',c_cpk,'chi_ads',c_ads,'luong_to',c_luong);
  v_rong_kd := v_tong_thu - v_tong_chi;

  -- KHỐI 3 — TIỀN Ở NHÀ VẬN CHUYỂN (COD dang_giao) + hoàn trong kỳ.
  select coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'khach',khach,'dong',dong,'nguon_khach',nguon_khach,
      'don_vi_vc',don_vi_vc,'so_tien_thu_ho',so_tien_thu_ho,'ngay_xuat',ngay_xuat,'tuoi',tuoi,'qua_14',tuoi>14)
      order by tuoi desc),'[]'::jsonb)
    into v_vc from (
      select g.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.dong, d.nguon_khach,
             g.don_vi_vc, g.so_tien_thu_ho, g.ngay_xuat, (current_date-g.ngay_xuat) tuoi
      from kho.giao_cod g join kho.don_hang d on d.ma_don=g.ma_don
      where g.trang_thai='dang_giao' order by (current_date-g.ngay_xuat) desc limit 50) y;
  select coalesce(sum(so_tien_thu_ho),0), count(*) into v_vc_tong, v_vc_don from kho.giao_cod where trang_thai='dang_giao';
  select jsonb_build_object('so_don',count(*),'so_tien',coalesce(sum(so_tien_thu_ho),0)) into v_hoan
    from kho.giao_cod where trang_thai='hoan' and ngay_ket_thuc>=v_from and ngay_ket_thuc<v_to;

  -- KHỐI 4 — KHÁCH NỢ (tóm tắt 3 bậc; danh sách chi tiết ở con_phai_thu). KHỐI 5 — cảnh báo đơn giao 0 phiếu & không COD.
  with pt as (select ma_don, sum(so_tien) da_thu, count(*) c from kho.phieu_thu group by ma_don),
  cod as (select ma_don from kho.giao_cod where trang_thai='dang_giao'),   -- anti-join 1 lần (tránh 100k not-exists tương quan trong SELECT)
  base as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.dong, d.ngay_giao,
           coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0)-coalesce(pt.da_thu,0) con_lai,
           coalesce(pt.c,0) so_phieu, (current_date-d.ngay_giao) tuoi,
           (cod.ma_don is null) khong_cod
    from kho.don_hang d left join pt on pt.ma_don=d.ma_don left join cod on cod.ma_don=d.ma_don
    where d.trang_thai='da_giao' and d.ngay_giao is not null and coalesce(d.la_demo,false)=false)
  select jsonb_build_object(
      'tong', coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod),0),
      'so_don', count(*) filter(where con_lai>0 and khong_cod),
      'bac1', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi<=30),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi<=30)),
      'bac2', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi>30 and tuoi<=60),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi>30 and tuoi<=60)),
      'bac3', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi>60),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi>60))),
    coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'khach',khach,'dong',dong,'ngay_giao',ngay_giao)) filter(where so_phieu=0 and khong_cod and ngay_giao>=v_from and ngay_giao<v_to),'[]'::jsonb),
    count(*) filter(where so_phieu=0 and khong_cod and ngay_giao>=v_from and ngay_giao<v_to)
    into v_no, v_canhbao, v_cb_so from base;

  -- KHỐI 6 — NGOÀI KINH DOANH (giao dịch vốn trong kỳ, gộp không bù trừ).
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'ngay',ngay,'loai',loai,
      'vao', case when loai in ('vay_moi','ban_tai_san','gop_von') then so_tien else 0 end,
      'ra',  case when loai in ('tra_goc_vay','mua_tai_san','rut_von') then so_tien else 0 end,
      'ghi_chu',ghi_chu) order by ngay, id),'[]'::jsonb),
    coalesce(sum(case when loai in ('vay_moi','ban_tai_san','gop_von') then so_tien else 0 end),0),
    coalesce(sum(case when loai in ('tra_goc_vay','mua_tai_san','rut_von') then so_tien else 0 end),0)
    into v_von, v_von_vao, v_von_ra from kho.giao_dich_von where ngay>=v_from and ngay<v_to;
  v_rong_ngoai := v_von_vao - v_von_ra;

  -- KHỐI 7 — ĐỐI CHIẾU QUỸ. Quỹ đầu = số đã lưu; nếu chưa lưu → gợi ý = quỹ cuối kỳ TRƯỚC (đầu+ròng KD+ròng ngoài kỳ trước).
  select quy_dau_ky into v_quy_luu from kho.tham_so_tai_chinh where ma_ky=p_ky;
  v_prev := kho.dong_tien_rong(to_char((v_from - interval '1 month'),'YYYY-MM'));
  select coalesce(quy_dau_ky,0) + (v_prev->>'rong_kd')::numeric + (v_prev->>'rong_ngoai')::numeric into v_goi_y
    from kho.tham_so_tai_chinh where ma_ky=to_char((v_from - interval '1 month'),'YYYY-MM');
  v_quy_dau := coalesce(v_quy_luu, v_goi_y);

  return jsonb_build_object(
    'ma_ky',p_ky,
    'thu', jsonb_build_object('theo_loai',coalesce(v_thu,'{}'::jsonb),'tong',v_tong_thu),
    'chi', jsonb_build_object('theo_so',v_chi,'tong',v_tong_chi),
    'rong_kd', v_rong_kd,
    'o_nha_vc', jsonb_build_object('tong',v_vc_tong,'so_don',v_vc_don,'ds',v_vc,'hoan',v_hoan),
    'khach_no', v_no,
    'canh_bao', jsonb_build_object('so_don',v_cb_so,'ds',v_canhbao),
    'ngoai_kd', jsonb_build_object('vao',v_von_vao,'ra',v_von_ra,'rong',v_rong_ngoai,'ds',v_von),
    'quy', jsonb_build_object('dau_ky',v_quy_dau,'da_luu',(v_quy_luu is not null),'goi_y',v_goi_y,
      'rong_kd',v_rong_kd,'rong_ngoai',v_rong_ngoai,'cuoi_ky',v_quy_dau + v_rong_kd + v_rong_ngoai)
  );
end $$;
grant execute on function kho.dong_tien_ky(text) to authenticated;

-- ═══════════════ 11. HỢP NHẤT db/104 — dieu_hanh_cong_no_khach chuyển sang nguồn phieu_thu (một số) ═══════════════
--   Đã-thu = Σ phieu_thu (nguồn mới), KHÔNG còn so_tien_thuc_thu (đóng băng lịch sử). LOẠI đơn COD dang_giao (tiền ở khối VC).
create or replace function kho.dieu_hanh_cong_no_khach(p_gioi_han int default 100) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'dieu_hanh_cong_no_khach: chỉ ceo/ke_toan'; end if;
  return (
    with pt as (select ma_don, sum(so_tien) da_thu from kho.phieu_thu group by ma_don)
    select coalesce(jsonb_agg(jsonb_build_object('khach',z.khach,'sdt',z.sdt,'tong_phai_thu',z.tong,
        'so_don',z.so_don,'lau_nhat',z.lau) order by z.tong desc),'[]'::jsonb)
    from (
      select coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, max(d.khach_sdt) sdt,
        sum(coalesce(d.gia_chot, d.doanh_thu, d.gia_cong_thuc, 0) - coalesce(pt.da_thu,0)) tong,
        count(*) so_don, max(current_date - d.ngay_giao) lau
      from kho.don_hang d left join pt on pt.ma_don=d.ma_don
      where d.ngay_giao is not null and coalesce(d.la_demo,false)=false
        and coalesce(d.gia_chot, d.doanh_thu, d.gia_cong_thuc, 0) - coalesce(pt.da_thu,0) > 0
        and not exists(select 1 from kho.giao_cod g where g.ma_don=d.ma_don and g.trang_thai='dang_giao')
      group by 1 order by 3 desc limit greatest(p_gioi_han,0)) z);
end $$;
grant execute on function kho.dieu_hanh_cong_no_khach(int) to authenticated;

do $$ begin
  if to_regprocedure('kho.dong_tien_ky(text)')   is null then raise exception 'THIẾU dong_tien_ky'; end if;
  if to_regprocedure('kho.con_phai_thu(integer)') is null then raise exception 'THIẾU con_phai_thu'; end if;
  if to_regprocedure('kho.cod_doi_soat(jsonb)')   is null then raise exception 'THIẾU cod_doi_soat'; end if;
  raise notice 'db/116 OK: phieu_thu + giao_cod + giao_dich_von + pt/cod/von + dong_tien_ky/con_phai_thu + hợp nhất cong_no.';
end $$;
commit;
