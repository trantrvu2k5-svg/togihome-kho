// run_sql.mjs — chạy 1 file .sql qua DATABASE_URL (conn.mjs). CÓ CỔNG BACKUP PRE-MIGRATE (WP-96):
//   KHÔNG dump được thì KHÔNG migrate. Backup fail = CHẶN, exit≠0, không gửi SQL lên server.
//   Cửa hậu CÓ CHỦ Ý: BO_QUA_BACKUP=1 (chỉ cho file scratch) — in cảnh báo ĐỎ.
//   KHÔNG bọc transaction, KHÔNG sổ migration (WP riêng — không kèm ở đây).
import { readFileSync, mkdirSync, statSync, readdirSync, unlinkSync, chmodSync } from 'fs'
import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { basename, join } from 'path'
import pg from 'pg'
import { docConfig } from './conn.mjs'

const BACKUP_DIR = join(homedir(), 'togihome_backup')
const PG17_BIN = '/Applications/Postgres.app/Contents/Versions/17/bin'
const GIU_LAI = 20
const do_ = s => `\x1b[1;31m${s}\x1b[0m`   // đỏ đậm

const file = process.argv[2]
if (!file) { console.error('dùng: node ops/run_sql.mjs <file.sql>'); process.exit(1) }

function ts() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}` }

function timPgDump() {   // PGDUMP_BIN (test) > pg_dump PATH > Postgres.app 17
  const cands = process.env.PGDUMP_BIN ? [process.env.PGDUMP_BIN] : ['pg_dump', join(PG17_BIN, 'pg_dump')]
  for (const bin of cands) {
    try { const v = execFileSync(bin, ['--version'], { encoding: 'utf8' }); const m = v.match(/PostgreSQL\)\s+(\d+)/); if (m) return { bin, major: +m[1], ver: v.trim() } } catch { }
  }
  return null
}

function diaTrongGiB(dir) {
  try { const out = execFileSync('df', ['-g', dir], { encoding: 'utf8' }); return parseInt(out.trim().split('\n').pop().split(/\s+/)[3], 10) } catch { return null }
}

function xoayVong() {   // giữ 20 file pre_*.dump mới nhất, xoá cũ hơn (CHỈ khớp mẫu — không đụng file lạ)
  const fs = readdirSync(BACKUP_DIR).filter(f => /^pre_.*\.dump$/.test(f))
    .map(f => ({ f, m: statSync(join(BACKUP_DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m)
  const xoa = fs.slice(GIU_LAI)
  for (const x of xoa) unlinkSync(join(BACKUP_DIR, x.f))
  return xoa.map(x => x.f)
}

async function main() {
  const cfg = await docConfig()
  const client = new pg.Client(cfg)
  client.on('notice', m => console.log('  NOTICE:', m.message))
  await client.connect()

  if (process.env.BO_QUA_BACKUP === '1') {
    console.error(do_('⚠️  BO_QUA_BACKUP=1 — BỎ QUA BACKUP PRE-MIGRATE. Chỉ dùng cho file SCRATCH, KHÔNG phải để lách backup thật!'))
  } else {
    // (1) pg_dump 17.x
    const pd = timPgDump()
    if (!pd) {
      console.error('❌ CHẶN MIGRATE: không tìm thấy pg_dump 17.x. Thêm client Postgres.app vào PATH:')
      console.error('   export PATH=' + PG17_BIN + ':$PATH')
      await client.end(); process.exit(3)
    }
    // (2) major client == major server
    const svn = (await client.query('show server_version_num')).rows[0].server_version_num
    const svMajor = Math.floor(+svn / 10000)
    if (pd.major !== svMajor) {
      console.error(`❌ CHẶN MIGRATE: pg_dump major ${pd.major} ≠ server major ${svMajor} — dump lệch major là HỎNG. (${pd.ver})`)
      console.error('   Cần client PostgreSQL ' + svMajor + '.x. Postgres.app: ' + PG17_BIN)
      await client.end(); process.exit(3)
    }
    // (3) đĩa
    mkdirSync(BACKUP_DIR, { recursive: true }); try { chmodSync(BACKUP_DIR, 0o700) } catch { }
    const gib = diaTrongGiB(BACKUP_DIR)
    if (gib !== null && gib < 2) {
      console.error(`❌ CHẶN MIGRATE: đĩa còn ${gib} GiB (< 2 GiB) — không đủ chỗ dump, không migrate.`)
      await client.end(); process.exit(3)
    }
    // (4) DUMP — fail = CHẶN, KHÔNG chạy SQL
    const out = join(BACKUP_DIR, `pre_${basename(file).replace(/\.sql$/i, '')}_${ts()}.dump`)
    const env = { ...process.env, PGHOST: cfg.host, PGPORT: String(cfg.port), PGUSER: cfg.user, PGPASSWORD: cfg.password, PGDATABASE: cfg.database, PGSSLMODE: 'require' }
    const t0 = Date.now()
    try { execFileSync(pd.bin, ['-Fc', '-f', out], { env, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e) {
      console.error('❌ CHẶN MIGRATE: pg_dump THẤT BẠI — KHÔNG gửi SQL lên server.')
      console.error(do_((e.stderr && e.stderr.toString().trim()) || e.message))
      await client.end(); process.exit(4)
    }
    const sec = ((Date.now() - t0) / 1000).toFixed(1)
    const mb = (statSync(out).size / 1048576).toFixed(2)
    // (5) xoay vòng
    const daXoa = xoayVong()
    // (6) in TRƯỚC khi chạy SQL
    console.log(`🔒 Backup pre-migrate: ${out} · ${mb} MB · ${sec}s`)
    if (daXoa.length) console.log(`   xoay vòng (giữ ${GIU_LAI}): xoá ${daXoa.length} file cũ — ${daXoa.join(', ')}`)
  }

  // ── chạy SQL (chỉ tới đây khi backup OK hoặc BO_QUA_BACKUP) ──
  try {
    await client.query(readFileSync(file, 'utf8'))
    console.log('✅ CHẠY XONG:', file)
  } catch (e) {
    console.error('❌ LỖI khi chạy', file, '\n', e.message); process.exitCode = 2
  } finally { await client.end() }
}
main().catch(e => { console.error('❌', e.message); process.exit(1) })
