-- db/186 · WP-70 L-70r5 · ĐÈN "mốc kéo đứng" — view + RPC sức khoẻ bộ kéo. Soi MỐC TIẾN, không soi lượt.
--   ⚠ KHÔNG IDEMPOTENT: create index? (không có) · or-replace view+function (an toàn chạy lại) — nhưng grant/backup theo QD.
--   Vì sao soi mốc: sự cố 30/08 có so_luot=1446, loi_lien_tiep=0 suốt 8h mà KHÔNG kéo được gì.
--     Đèn dựa số-lượt/số-lỗi đều MÙ kiểu đó. Đèn này soi lan_keo_luc (page kéo xong lần cuối) + moc_cap_nhat.
--   ⚠ Cổng backup QD-61: dump fail → DỪNG. CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: drop function kho.keo_lead_suc_khoe(); drop view kho.v_keo_lead_suc_khoe;
begin;

-- ── VIEW: mỗi page một dòng. HAI mốc tách bạch: ──
--    lan_keo_luc đứng  = worker CHẾT (cron không chạy trọn 1 lượt nào cho page).
--    lan_keo đứng NHƯNG runner còn tick (cap_nhat_luc tươi) = worker SỐNG mà không kéo ra được (ca 30/08 CPU-kill).
--    Ngưỡng trên phut_tre (=phút từ lan_keo_luc): cham ≥10 · dung/keo_khong_ra ≥30.
--    (cron 1 phút/lượt; chừa dư cho backoff "5 lỗi → ngủ 15 phút"; 30' đủ để 8h-sự-cố kêu trong nửa giờ.)
create or replace view kho.v_keo_lead_suc_khoe as
select
  k.page_id,
  case when k.page_id like 'pzl%' then 'zalo'
       when k.page_id like 'igo%' then 'instagram'
       else 'messenger' end                                          as kenh,
  k.moc_cap_nhat,
  k.lan_keo_luc,
  round(extract(epoch from (now() - k.lan_keo_luc)) / 60)::int       as phut_tre,
  round(extract(epoch from (now() - k.moc_cap_nhat)) / 60)::int      as phut_moc_dung,
  case
    when k.lan_keo_luc is null then 'dung'
    when extract(epoch from (now() - k.lan_keo_luc)) / 60 < 10 then 'binh_thuong'
    when extract(epoch from (now() - k.lan_keo_luc)) / 60 < 30 then 'cham'
    -- lan_keo đứng ≥30': worker sống (runner vừa tick) → keo_khong_ra; runner cũng chết → dung.
    when r.cap_nhat_luc is not null and r.cap_nhat_luc > now() - interval '3 minutes' then 'keo_khong_ra'
    else 'dung'
  end                                                                as tinh_trang,
  coalesce(l.n, 0)                                                   as lead_moi_24h
from kho.lead_moc_keo k
cross join (select cap_nhat_luc from kho.keo_lead_runner where id = 1) r
left join lateral (
  select count(*)::int n from kho.v_lead_hien_hanh v
  where v.page_id = k.page_id and v.ghi_nhan_luc > now() - interval '24 hours'
) l on true;
comment on view kho.v_keo_lead_suc_khoe is 'WP-70/L-70r5: đèn sức khoẻ bộ kéo. tinh_trang: binh_thuong (<10p) · cham (10-30p) · keo_khong_ra (≥30p mà runner còn tick — ca 30/08) · dung (≥30p, runner cũng chết). Đo lan_keo_luc, KHÔNG đo so_luot.';

-- ── RPC đọc view cho màn CAC (app tài chính). Grant authenticated (như cac_theo_luong_*). KHÔNG anon. ──
create or replace function kho.keo_lead_suc_khoe()
returns setof kho.v_keo_lead_suc_khoe language sql stable security definer set search_path to 'kho'
as $fn$ select * from kho.v_keo_lead_suc_khoe order by page_id $fn$;
revoke execute on function kho.keo_lead_suc_khoe() from public, anon;
grant execute on function kho.keo_lead_suc_khoe() to authenticated;

do $$ begin
  perform 1 from kho.v_keo_lead_suc_khoe limit 1;
  raise notice 'db/186 OK: v_keo_lead_suc_khoe + keo_lead_suc_khoe().';
end $$;
commit;
