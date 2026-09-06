// KHUÔN CHUNG cho MỌI đường ghi từ giao diện (WP-107). Đặt ở src/ dùng chung — KHÔNG copy vào từng app.
//   Chữa gốc bệnh "thao tác bị bỏ mà hệ báo thành công": bấm đúp = 2 ghi, nuốt lỗi, báo xong khi chưa biết.
//   L-107.1 đếm 104 đường ghi, chỉ ~19 có khoá nút → dồn về MỘT khuôn rồi áp dần.

// Banner lỗi TOÀN CỤC (đỏ, nổi trên cùng). Tự dựng 1 lần, dùng lại. NGUYÊN VĂN thông điệp — không soạn lại.
export function banner(msg) {
  let el = document.getElementById('__ghiAnToanBanner')
  if (!el) {
    el = document.createElement('div'); el.id = '__ghiAnToanBanner'
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;' +
      'max-width:90vw;padding:11px 16px;border-radius:10px;background:#C8202E;color:#fff;' +
      'font:600 13.5px system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:pre-wrap'
    document.body.appendChild(el)
  }
  el.textContent = msg; el.style.display = 'block'
  clearTimeout(el.__t); el.__t = setTimeout(() => { el.style.display = 'none' }, 6000)
}

// ghiAnToan(nut, viec) — làm ĐÚNG 5 việc, không hơn:
//   1. nut đang khoá → thoát ngay (KHÔNG chạy lần hai — chặn bấm đúp).
//   2. khoá nut + đổi chữ "Đang lưu…" (giữ chữ cũ).
//   3. chạy viec(); nhận { error } HOẶC ném lỗi.
//   4. có lỗi → banner NGUYÊN VĂN, KHÔNG báo thành công.
//   5. finally → mở khoá nut + trả chữ cũ (kể cả khi lỗi/ném).
// TỰ kiểm error → hàm gọi KHÔNG phải nhớ. Trả { ok, data?, error?, bo_qua? }; gọi xong chỉ cần `if (!r.ok) return`.
export async function ghiAnToan(nut, viec) {
  if (nut && nut.disabled) return { ok: false, bo_qua: true }          // 1
  const chuCu = nut ? nut.textContent : null
  if (nut) { nut.disabled = true; nut.textContent = 'Đang lưu…' }      // 2
  try {
    const kq = await viec()                                            // 3
    const err = kq && kq.error
    if (err) { banner(err.message || String(err)); return { ok: false, error: err } }   // 4
    return { ok: true, data: kq ? kq.data : undefined }
  } catch (e) {
    banner((e && e.message) || String(e))                             // 4 (ném cũng vào banner)
    return { ok: false, error: e }
  } finally {
    if (nut) { nut.disabled = false; nut.textContent = chuCu }        // 5
  }
}
