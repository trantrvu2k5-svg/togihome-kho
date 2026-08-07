// Đổi mật khẩu ceo@ + kho@ sang mạnh ngẫu nhiên. IN 1 LẦN ra màn hình. KHÔNG ghi file, KHÔNG commit.
import pg from 'pg'
import { docConfig } from './conn.mjs'
import crypto from 'crypto'
const c = new pg.Client(await docConfig()); await c.connect()
const gen = () => {
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const b = crypto.randomBytes(18)
  return Array.from(b).map(x => set[x % set.length]).join('').slice(0, 16)
}
const accts = [{ email: 'ceo@togihome.local', vai: 'CEO' }, { email: 'kho@togihome.local', vai: 'Kho' }]
console.log('═══ MẬT KHẨU MỚI — sao chép NGAY (in 1 lần, không lưu ở đâu) ═══')
for (const a of accts) {
  const pw = gen()
  const r = await c.query("update auth.users set encrypted_password=crypt($1,gen_salt('bf')), updated_at=now() where email=$2", [pw, a.email])
  console.log(`  ${a.vai.padEnd(4)} ${a.email}   →   ${pw}   ${r.rowCount ? '' : '(⚠ không thấy tài khoản)'}`)
}
console.log('  Thợ: giữ PIN 1234.')
await c.end()
