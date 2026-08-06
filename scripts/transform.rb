# KHO-1 — Đọc 2 Excel -> bản ghi chuẩn (vat_tu + lô + tồn) + KIỂM offline (VIỆC 5).
# KHÔNG cần khoá. Chạy: ruby scripts/transform.rb   (in số để đối chiếu trước khi upload)
require_relative "xlsx"
require "json"

ROOT = File.expand_path("..", __dir__)
def tien(n); n.round.to_s.reverse.gsub(/(\d{3})(?=\d)/, '\\1.').reverse; end

# ═══ PHỤ KIỆN (Kho .xlsx) ═══
kho = Xlsx.rows(File.join(ROOT, "scratch", "kho_x"))
hi  = kho.index { |r| r.any? { |c| c.to_s =~ /Mã\s*PK/ } }
prows = kho[(hi + 1)..].select { |r| r[0].to_s.strip != "" && r[0] != "Mã PK" && r[2].to_s.strip != "" }

pk = prows.map do |r|
  co = []
  ton = r[4].to_f
  col20 = (r[20].to_s.strip.empty? ? nil : r[20].to_f)   # Tổng tiền tồn = NGUỒN THẬT của giá trị tồn
  # gia_von_bq = giá THEO ĐƠN VỊ TỒN (túi/cái…) = col20/tồn. -> Σ(tồn×bq)=Σcol20 chuẩn.
  #   (col19 giá/cái riêng để tham chiếu; bulk thì col20=tồn×giá/túi, KHÔNG dùng giá/cái.)
  bq = (ton > 0 && col20) ? (col20 / ton) : (r[18].to_s.strip.empty? ? (r[19].to_s.strip.empty? ? nil : r[19].to_f) : r[18].to_f)
  if r[0] == "OV-19"; co << "gia_nghi_tui_lan_cai(790000)"; end   # đầu bài + đo: giá túi lẫn giá cái
  co << "chua_co_gia" if bq.nil? && col20.nil?
  co << "ton_am" if ton < 0
  { ma: r[0], ten: r[2], loai: "pk", nhom: r[3], dvt: r[6],
    so_moi_dvt: (r[7].to_s.strip.empty? ? nil : r[7].to_f),
    dvt_goc: r[8], anh_ma: (r[15].to_s.strip.empty? ? nil : r[15]),
    ton_toi_thieu: r[5].to_f, ton: ton, gia_von: bq, gia_cai_ref: (r[19].to_s.strip.empty? ? nil : r[19].to_f),
    tong_tien_ton_excel: col20,
    can_kiem_tra: !co.empty?, ghi_chu_co: co }
end

# ═══ VÁN (Mã gỗ (1).xlsx, sheet Trang tính2) ═══
go = Xlsx.rows(File.join(ROOT, "scratch", "go2_x"))
van = []; cur = nil
go.each do |r|
  a = r[0].to_s.strip
  next if a.empty? && r[1].to_s.strip.empty?
  head = (a + r[1].to_s)
  if head.include?("▶")
    cur = head.gsub("▶", "").gsub("#REF!", "").strip   # làm sạch tên nhóm (1 nhóm dính lỗi Excel)
  elsif !a.empty?
    ten = r[1].to_s.strip
    day = (ten[/(\d+(?:[.,]\d+)?)\s*mm/i, 1] || ten[/(?:^|\D)(\d{1,2})\s*(?:ly|li)\b/i, 1])
    day = day&.tr(",", ".")&.to_f
    van_ma = ten[/\b(\d{2,4}[A-Z]{0,2})\b\s*$/, 1]     # mã vân NCC cuối tên (4012, 347PL…)
    co = []
    co << "khong_boc_duoc_do_day" if day.nil?
    co << "chua_co_gia"           # ván chưa có giá -> luôn cờ
    van << { ma: a, ten: ten, loai: "van", nhom: cur, do_day_mm: day,
             vat_lieu: r[2].to_s.strip, hoan_thien: r[3].to_s.strip, ma_van_ncc: van_ma,
             ton: 0.0, gia_von: nil, can_kiem_tra: true, ghi_chu_co: co }
  end
end

# ═══ KIỂM (VIỆC 5) ═══
puts "═══ KIỂM offline (đối chiếu nguồn trước upload) ═══"
puts "Phụ kiện: #{pk.size}  ·  Ván: #{van.size}  ·  TỔNG vật tư = #{pk.size + van.size}  (kỳ vọng 199)"

# (a) tổng tiền tồn phụ kiện: NGUỒN THẬT = cột 20. gia_von_bq = col20/tồn -> Σ(tồn×bq) PHẢI = Σcol20.
tong_excel = pk.sum { |p| p[:tong_tien_ton_excel].to_f }
tong_db    = pk.sum { |p| (p[:gia_von] && p[:ton]) ? p[:ton] * p[:gia_von] : 0.0 }
puts "\nTổng tiền tồn PHỤ KIỆN (nguồn = cột 'Tổng tiền tồn'):"
puts "  Σ cột 20 (Excel)            = #{tien(tong_excel)} đ   (kỳ vọng 233.054.400)"
puts "  Σ (so_luong × gia_von_bq)   = #{tien(tong_db)} đ   (= sẽ tính từ DB sau upload)"
puts "  KHỚP: #{(tong_excel - tong_db).abs < 1 ? "✅ khớp tuyệt đối" : "❌ LỆCH #{tien(tong_excel - tong_db)}"}"
# bất nhất nội tại Excel: có col20 nhưng tồn=0 (không suy được đơn giá) / có tồn nhưng col20 trống
kho_suy = pk.select { |p| p[:tong_tien_ton_excel] && p[:ton] == 0 }
ton_khong_tien = pk.select { |p| p[:ton] > 0 && p[:tong_tien_ton_excel].nil? }
puts "  ⚠ col20>0 nhưng tồn=0 (không suy đơn giá): #{kho_suy.map { |p| p[:ma] }.inspect}" unless kho_suy.empty?
puts "  ⚠ tồn>0 nhưng col20 trống (chưa có giá): #{ton_khong_tien.map { |p| p[:ma] }.inspect}" unless ton_khong_tien.empty?

# (b) ván không vào tổng (chưa giá) — báo riêng
van_khong_gia = van.count { |v| v[:gia_von].nil? }
puts "\nVán: #{van_khong_gia}/#{van.size} mã CHƯA CÓ GIÁ -> gia_von NULL + cờ (KHÔNG vào tổng tiền)."
puts "  Ván thiếu độ dày (cờ): " + van.select { |v| v[:do_day_mm].nil? }.map { |v| v[:ma] }.inspect

# cờ tổng hợp
puts "\nCỜ can_kiem_tra: phụ kiện #{pk.count { |p| p[:can_kiem_tra] }} · ván #{van.count { |v| v[:can_kiem_tra] }}"
File.write(File.join(ROOT, "scratch", "records.json"), JSON.pretty_generate(pk: pk, van: van))
puts "\n-> scratch/records.json (#{pk.size + van.size} bản ghi) sẵn sàng upload khi có schema + khoá."
