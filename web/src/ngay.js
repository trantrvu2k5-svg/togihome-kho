// WP-14b · MỘT NGUỒN SINH NGÀY NGHIỆP VỤ. "Ngày nghiệp vụ KHÔNG đi qua UTC."
// GHIM timeZone 'Asia/Ho_Chi_Minh' TƯỜNG MINH — độc lập giờ máy (máy CEO UTC+7, nhưng node/CI/robot là UTC:
//   đó chính là chỗ lệch −1 ngày lúc 00:00–07:00). CẤM dùng toISOString()/getHours máy cho ngày nghiệp vụ.
// CẤM thêm hàm ngày ở nơi khác — nhân bản là bệnh (WP-99). App Sale nạp qua sale.js (import + window.*), KHÔNG chép nội dung.

const _TZ = 'Asia/Ho_Chi_Minh'
// 'sv-SE' cho định dạng 'YYYY-MM-DD'; timeZone ghim → không phụ thuộc process.env.TZ
const _FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: _TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

export function ngayNghiepVu(d = new Date()) {
  return _FMT.format(d instanceof Date ? d : new Date(d))   // 'YYYY-MM-DD' theo giờ VN
}
export function kyNghiepVu(d = new Date()) {
  // Chuỗi đã là ngày nghiệp vụ ('YYYY-MM-DD…') → cắt TRỰC TIẾP, KHÔNG parse lại (tránh lệch khi là 'YYYY-MM-DD HH:MM').
  if (typeof d === 'string') return d.slice(0, 7)
  return ngayNghiepVu(d).slice(0, 7)                          // Date → định giờ VN rồi cắt
}
export function congNgay(d, n) {
  const base = d instanceof Date ? d : new Date(d)
  return new Date(base.getTime() + (n || 0) * 86400000)      // Date; định dạng bằng ngayNghiepVu()
}
