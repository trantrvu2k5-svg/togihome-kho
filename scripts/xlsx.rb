# Parser xlsx thuần (không gem): unzip sẵn -> đọc sharedStrings + sheet1 -> mảng hàng (mảng cột).
require "rexml/document"
module Xlsx
  module_function
  def rows(dir)
    ss = []
    ssp = File.join(dir, "xl", "sharedStrings.xml")
    if File.exist?(ssp)
      REXML::Document.new(File.read(ssp)).root.elements.each("si") do |si|
        ss << si.get_elements(".//t").map { |t| t.text.to_s }.join
      end
    end
    colnum = ->(ref) { ref[/^[A-Z]+/].bytes.reduce(0) { |a, b| a * 26 + (b - 64) } }
    data = {}
    REXML::Document.new(File.read(File.join(dir, "xl", "worksheets", "sheet1.xml"))).root.each_element("//row") do |row|
      rn = row.attribute("r").value.to_i
      cells = {}
      row.each_element("c") do |c|
        ref = c.attribute("r").value
        t = c.attribute("t")&.value
        v = c.get_elements("v").first&.text
        val = if t == "s" then (v ? ss[v.to_i] : "")
              elsif t == "inlineStr" then c.get_elements(".//t").map { |x| x.text }.join
              else v end
        cells[colnum.(ref)] = val
      end
      data[rn] = cells
    end
    maxc = data.values.flat_map(&:keys).max || 0
    data.keys.sort.map { |rn| (1..maxc).map { |ci| data[rn][ci].to_s } }
  end
end
