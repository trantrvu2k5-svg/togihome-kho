// [WP-91 L-91.2-2 · QD-96/WP-11b] Chọn nhánh việc theo DANH-SÁCH-CHO-PHÉP (whitelist).
//   Cron/job KHÔNG khai → NÉM (không rơi về ads, không rơi về lead). Thêm cron mà quên khai → thấy ngay.
//   Hàm THUẦN (không phụ thuộc Workers runtime) → test node được.

// cron biểu thức → nhánh. Đồng bộ với wrangler.toml [triggers] crons.
export const CRON_VIEC = {
  '* * * * *': 'lead',
  '0 19,23,3,7,11,15 * * *': 'ads',
}
export function chonViecCron(cron) {
  const v = CRON_VIEC[cron]
  if (!v) throw new Error('cron lạ: ' + (cron == null || cron === '' ? '(rỗng)' : cron))
  return v
}

// ?job= → nhánh. Mặc định (không có job) = 'lead' (giữ hành vi cũ). job lạ → null → caller trả 400.
export const JOB_VIEC = {
  '': 'lead',
  lead: 'lead',
  ads: 'ads',
}
export function chonViecJob(job) {
  const key = job == null ? '' : String(job)
  return Object.prototype.hasOwnProperty.call(JOB_VIEC, key) ? JOB_VIEC[key] : null
}
