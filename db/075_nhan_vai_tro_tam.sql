-- db/075 — NHÃN TẤM người-đọc (L-16 Phần B)
-- Bối cảnh: tem_ban_ve.vai_tro là MÃ máy (hong/noc/canh_cua…). Màn trạm cần chữ đọc mắt + gom nhóm.
--   Bảng tra ma → ten (tiếng Việt) + nhom. Mã lạ (chưa gieo) → RPC trả CHÍNH MÃ, KHÔNG trả trống.
-- CHỐT CEO: BỎ trái/phải — thợ nhìn tấm biết. "hông" là đủ, không "hông trái".
-- Idempotent (create if not exists + upsert). Không đụng dữ liệu tem.
begin;

create table if not exists kho.nhan_vai_tro_tam (
  ma       text primary key,
  ten      text not null,
  nhom     text not null check (nhom in ('thung','canh','keo','khac')),
  can_soat boolean not null default false   -- true = tên CHƯA chắc, để = mã, chờ CEO soát
);

-- Gieo đủ 16 mã đang có trong tem_ban_ve.
-- Chắc nghĩa → tên tiếng Việt nghề nội thất. Chưa chắc → ten = ma + can_soat=true (CẤM bịa).
insert into kho.nhan_vai_tro_tam(ma, ten, nhom, can_soat) values
  ('canh_cua',   'cánh',            'canh',  false),
  ('hong',       'hông',            'thung', false),
  ('noc',        'nóc',             'thung', false),
  ('day',        'đáy',             'thung', false),
  ('hau',        'hậu',             'thung', false),
  ('dot',        'đợt',             'thung', false),
  ('vach',       'vách',            'thung', false),
  ('do_giang',   'đố giằng',        'thung', false),   -- luat: do_giang_day = "Đố chống võng đáy"
  ('day_hop',    'đáy hộp kéo',     'keo',   false),   -- CEO
  ('mat_keo',    'mặt ngăn kéo',    'keo',   false),   -- CEO
  ('hong_hop',   'hông hộp kéo',    'keo',   false),   -- theo mẫu day_hop (resolver: tấm hộp kéo)
  ('hau_hop',    'hậu hộp kéo',     'keo',   false),
  ('truoc_hop',  'trước hộp kéo',   'keo',   false),   -- hop_keo_core: mặt trước hộp kéo
  -- CHƯA CHẮC nghĩa nghề — để tên = mã, can_soat=true, chờ CEO soát:
  ('ma_bat_keo', 'ma_bat_keo',      'keo',   true),
  ('be',         'be',              'thung', true),
  ('do_be',      'do_be',           'thung', true)
on conflict (ma) do update
  set ten = excluded.ten, nhom = excluded.nhom, can_soat = excluded.can_soat;

grant select on kho.nhan_vai_tro_tam to authenticated;

-- RPC tra tên: mã lạ → trả CHÍNH MÃ (không trống). Màn trạm gọi cái này, không join trực tiếp.
create or replace function kho.ten_vai_tro_tam(p_ma text)
  returns text language sql stable security definer set search_path = kho as $$
  select coalesce((select ten from kho.nhan_vai_tro_tam where ma = p_ma), p_ma);
$$;
grant execute on function kho.ten_vai_tro_tam(text) to authenticated;

-- RPC tra nhóm: mã lạ → 'khac' (để màn vẫn gom được, không rớt).
create or replace function kho.nhom_vai_tro_tam(p_ma text)
  returns text language sql stable security definer set search_path = kho as $$
  select coalesce((select nhom from kho.nhan_vai_tro_tam where ma = p_ma), 'khac');
$$;
grant execute on function kho.nhom_vai_tro_tam(text) to authenticated;

commit;
