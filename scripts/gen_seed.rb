# KHO-1 — records.json -> db/002_seed.sql (CEO chạy trong Supabase SQL Editor sau 001_schema).
#   Tồn hiện có = 1 LÔ MỞ ĐẦU hôm nay. Ván/pk chưa giá -> gia_von NULL (CẤM 0) + cờ.
#   Cuối file có khối KIỂM (VIỆC 5): sai số mã / sai tổng -> RAISE (không lặng lẽ).
require "json"
ROOT = File.expand_path("..", __dir__)
R = JSON.parse(File.read(File.join(ROOT, "scratch", "records.json")), symbolize_names: true)
NGAY = ARGV[0] || Time.now.strftime("%Y-%m-%d")   # lô mở đầu; truyền tay để tái lập

def q(s); s.nil? ? "null" : "'" + s.to_s.gsub("'", "''") + "'"; end
def n(x); (x.nil? ? "null" : x); end
def arr(a); a.nil? || a.empty? ? "'{}'" : "array[" + a.map { |x| q(x) }.join(",") + "]"; end

pk = R[:pk]; van = R[:van]; all = pk + van
nhoms = all.map { |r| [r[:nhom].to_s, r[:loai]] }.uniq.reject { |t, _| t.empty? }

out = []
out << "-- KHO-1 seed — #{all.size} mã (#{pk.size} pk + #{van.size} ván). Lô mở đầu #{NGAY}."
out << "-- Chạy SAU 001_schema.sql. Idempotent-ish: dùng on conflict do nothing cho danh mục."
out << "begin;"
out << "insert into kho(ten,la_mac_dinh) values ('Xưởng',true) on conflict (ten) do nothing;"
out << "insert into nhom(ten,loai) values"
out << "  " + nhoms.map { |t, l| "(#{q(t)},#{q(l)})" }.join(",\n  ") + "\n  on conflict (ten) do nothing;"

out << "\n-- ── VẬT TƯ (#{all.size}) ──"
all.each do |r|
  nhom_sel = r[:nhom].to_s.empty? ? "null" : "(select id from nhom where ten=#{q(r[:nhom])})"
  cols = %w[ma ten loai nhom_id dvt so_moi_dvt dvt_goc do_day_mm vat_lieu hoan_thien ma_van_ncc anh_ma ton_toi_thieu can_kiem_tra ghi_chu_co]
  vals = [q(r[:ma]), q(r[:ten]), q(r[:loai]), nhom_sel, q(r[:dvt]), n(r[:so_moi_dvt]),
          q(r[:dvt_goc]), n(r[:do_day_mm]), q(r[:vat_lieu]), q(r[:hoan_thien]), q(r[:ma_van_ncc]),
          q(r[:anh_ma]), n(r[:ton_toi_thieu] || 0), (r[:can_kiem_tra] ? "true" : "false"), arr(r[:ghi_chu_co])]
  out << "insert into vat_tu(#{cols.join(",")}) values(#{vals.join(",")}) on conflict (ma) do nothing;"
end

out << "\n-- ── TỒN + LÔ MỞ ĐẦU + THẺ KHO (giao dịch nhập mở đầu) ──"
out << "with k as (select id from kho where ten='Xưởng')"
out << "insert into ton(vat_tu_id,kho_id,so_luong,gia_von_bq)"
out << "select v.id,(select id from k),t.sl,t.bq from (values"
tonvals = all.map do |r|
  "(#{q(r[:ma])}, #{n(r[:ton] || 0)}::numeric, #{n(r[:gia_von])}::numeric)"
end
out << "  " + tonvals.join(",\n  ")
out << ") as t(ma,sl,bq) join vat_tu v on v.ma=t.ma on conflict (vat_tu_id,kho_id) do nothing;"

# lô + giao dịch CHỈ cho mã tồn != 0
co_ton = all.select { |r| (r[:ton] || 0) != 0 }
out << "\n-- lô mở đầu (#{co_ton.size} mã có tồn) + giao dịch nhập mở đầu"
co_ton.each do |r|
  ksel = "(select id from kho where ten='Xưởng')"
  vsel = "(select id from vat_tu where ma=#{q(r[:ma])})"
  # CHỊU CHẠY LẠI: chỉ chèn lô mở đầu nếu vật tư+kho CHƯA có lô nào (where not exists).
  #   Chạy lần 2 -> L rỗng -> KHÔNG thêm lô, KHÔNG thêm giao dịch. (Lô mở đầu là lô ĐẦU TIÊN của mã.)
  cb = (r[:ton] || 0) < 0 ? "'ton_am'" : "null"
  out << "with L as (insert into lo_nhap(vat_tu_id,kho_id,so_luong_nhap,gia_von_lo,con_lai,ngay) " \
         "select #{vsel},#{ksel},#{n(r[:ton])},#{n(r[:gia_von])},#{n(r[:ton])},#{q(NGAY)} " \
         "where not exists (select 1 from lo_nhap where vat_tu_id=#{vsel} and kho_id=#{ksel}) " \
         "returning id) " \
         "insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,lo_nhap_id,so_du_sau,nguon,canh_bao) " \
         "select #{vsel},#{ksel},'nhap',#{n(r[:ton])},L.id,#{n(r[:ton])},'phieu',#{cb} from L;"
end

out << "\n-- ════ KIỂM (VIỆC 5) — sai thì RAISE ════"
out << <<~SQL
  -- So trực tiếp bằng subquery (tránh cú pháp linter Supabase hiểu nhầm thành tạo bảng).
  --   Tác dụng GIỮ NGUYÊN: RAISE khi sai 199/154/45 mã hoặc lệch tổng tồn PK 233.054.400đ.
  do $$
  begin
    if (select count(*) from vat_tu) <> 199 then
      raise exception 'SỐ MÃ = % (cần 199)', (select count(*) from vat_tu); end if;
    if (select count(*) from vat_tu where loai='pk') <> 154 then
      raise exception 'PK = % (cần 154)', (select count(*) from vat_tu where loai='pk'); end if;
    if (select count(*) from vat_tu where loai='van') <> 45 then
      raise exception 'VÁN = % (cần 45)', (select count(*) from vat_tu where loai='van'); end if;
    if round((select coalesce(sum(t.so_luong*t.gia_von_bq),0)
              from ton t join vat_tu v on v.id=t.vat_tu_id
              where v.loai='pk' and t.gia_von_bq is not null)) <> 233054400 then
      raise exception 'TỔNG TỒN PK = % (cần 233.054.400)',
        (select coalesce(sum(t.so_luong*t.gia_von_bq),0)
         from ton t join vat_tu v on v.id=t.vat_tu_id
         where v.loai='pk' and t.gia_von_bq is not null); end if;
    raise notice 'OK KHO-1: % mã (%pk+%ván) · tồn PK=% · tồn VÁN=% (ván chưa có giá, tách khỏi tổng)',
      (select count(*) from vat_tu),
      (select count(*) from vat_tu where loai='pk'),
      (select count(*) from vat_tu where loai='van'),
      (select coalesce(sum(t.so_luong*t.gia_von_bq),0) from ton t join vat_tu v on v.id=t.vat_tu_id where v.loai='pk' and t.gia_von_bq is not null),
      (select coalesce(sum(t.so_luong*t.gia_von_bq),0) from ton t join vat_tu v on v.id=t.vat_tu_id where v.loai='van' and t.gia_von_bq is not null);
  end $$;
SQL
out << "commit;"

File.write(File.join(ROOT, "db", "002_seed.sql"), out.join("\n") + "\n")
puts "-> db/002_seed.sql (#{out.join("\n").lines.size} dòng · #{all.size} vật tư · #{co_ton.size} lô mở đầu)"
