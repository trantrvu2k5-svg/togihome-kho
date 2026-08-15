// TEST CẮN — 075 · NHÃN TẤM người-đọc. Tx rollback. Chạy: cd web && node ops/test_075.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}

try {
  await c.query('begin')

  // ═══ 1 · MỌI vai_tro trong tem_ban_ve đều tra được tên ═══
  console.log('\n── 1 · mọi vai_tro thật trong tem_ban_ve đều có nhãn ──')
  const thieu = await q1(`select coalesce(string_agg(distinct t.vai_tro, ', '), '') as ma, count(distinct t.vai_tro) n
    from kho.tem_ban_ve t
    where t.vai_tro is not null
      and not exists (select 1 from kho.nhan_vai_tro_tam n where n.ma = t.vai_tro)`)
  console.log(`   số vai_tro KHÔNG tra được = ${thieu.n}${thieu.n > 0 ? ' → ' + thieu.ma : ''}`)
  ok('#1 join tem_ban_ve × nhan_vai_tro_tam → 0 mã không tra được (🟥 sót mã = ĐỎ)', Number(thieu.n) === 0)

  // liệt kê mã còn can_soat để CEO soát
  const soat = (await c.query(`select ma, nhom from kho.nhan_vai_tro_tam where can_soat order by ma`)).rows
  console.log(`   ⚠ ${soat.length} mã can_soat (tên = mã, chờ CEO soát): ${soat.map(r => r.ma + '(' + r.nhom + ')').join(', ')}`)

  // ═══ 2 · MÃ LẠ chưa gieo → tra NULL, nhưng RPC hiện CHÍNH MÃ (không trống) ═══
  console.log('\n── 2 · tem mang mã lạ → RPC trả chính mã, không trống ──')
  const LA = 'vai_tro_khong_ton_tai_xyz'
  await c.query(`insert into kho.don_hang(ma_don,trang_thai) values('T75-LA','dang_thiet_ke')`)
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro) values('T75-LA',1,'T75-LA|X',$1)`, [LA])
  // a) join thẳng → NULL (chứng minh mã này CHƯA có trong bảng tra)
  const jn = await q1(`select n.ten from kho.tem_ban_ve t left join kho.nhan_vai_tro_tam n on n.ma = t.vai_tro
    where t.ma_don = 'T75-LA'`)
  // b) RPC ten_vai_tro_tam → trả CHÍNH MÃ
  const rpcTen = await asK(CEO, `select kho.ten_vai_tro_tam($1) t`, [LA])
  const tenRa = rpcTen.r ? rpcTen.r[0].t : null
  // c) RPC nhom_vai_tro_tam → 'khac' (màn vẫn gom được)
  const rpcNhom = await asK(CEO, `select kho.nhom_vai_tro_tam($1) g`, [LA])
  const nhomRa = rpcNhom.r ? rpcNhom.r[0].g : null
  console.log(`   join thẳng ten = ${jn.ten === null ? 'NULL' : jn.ten} · RPC ten = "${tenRa}" · RPC nhom = "${nhomRa}"`)
  ok('#2a join thẳng mã lạ → NULL (đúng: chưa gieo)', jn.ten === null)
  ok('#2b RPC ten_vai_tro_tam(mã lạ) → CHÍNH MÃ, KHÔNG trống (🟥 trả NULL/rỗng = ĐỎ)', tenRa === LA)
  ok('#2c RPC nhom_vai_tro_tam(mã lạ) → "khac" (màn vẫn gom được)', nhomRa === 'khac')

  // ═══ 3 · mã đã gieo → RPC trả TÊN, không trả mã ═══
  console.log('\n── 3 · mã đã gieo → RPC trả tên tiếng Việt ──')
  const rC = await asK(CEO, `select kho.ten_vai_tro_tam('canh_cua') t`)
  const rH = await asK(CEO, `select kho.ten_vai_tro_tam('hong') t`)
  console.log(`   canh_cua → "${rC.r?.[0].t}" · hong → "${rH.r?.[0].t}"`)
  ok('#3 canh_cua→"cánh", hong→"hông"', rC.r?.[0].t === 'cánh' && rH.r?.[0].t === 'hông')

  console.log(`\n══ KẾT QUẢ 075: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack)
  F++
} finally {
  await c.query('rollback'); await c.end()
  process.exit(F ? 1 : 0)
}
