// WP-70 L-05 · RUNNER cho launchd — gọi keo_lead_pancake.mjs --moi MỖI 60s (định nghĩa xong "≤60s").
//   Vì hệ CHƯA có cơ chế việc-nền nào (không pg_cron/launchd/cron), dùng launchd (bộ lịch sẵn của macOS) —
//   không đẻ cơ chế mới, chỉ là bộ hẹn giờ của OS gọi runner này.
//   BẮT BUỘC (L-05): (1) khoá chống chồng lượt · (2) 429/lỗi → puller tự lùi dần; 5 lỗi LIÊN TIẾP ở runner → NGỦ 15'
//   · (3) mỗi lượt 1 dòng log gọn (giờ · lead mới · lỗi). KHÔNG in token (chỉ đọc "ghi mới N" từ stdout puller).
import { spawnSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync, appendFileSync } from 'fs'
import { homedir } from 'os'; import { join, dirname } from 'path'; import { fileURLToPath } from 'url'

const HOME = homedir()
const LOCK  = join(HOME, '.pancake_keo.lock')
const STATE = join(HOME, '.pancake_keo.state.json')
const LOG   = join(HOME, 'pancake_keo.log')
const OPS   = dirname(fileURLToPath(import.meta.url))
const NGU_PHUT = 15, TOI_DA_LOI = 5, LOCK_TTL_MS = 5 * 60 * 1000

const hhmm = d => d.toTimeString().slice(0, 8)
const ghiLog = s => { const l = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} · ${s}\n`; try { appendFileSync(LOG, l) } catch {} process.stdout.write(l) }
const docState = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return { loi_lien_tiep: 0, ngu_toi: null } } }
const ghiState = s => { try { writeFileSync(STATE, JSON.stringify(s)) } catch {} }

const st = docState()

// (2b) BACKOFF: đang trong 15' ngủ sau 5 lỗi liên tiếp → bỏ lượt, không bắn mãi
if (st.ngu_toi && Date.now() < st.ngu_toi) { ghiLog(`đang ngủ tới ${hhmm(new Date(st.ngu_toi))} (sau ${TOI_DA_LOI} lỗi liên tiếp) — bỏ lượt`); process.exit(0) }

// (1) KHOÁ chống chồng: lượt trước chưa xong → bỏ lượt này (không xếp hàng)
if (existsSync(LOCK)) {
  const age = Date.now() - statSync(LOCK).mtimeMs
  if (age < LOCK_TTL_MS) { ghiLog('bỏ qua: lượt trước chưa xong'); process.exit(0) }
  try { unlinkSync(LOCK) } catch {}          // khoá quá TTL = tiến trình chết → gỡ, chạy tiếp
}
writeFileSync(LOCK, String(process.pid))

try {
  const t0 = Date.now()
  // (3) chạy --moi (retry 429 lùi dần đã nằm trong layTrang của puller). Trần thời gian 4' để không treo khoá.
  // process.execPath = node tuyệt đối (launchd PATH tối giản, KHÔNG có /usr/local/bin → 'node' trần ENOENT)
  const r = spawnSync(process.execPath, ['keo_lead_pancake.mjs'], { cwd: OPS, encoding: 'utf8', timeout: 4 * 60 * 1000 })
  const out = (r.stdout || '') + (r.stderr || '')
  const ok = r.status === 0 && !/LỖI:/.test(out) && !r.error
  const ghi = [...out.matchAll(/ghi mới (\d+)/g)].reduce((a, m) => a + (+m[1]), 0)   // KHÔNG in token; chỉ đếm số ghi
  const sec = ((Date.now() - t0) / 1000).toFixed(1)
  if (ok) {
    ghiState({ loi_lien_tiep: 0, ngu_toi: null })
    ghiLog(`+${ghi} lead mới · ${sec}s · ok`)
  } else {
    const fails = (st.loi_lien_tiep || 0) + 1
    const loi = ((out.match(/LỖI:.*/) || [])[0] || (r.error && r.error.message) || 'lỗi không rõ').slice(0, 90)
    if (fails >= TOI_DA_LOI) {
      ghiState({ loi_lien_tiep: fails, ngu_toi: Date.now() + NGU_PHUT * 60 * 1000 })
      ghiLog(`lỗi (${fails}/${TOI_DA_LOI}): ${loi} — ${TOI_DA_LOI} lỗi LIÊN TIẾP → NGỦ ${NGU_PHUT} phút`)
    } else {
      ghiState({ loi_lien_tiep: fails, ngu_toi: null })
      ghiLog(`lỗi (${fails}/${TOI_DA_LOI}): ${loi}`)
    }
  }
} finally { try { unlinkSync(LOCK) } catch {} }
