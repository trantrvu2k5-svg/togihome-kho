# KHO-1 — Kiểm kết nối + THỬ RLS bằng khoá ANON (chưa đăng nhập). CHỈ ĐO, không sửa DB.
#   Chạy: ruby scripts/kiem_ket_noi.rb
# PostgREST đọc schema qua header Accept-Profile/Content-Profile (db_schemas có kho).
require "net/http"; require "json"; require "uri"

ROOT = File.expand_path("..", __dir__)
env = {}
File.readlines(File.join(ROOT, ".env")).each do |l|
  next if l.strip.start_with?("#") || !l.include?("=")
  k, v = l.split("=", 2)
  env[k.strip] = v.to_s.strip.split(/\s+/).first.to_s   # cắt chú thích sau khoá
end
URL = env["SUPABASE_URL"]; ANON = env["SUPABASE_ANON_KEY"]
abort "❌ thiếu SUPABASE_URL / SUPABASE_ANON_KEY trong .env" if URL.to_s.empty? || ANON.to_s.empty?
puts "URL: #{URL}  ·  anon key: #{ANON[0,8]}…(#{ANON.length} ký tự)\n\n"

def req(method, path, body: nil, prefer: nil, profile: "kho")
  uri = URI("#{URL}/rest/v1/#{path}")
  h = { "apikey" => ANON, "Authorization" => "Bearer #{ANON}" }
  h[method == :get ? "Accept-Profile" : "Content-Profile"] = profile
  h["Prefer"] = prefer if prefer
  h["Content-Type"] = "application/json" if body
  klass = { get: Net::HTTP::Get, post: Net::HTTP::Post, patch: Net::HTTP::Patch }[method]
  r = klass.new(uri)
  h.each { |k, v| r[k] = v }
  r.body = JSON.generate(body) if body
  http = Net::HTTP.new(uri.host, uri.port); http.use_ssl = true
  res = http.request(r)
  [res.code.to_i, res["content-range"], res.body.to_s[0, 300]]
end

def dem(cr) # Content-Range "0-198/199" -> 199
  cr && cr.include?("/") ? cr.split("/").last : "?"
end

puts "═══ 1) KẾT NỐI + ĐẾM (anon, chưa đăng nhập) ═══"
[["vat_tu", 199], ["lo_nhap", 133]].each do |tbl, ky_vong|
  code, cr, body = req(:get, "#{tbl}?select=id", prefer: "count=exact")
  n = dem(cr)
  puts "  GET kho.#{tbl}: HTTP #{code} · đếm=#{n} (kỳ vọng nếu ĐỌC ĐƯỢC: #{ky_vong})"
  puts "     body: #{body}" unless code == 200
end

puts "\n═══ 2) THỬ RLS — anon CHƯA đăng nhập (sau 005: đọc = RLS lọc 0 dòng · giá vốn = cột bị giữ) ═══"
# (a) đọc vat_tu (danh mục — không giá vốn). Kỳ vọng sau 005: 200 · 0 dòng (RLS lọc anon).
ca, cra, ba = req(:get, "vat_tu?select=ma&limit=3", prefer: "count=exact")
puts "  (a) ĐỌC kho.vat_tu        -> HTTP #{ca} · #{ca==200 ? "trả #{dem(cra)} dòng" : "chặn (#{ba[0,60]})"}"
# (a2) đọc ton.so_luong (KHÔNG giá vốn). Kỳ vọng sau 005: 200 · 0 dòng.
ca2, cra2, ba2 = req(:get, "ton?select=so_luong&limit=3", prefer: "count=exact")
puts "  (a2) ĐỌC kho.ton.so_luong -> HTTP #{ca2} · #{ca2==200 ? "trả #{dem(cra2)} dòng" : "chặn (#{ba2[0,60]})"}"
# (b) đọc GIÁ VỐN ton.gia_von_bq. Kỳ vọng sau 005: VẪN 401/403 (cột KHÔNG được cấp) -> giá vốn được bảo vệ.
cb, crb, bb = req(:get, "ton?select=gia_von_bq&limit=3", prefer: "count=exact")
leak = (cb == 200)
puts "  (b) ĐỌC kho.ton.gia_von   -> HTTP #{cb} · #{leak ? "!! LỘ #{dem(crb)} dòng GIÁ VỐN — LỖ HỔNG" : "chặn (#{bb[0,60]})"}"
# (c) chèn giao_dich (uuid ngẫu nhiên -> nếu RLS cho qua sẽ vướng FK; 401/403 = RLS/grant chặn)
row = { vat_tu_id: "00000000-0000-0000-0000-000000000001",
        kho_id: "00000000-0000-0000-0000-000000000002",
        loai: "lay", so_luong: -1, so_du_sau: 0, nguon: "quet_tem" }
cc, _, bc = req(:post, "giao_dich", body: row, prefer: "return=representation")
puts "  (c) CHÈN kho.giao_dich   -> HTTP #{cc} · #{[401,403].include?(cc) ? "CHẶN (RLS/grant)" : "!! LỌT tới DB"} · body #{bc}"
# (d) sửa vat_tu
cd, crd, bd = req(:patch, "vat_tu?ma=eq.BL-01", body: { ten: "HACKED_TEST" }, prefer: "return=representation,count=exact")
puts "  (d) SỬA kho.vat_tu       -> HTTP #{cd} · sửa #{cd==200 ? "#{dem(crd)} dòng #{crd ? "(#{crd})" : ""}" : "0"} · #{[401,403].include?(cd) ? "CHẶN" : (cd==200 && bd.gsub(/\s/,"")=="[]" ? "0 dòng (RLS lọc hết)" : "body #{bd}")}"

puts "\n(Đối chiếu docs/thiet_ke_bang.md: SELECT cần auth.uid() không null; GHI cần current_vai_tro in (ceo/kho/tho).)"
