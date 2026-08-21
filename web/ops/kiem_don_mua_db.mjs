// WP-20 bước 11 — đối chiếu DB đơn mua theo so_don. node ops/kiem_don_mua_db.mjs <so_don>
import pg from 'pg'; import { docConfig } from './conn.mjs'
const SO = process.argv[2]
const c = new pg.Client(await docConfig()); await c.connect()
const q = async (s, a = []) => (await c.query(s, a)).rows
const d = (await q(`select id,so_don,trang_thai,ngay_can,ngay_ncc_hen from kho.don_mua where so_don=$1`, [SO]))[0]
if (!d) { console.log('KHÔNG thấy đơn', SO); await c.end(); process.exit(1) }
console.log('don_mua:', JSON.stringify(d))
const dong = await q(`select stt,so_luong,dvt,don_gia from kho.don_mua_dong where don_mua_id=$1 order by stt`, [d.id])
console.log('don_mua_dong:', JSON.stringify(dong))
const ls = await q(`select tu_trang_thai tu, toi_trang_thai toi, noi_dung from kho.don_mua_lich_su where don_mua_id=$1 order by luc`, [d.id])
console.log('don_mua_lich_su ('+ls.length+' dòng):', JSON.stringify(ls.map(x=>x.tu+'→'+x.toi)))
const okLs = ls.length === 4
const sl2 = Number(dong.find(x=>x.stt===2)?.so_luong)
console.log(okLs ? '✅ lịch sử 4 dòng (tạo·sửa·da_gui·xac_nhan)' : `❌ lịch sử = ${ls.length} (cần 4)`)
console.log(sl2 === 6 ? '✅ dòng 2 so_luong = 6' : `❌ dòng 2 = ${sl2} (cần 6)`)
await c.end()
