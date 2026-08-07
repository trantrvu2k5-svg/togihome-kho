// Chạy 1 file .sql qua chuỗi kết nối DATABASE_URL (đọc .env gốc). In NOTICE/ lỗi nguyên văn.
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'

const file = process.argv[2]
if (!file) { console.error('dùng: node ops/run_sql.mjs <file.sql>'); process.exit(1) }
let cfg; try { cfg = await docConfig() } catch (e) { console.error('❌', e.message); process.exit(1) }
const client = new pg.Client(cfg)
client.on('notice', m => console.log('  NOTICE:', m.message))
try {
  await client.connect()
  await client.query(readFileSync(file, 'utf8'))
  console.log('✅ CHẠY XONG:', file)
} catch (e) {
  console.error('❌ LỖI khi chạy', file, '\n', e.message)
  process.exit(2)
} finally { await client.end() }
