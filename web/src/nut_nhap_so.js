// Quyết định nút BÀN GIAO XƯỞNG trên MỖI đơn (thẻ Việc của tôi · panel kanban) app THIẾT KẾ.
// NGUỒN DUY NHẤT — dùng cả ở render (thietke.js) lẫn test (ops/test_069.mjs), khỏi lệch. Xem QD-14.
//   • Chỉ vai thiet_ke + ceo thấy nút (tk_ban_hang · truong_nhom · vai khác → null).
//   • Đơn CHƯA CHỐT (còn báo giá) → null (không nút). Khớp server nhap_so_don_don_hang: bao_gia*.
//   • Đơn ĐÃ GỬI (đã vào chuyền) → "Xem số đã nhập" (vẫn vào xem lại được).
//   • Còn lại (đã chốt, chưa gửi) → "Gửi file sản xuất cho xưởng" (mở màn nhập số, KHÔNG gửi ngay).
// Bấm nút → mở màn Nhập số của ĐÚNG đơn (/?don=<ma_don>) — không đơn cố định.

export const VAI_THAY_NUT = ['thiet_ke', 'ceo']
export const TT_DA_VAO_CHUYEN = ['cho_cat', 'da_cat', 'dang_lam', 'xong_sx', 'cho_giao', 'da_giao']
const chuaChot = tt => String(tt || '').startsWith('bao_gia')   // báo giá = chưa lên đơn

export function nutNhapSo(trang_thai, vai, ma_don) {
  if (!VAI_THAY_NUT.includes(vai)) return null       // vế bảo vệ vai
  if (chuaChot(trang_thai)) return null              // đơn chưa chốt: KHÔNG nút
  if (!ma_don) return null
  const daDay = TT_DA_VAO_CHUYEN.includes(trang_thai)
  return {
    text: daDay ? 'Xem số đã nhập' : 'Gửi file sản xuất cho xưởng',
    href: '/?don=' + encodeURIComponent(ma_don),
    daDay
  }
}
