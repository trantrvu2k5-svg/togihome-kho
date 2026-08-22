// L-66 — xoa_demo MỘT đơn demo, vai test_ceo (robot dọn cuối vòng → 0 dấu vết). node ops/xoa_1_demo.mjs <ma_don>
//   Dùng tài khoản robot test_ceo (ceo) — không đụng tài khoản thật. xoa_demo tự kiểm la_demo + chỉ ceo.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const MA = process.argv[2]
if (!MA) { console.error('thiếu ma_don'); process.exit(2) }
const c = new pg.Client(await docConfig()); await c.connect()
const uid = (await c.query(`select auth_uid from kho.nguoi_dung where ho_ten='test_ceo'`)).rows[0]?.auth_uid
if (!uid) { console.error('không thấy test_ceo (chạy ops/dung_tk_robot.mjs)'); process.exit(2) }
await c.query('set role authenticated')
await c.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
try {
  const r = await c.query(`select kho.xoa_demo($1, null) x`, [MA])
  console.log('xoa_demo', MA, '→', JSON.stringify(r.rows[0].x).slice(0, 160))
} catch (e) { console.error('xoa_demo lỗi:', e.message); process.exitCode = 1 }
await c.query('reset role'); await c.end()
