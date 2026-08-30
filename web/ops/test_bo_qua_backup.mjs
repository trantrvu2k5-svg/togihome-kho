// TEST — siết cờ BO_QUA_BACKUP từ db/177 (L-02d). Chạy KHÔ: scratch `select 1;` + pg_dump STUB.
//   KHÔNG áp migration thật nào. Dọn file rác sau khi chạy.
import { spawnSync } from 'child_process'
import { writeFileSync, unlinkSync, chmodSync, readdirSync, existsSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

const OPS = new URL('.', import.meta.url).pathname
const SQL177 = join(tmpdir(), '177_test_siet_khoban.sql')
const SQL176 = join(tmpdir(), '176_test_siet_khoban.sql')
writeFileSync(SQL177, 'select 1;\n'); writeFileSync(SQL176, 'select 1;\n')
// stub pg_dump: --version → "PostgreSQL) 17"; -f <out> → tạo file (khô, không dump thật)
const STUB = join(tmpdir(), 'pgdump_stub.sh')
writeFileSync(STUB, `#!/bin/bash
if [ "$1" = "--version" ]; then echo "pg_dump (PostgreSQL) 17.4"; exit 0; fi
prev=""; for a in "$@"; do if [ "$prev" = "-f" ]; then echo stub > "$a"; fi; prev="$a"; done
exit 0
`); chmodSync(STUB, 0o755)

let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
function run(sqlFile, env) {
  const r = spawnSync('node', ['run_sql.mjs', sqlFile], { cwd: OPS, env: { ...process.env, ...env }, encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// [sửa lần 2 · 29/08] Cờ BO_QUA_BACKUP đã BỎ cho migration ≥177 — LUÔN backup, không đường vòng.
// 1 · mig 177 + cờ bật → cờ ĐÃ BỎ, VẪN backup + chạy (không còn thoát lỗi)
{ const r = run(SQL177, { BO_QUA_BACKUP: '1', PGDUMP_BIN: STUB })
  ok('1. 177 + cờ bật → cờ ĐÃ BỎ, VẪN backup + chạy', r.code === 0 && /Cờ BO_QUA_BACKUP đã BỎ/.test(r.out) && /Backup pre-migrate/.test(r.out) && /CHẠY XONG/.test(r.out), `code=${r.code} · ${r.out.slice(0, 140)}`) }

// 2 · mig 177 + cờ bật + CEO_BO_QUA="x" → CEO_BO_QUA VÔ HIỆU (khoá cũ gỡ), VẪN backup, KHÔNG log bỏ qua
{ const r = run(SQL177, { BO_QUA_BACKUP: '1', CEO_BO_QUA: 'lý do abc', PGDUMP_BIN: STUB })
  ok('2. 177 + CEO_BO_QUA → vô hiệu, VẪN backup (không MIGRATE-LOG bỏ qua)', r.code === 0 && /Backup pre-migrate/.test(r.out) && /CHẠY XONG/.test(r.out) && !/MIGRATE-LOG.*BO_QUA/.test(r.out), `code=${r.code} · ${r.out.slice(0, 140)}`) }

// 3 · mig 177 + cờ TẮT → chạy bình thường, CÓ backup (stub)
{ const r = run(SQL177, { BO_QUA_BACKUP: '', PGDUMP_BIN: STUB })
  ok('3. 177 + cờ TẮT → chạy + CÓ backup', r.code === 0 && /Backup pre-migrate/.test(r.out) && /CHẠY XONG/.test(r.out) && !/đã BỎ/.test(r.out), `code=${r.code} · ${r.out.slice(0, 120)}`) }

// 4 · mig 176 + cờ bật → SKIP backup (KHÔNG hồi tố), cảnh báo scratch, KHÔNG câu "đã BỎ"
{ const r = run(SQL176, { BO_QUA_BACKUP: '1' })
  ok('4. 176 + cờ bật → skip backup (không hồi tố), KHÔNG câu "đã BỎ"', r.code === 0 && /CHẠY XONG/.test(r.out) && /BỎ QUA BACKUP PRE-MIGRATE/.test(r.out) && !/đã BỎ/.test(r.out), `code=${r.code} · ${r.out.slice(0, 120)}`) }

// dọn: scratch + stub + dump rác của stub (pre_177_test_siet_*.dump)
for (const f of [SQL177, SQL176, STUB]) { try { unlinkSync(f) } catch { } }
const BK = join(homedir(), 'togihome_backup')
let rac = 0
if (existsSync(BK)) for (const f of readdirSync(BK).filter(x => /^pre_177_test_siet_.*\.dump$/.test(x))) { try { unlinkSync(join(BK, f)); rac++ } catch { } }
console.log(`\nDọn: scratch+stub xoá · dump stub rác xoá ${rac} · KHÔNG migration thật nào bị áp (scratch = select 1)`)
console.log(`═══ test_bo_qua_backup: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
