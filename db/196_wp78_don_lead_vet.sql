-- db/196 · WP-78 L-05 · RPC ĐỌC vết gắn/đổi lead của 1 đơn (cho màn chi tiết app Sale).
--   don_hang_lead_nhat_ky (db/191) revoke all + RLS force → client KHÔNG đọc thẳng. Cần cửa đọc curated
--   (khuôn sale_* db/046): SECURITY DEFINER, chỉ sale/ceo, JOIN sẵn tên người + tên/nguồn/mức của lead.
--   ⚠ or-replace an toàn chạy lại. Cổng backup QD-61.
--   HOÀN TÁC: drop function kho.don_lead_vet(uuid);
begin;

create or replace function kho.don_lead_vet(p_don_id uuid)
returns table(o_luc timestamptz, o_ly_do text, o_nguoi text,
  o_tu_ten text, o_den_ten text, o_den_ad text, o_den_muc text, o_den_kenh text)
language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('sale','ceo') then raise exception 'don_lead_vet: chỉ sale/ceo'; end if;
  return query
    select v.luc, v.ly_do, nz.ho_ten,
      lt.ten_khach, ld.ten_khach, ld.ad_id, ld.muc_chac_chan,
      case when ld.page_id like 'pzl%' then 'zalo'
           when ld.page_id like 'igo%' then 'instagram'
           else 'messenger' end
    from kho.don_hang_lead_nhat_ky v
    left join kho.nguoi_dung nz on nz.id = v.nguoi_id
    left join kho.lead lt on lt.id = v.tu     -- lead CŨ (null = gắn lần đầu)
    left join kho.lead ld on ld.id = v.den    -- lead MỚI (dòng mới nhất = hiện hành)
    where v.don_id = p_don_id
    order by v.luc desc;
end $fn$;
revoke execute on function kho.don_lead_vet(uuid) from public, anon;
grant execute on function kho.don_lead_vet(uuid) to authenticated;

do $$ begin
  if to_regprocedure('kho.don_lead_vet(uuid)') is null then raise exception 'THIẾU don_lead_vet'; end if;
  raise notice 'db/196 OK: don_lead_vet(p_don_id) — cửa đọc vết gắn/đổi lead cho app Sale.';
end $$;
commit;
