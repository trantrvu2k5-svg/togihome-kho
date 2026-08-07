// Vá auth.users tạo tay: GoTrue cần các cột token là '' (không NULL). Đặt về '' cho 3 tài khoản thử.
import pg from 'pg'
import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const cols = ['confirmation_token', 'recovery_token', 'email_change', 'email_change_token_new',
  'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token']
const { rows } = await c.query(
  `select column_name from information_schema.columns
   where table_schema='auth' and table_name='users' and data_type in ('character varying','text') and column_name = any($1)`, [cols])
const have = rows.map(r => r.column_name)
const set = have.map(cc => `${cc}=coalesce(${cc},'')`).join(', ')
const r = await c.query(
  `update auth.users set ${set} where email in ('ceo@togihome.local','kho@togihome.local','tho1234@kho.local')`)
console.log('✅ đã vá', r.rowCount, 'tài khoản · cột:', have.join(','))
await c.end()
