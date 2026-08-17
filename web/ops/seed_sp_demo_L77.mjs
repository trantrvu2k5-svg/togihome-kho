// SEED demo SP L-77c — QUA ĐÚNG RPC ba tầng (sp_tao_loi_moi/sp_tao_bien_the/tao_niem_yet), KHÔNG insert thẳng.
// Tên 3 kênh sinh theo LUẬT skill (áp nguyên văn). Giá [TẠM] = 5.000.000 phẳng cho mọi niêm yết (cấm bịa giá thật).
// Idempotent: bỏ qua lõi có ten_ky_thuat trùng. Chạy: cd web && node ops/seed_sp_demo_L77.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const GIA_TAM = 5000000
const BR = ['togihome', 'mulig']   // 2 brand
const titleCase = s => (s || '').split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
const mmSize = r => { const s = (r / 1000).toFixed(1); return s.replace('.', 'm').replace(/m0$/, 'm') }
const fmtSizes = sz => { const u = [...new Set(sz.filter(Boolean))]; return u.length <= 3 ? u.join('/') : 'nhiều size từ ' + u[0] + ' đến ' + u[u.length - 1] }
// đọc tên brand
const brNames = {}
async function loadBr() { const r = (await c.query(`select ma, ten from kho.thuong_hieu where ma = any($1)`, [BR])).rows; r.forEach(x => brNames[x.ma] = x.ten) }
const SP = [
  { dong: 'TA', loai: 'Tủ quần áo', dd: 'Cửa Lùa Gương', cl: 'gỗ MDF phủ Melamine', pc: 'Bắc Âu', bt: [['2 cánh', 1200], ['3 cánh', 1600], ['4 cánh', 2000]] },
  { dong: 'GN', loai: 'Giường ngủ', dd: 'Hộp Thấp UD9A Có Ngăn Chứa', cl: 'gỗ công nghiệp An Cường', pc: 'hiện đại', bt: [['1m4', 1400], ['1m6', 1600], ['1m8', 1800]] },
  { dong: 'BLV', loai: 'Bàn làm việc', dd: 'BLV005 Chân Sắt Kèm Kệ', cl: 'mặt gỗ Melamine', pc: 'tối giản', bt: [['1m2', 1200], ['1m4', 1400]] },
  { dong: 'BLV', loai: 'Bàn làm việc', dd: 'BLV007 Có Hộc Tủ Di Động', cl: 'gỗ MDF phủ Melamine', pc: 'công năng', bt: [['1m2', 1200], ['1m6', 1600]] },
  { dong: 'BLV', loai: 'Bàn làm việc', dd: 'BLV008 Chữ L Góc Phải', cl: 'mặt gỗ Melamine', pc: 'hiện đại', bt: [['góc phải', 1600]] },
  { dong: 'HK', loai: 'Hộc kéo module', dd: 'NORDLI Ba Ngăn Xếp Tầng', cl: 'gỗ MDF phủ Melamine', pc: 'Bắc Âu', bt: [['rộng 400', 400], ['rộng 800', 800]] },
  { dong: 'HB', loai: 'Hệ bàn', dd: 'OY4V Liên Hoàn Nhiều Chỗ', cl: 'mặt gỗ Melamine', pc: 'văn phòng', bt: [['2 chỗ', 1600], ['4 chỗ', 2400]] },
  { dong: 'BT', loai: 'Bàn trà', dd: 'OV2V Kéo Mở Rộng Mặt', cl: 'gỗ sồi tự nhiên', pc: 'Bắc Âu', bt: [['nhỏ', 900], ['lớn', 1200]] },
  { dong: 'KE', loai: 'Kệ trang trí', dd: 'Ô Vuông Kết Hợp Mở', cl: 'gỗ MDF phủ Melamine', pc: 'hiện đại', bt: [['3 tầng', 800], ['5 tầng', 800]] },
  { dong: 'TG', loai: 'Tủ giày', dd: 'Cánh Lật Thông Minh', cl: 'gỗ MDF phủ Melamine', pc: 'tối giản', bt: [['2 tầng', 800], ['3 tầng', 800]] },
  { dong: 'BA', loai: 'Bàn ăn', dd: 'Mặt Đá Ceramic Chân Sắt', cl: 'khung sắt sơn tĩnh điện', pc: 'hiện đại', bt: [['4 ghế', 1200], ['6 ghế', 1600]] },
  { dong: 'TD', loai: 'Tab đầu giường', dd: 'Hai Ngăn Kéo Tay Nắm Âm', cl: 'gỗ MDF phủ Melamine', pc: 'Bắc Âu', bt: [['tiêu chuẩn', 450]] },
]
async function asCeo(sql, args) { await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: CEO, role: 'authenticated' })]); const r = await c.query(sql, args); await c.query('reset role'); return r.rows }
try {
  await c.query('begin'); await loadBr()
  let nLoi = 0, nBt = 0, nNy = 0, skip = 0
  for (const p of SP) {
    const tkt = p.loai + ' ' + p.dd + ' (demo L77)'
    if ((await c.query(`select 1 from kho.san_pham_loi where ten_ky_thuat=$1`, [tkt])).rows.length) { skip++; continue }
    const l = (await asCeo(`select kho.sp_tao_loi_moi($1,$2,$3,null,'[TẠM] seed demo L-77c') g`, [p.dong, tkt, p.loai]))[0].g
    nLoi++
    const skus = []
    for (const [ten, rong] of p.bt) { const b = (await asCeo(`select kho.sp_tao_bien_the($1,$2,$3,$4,null,$5,null) g`, [l.ma_loi, p.loai + ' ' + ten, p.cl, mmSize(rong), rong]))[0].g; skus.push(b.ma); nBt++ }
    const sizes = p.bt.map(x => mmSize(x[1]))
    for (const brand of BR) {
      const web = `${titleCase(p.dd)} - ${p.loai} ${p.cl}, ${p.pc} | ${brNames[brand]} - ${l.ma_loi}`
      const san = `${p.loai} ${p.dd} ${p.cl} - ${p.pc}, size ${fmtSizes(sizes)} | ${brNames[brand]} - ${l.ma_loi}`
      await asCeo(`select kho.tao_niem_yet($1,$2,$3,'',$4,$5)`, [skus[0], brand, web, san, GIA_TAM]); nNy++   // 1 niêm yết/(lõi,brand): tên listing (web KHÔNG size), size để ở biến thể
    }
    console.log(`  ${l.ma_loi} · ${skus.length} biến thể · web ${(`${titleCase(p.dd)} - ${p.loai} ${p.cl}, ${p.pc} | ${brNames[BR[0]]} - ${l.ma_loi}`).length}c`)
  }
  await c.query('commit')
  console.log(`SEED XONG: +${nLoi} lõi · ${nBt} biến thể · ${nNy} niêm yết (bỏ qua ${skip} đã có). Giá tất cả [TẠM] ${GIA_TAM.toLocaleString('vi-VN')}đ.`)
} catch (e) { console.error('LỖI:', e.message); await c.query('rollback') } finally { await c.end() }
