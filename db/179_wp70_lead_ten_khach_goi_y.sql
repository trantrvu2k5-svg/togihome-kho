-- db/179 · WP-70 L-04 · VÁ: lead thiếu TÊN khách + RPC gợi ý hội thoại cho app Sale.
--   L-01 thiếu cột tên. Kỳ 08 sđt chỉ 2–14% → gợi ý theo sđt vô dụng; phải gợi ý theo TÊN.
--   ten_khach = customers[].name của bản ghi hội thoại — là TÊN, KHÔNG phải nội dung tin nhắn
--     (không phạm điều cấm WP-70). Đưa vào dau_van (đổi tên = dòng mới). Bộ kéo điền từ lần sau.
--   KHÔNG kéo lại 4541 dòng cũ để lấp tên (dòng cũ để trống, sale vẫn chọn bằng thời điểm + trang) — lệnh riêng nếu muốn.
--
--   HOÀN TÁC: drop function kho.lead_goi_y(text,int);
--     -- lead_ghi: chạy lại bản db/176 (bỏ ten_khach). alter table kho.lead drop column ten_khach;
--   TÁI DÙNG kho.bo_dau(text) đã có (slugify không dấu, thường hoá) — KHÔNG định nghĩa lại.
--   ⚠ CẤM cờ BO_QUA_BACKUP (db≥177) — backup bình thường.
begin;

-- (1) cột tên khách (nullable — dòng cũ để trống)
alter table kho.lead add column if not exists ten_khach text;

-- (1b) v_lead_hien_hanh dùng "select *" → ĐÓNG BĂNG cột lúc tạo (db/175, trước khi có ten_khach).
--   Phải TẠO LẠI để view thấy cột mới (ten_khach thêm cuối bảng → append cuối view, hợp lệ CREATE OR REPLACE).
create or replace view kho.v_lead_hien_hanh as
  select distinct on (page_id, hoi_thoai_id) *
  from kho.lead
  order by page_id, hoi_thoai_id, stt desc;
grant select on kho.v_lead_hien_hanh to authenticated;

-- (2) lead_ghi — thêm ten_khach vào dau_van + insert. (create or replace, cùng chữ ký (jsonb) → không overload.)
create or replace function kho.lead_ghi(p_lead jsonb)
returns jsonb language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_dv text; v_last text;
  v_page text := p_lead->>'page_id'; v_ht text := p_lead->>'hoi_thoai_id'; v_id uuid; v_stt bigint;
begin
  if not (v_vai in ('ceo','ke_toan') or coalesce(current_setting('kho.lead_he_thong', true),'') = '1') then raise exception 'lead_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (đặt GUC kho.lead_he_thong)'; end if;
  if v_page is null or v_ht is null then raise exception 'lead_ghi: thiếu page_id/hoi_thoai_id'; end if;
  v_dv := md5(concat_ws('|', coalesce(p_lead->>'nguon','pancake'), v_page, v_ht,
     p_lead->>'khach_pancake_id', p_lead->>'loai', p_lead->>'thoi_diem_hoi_thoai',
     p_lead->>'luong', p_lead->>'chu_de_ma', p_lead->>'muc_chac_chan',
     p_lead->>'ad_id', p_lead->>'ref_web', p_lead->>'sdt', p_lead->>'ten_khach'));   -- + ten_khach: đổi tên = dòng mới
  select dau_van into v_last from kho.lead where page_id=v_page and hoi_thoai_id=v_ht order by stt desc limit 1;
  if v_last is not null and v_last = v_dv then return jsonb_build_object('ket','khong_doi'); end if;
  insert into kho.lead(nguon,page_id,hoi_thoai_id,khach_pancake_id,loai,thoi_diem_hoi_thoai,luong,chu_de_ma,muc_chac_chan,ad_id,ref_web,sdt,ten_khach,dau_van)
  values(coalesce(nullif(p_lead->>'nguon',''),'pancake'), v_page, v_ht,
     nullif(p_lead->>'khach_pancake_id',''), nullif(p_lead->>'loai',''),
     (p_lead->>'thoi_diem_hoi_thoai')::timestamptz, p_lead->>'luong',
     nullif(p_lead->>'chu_de_ma',''), p_lead->>'muc_chac_chan',
     nullif(p_lead->>'ad_id',''), nullif(p_lead->>'ref_web',''), nullif(p_lead->>'sdt',''),
     nullif(p_lead->>'ten_khach',''), v_dv)
  returning id, stt into v_id, v_stt;
  return jsonb_build_object('ket','da_ghi','id',v_id,'stt',v_stt);
end $fn$;
grant execute on function kho.lead_ghi(jsonb) to authenticated;

-- (3) lead_goi_y — GỢI Ý hội thoại cho form lên đơn (app Sale). ĐỌC v_lead_hien_hanh; sale ĐỌC được, KHÔNG ghi.
create or replace function kho.lead_goi_y(p_tim text default null, p_ngay int default 7)
returns jsonb language plpgsql stable security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_tim text; v_res jsonb;
begin
  if v_vai not in ('sale','ceo','ke_toan') then raise exception 'lead_goi_y: chỉ sale/ceo/ke_toan'; end if;
  v_tim := nullif(btrim(coalesce(p_tim,'')),'');
  select coalesce(jsonb_agg(x order by x.thoi_diem desc), '[]'::jsonb) into v_res from (
    select v.id as lead_id, v.ten_khach,
      case when v.sdt is not null and length(v.sdt) > 4 then left(v.sdt, length(v.sdt)-4) || '****'
           when v.sdt is not null then '****' else null end as sdt,     -- che 4 số cuối
      v.page_id as trang,
      case when v.page_id like 'pzl!_%' escape '!' then 'zalo'
           when v.page_id like 'igo!_%' escape '!' then 'instagram' else 'facebook' end as nen_tang,
      v.thoi_diem_hoi_thoai as thoi_diem, v.muc_chac_chan, v.luong, v.chu_de_ma
    from kho.v_lead_hien_hanh v
    where v.nguon='pancake'
      and case
        when v_tim is null then v.thoi_diem_hoi_thoai >= now() - make_interval(days => greatest(p_ngay,1))
        else (kho.bo_dau(v.ten_khach) like '%'||kho.bo_dau(v_tim)||'%' or v.sdt like '%'||v_tim||'%')
      end
    order by v.thoi_diem_hoi_thoai desc
    limit 50
  ) x;
  return v_res;
end $fn$;
grant execute on function kho.lead_goi_y(text, int) to authenticated;

do $$ begin
  if to_regprocedure('kho.lead_goi_y(text,int)') is null then raise exception 'THIẾU lead_goi_y'; end if;
  raise notice 'db/179 OK: lead.ten_khach + bo_dau + lead_ghi(+ten_khach) + lead_goi_y.';
end $$;
commit;
