// Đọc DATABASE_URL, tách user+mật khẩu (bền với # @ + prefix lặp), TỰ DÒ region pooler nếu host là placeholder.
import { readFileSync } from 'fs'
import pg from 'pg'

const REGIONS = ['ap-southeast-1', 'ap-southeast-2', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2',
  'us-east-1', 'us-east-2', 'us-west-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'sa-east-1', 'ca-central-1']
let _cached = null

function tach() {
  // Ưu tiên biến môi trường rời (host/user không bí mật, pass qua DB_PASS) — dùng sau khi đã xoá DATABASE_URL.
  if (process.env.DB_HOST && process.env.DB_PASS) {
    return { user: process.env.DB_USER || 'postgres.ugebruuxkslsnbramils', password: process.env.DB_PASS,
             host: process.env.DB_HOST, port: 5432, database: 'postgres' }
  }
  const root = new URL('../../', import.meta.url).pathname
  let raw = (readFileSync(root + '.env', 'utf8').split('\n').find(l => l.startsWith('DATABASE_URL=')) || '').slice('DATABASE_URL='.length).trim()
  while (raw.startsWith('DATABASE_URL=')) raw = raw.slice('DATABASE_URL='.length).trim()   // bỏ prefix lặp
  if (!raw) throw new Error('THIẾU DATABASE_URL trong .env')
  const body = raw.replace(/^postgres(?:ql)?:\/\//, '')
  const at = body.lastIndexOf('@')                       // @ cuối = ngăn cred với host
  const cred = body.slice(0, at), hostpart = body.slice(at + 1)
  const c = cred.indexOf(':')
  const user = cred.slice(0, c)
  const password = process.env.DB_PASS || cred.slice(c + 1)   // DB_PASS (biến môi trường, không ghi file) thắng
  const host = (hostpart.split(':')[0] || '')
  return { user, password, host, port: 5432, database: 'postgres' }
}

export async function docConfig() {
  if (_cached) return _cached
  const p = tach()
  const base = { user: p.user, password: p.password, database: 'postgres', port: 5432, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 }
  // host hợp lệ (không placeholder) -> thử trước
  const thu = []
  if (p.host && !p.host.includes('<') && p.host.includes('.')) thu.push(p.host)
  REGIONS.forEach(r => thu.push(`aws-0-${r}.pooler.supabase.com`))
  let lastErr
  for (const host of thu) {
    const cfg = { ...base, host }
    const client = new pg.Client(cfg)
    try {
      await client.connect(); await client.query('select 1'); await client.end()
      _cached = cfg
      if (host !== p.host) console.error(`  (đã dò ra region: ${host})`)
      return cfg
    } catch (e) { lastErr = e; try { await client.end() } catch {} }
  }
  throw new Error('Không kết nối được region nào. Lỗi cuối: ' + (lastErr && lastErr.message))
}
