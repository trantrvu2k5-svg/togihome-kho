// TEST — WP-76 mục A (L-76b) · view v_mon_chu_de: món→chủ đề, mỗi món 0/1 loại, món không nối vẫn còn dòng (NULL).
//   Tx rollback. Chèn đơn+món demo bằng OWNER (không jwt claims) → trigger chốt bỏ qua (guard current_vai_tro rỗng).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]

await c.query('begin')
// biến thể THẬT nối được tới 1 loại (sp_id path)
const bt = await one(`select sm.ma sp, dl.loai_ma from kho.san_pham_mau sm
  join kho.san_pham_loi sl on sl.ma_loi=sm.ma_loi join kho.dong_loai dl on dl.dong_ma=sl.dong_id limit 1`)
// biến thể THẬT nhưng lõi/dòng CHƯA có dong_loai → "không nối được" (sp_id FK nên phải là mã có thật)
const bkc = await one(`select sm.ma sp from kho.san_pham_mau sm
  left join kho.san_pham_loi sl on sl.ma_loi=sm.ma_loi left join kho.dong_loai dl on dl.dong_ma=sl.dong_id
  where dl.loai_ma is null limit 1`)

await c.query(`insert into kho.don_hang(ma_don, dong, trang_thai, la_demo) values('WP76A_T','le','cho_cat',true)`)
const don = await one(`select id from kho.don_hang where ma_don='WP76A_T'`)
await c.query(`insert into kho.don_hang_mon(don_id, sp_id, ten) values
  ($1,$2,'món nối sp_id'), ($1,$3,'món không nối'), ($1,null,'món sp_id NULL')`,
  [don.id, bt.sp, bkc.sp])

const rows = (await c.query(`select m.ten, v.sp_id, v.loai_ma, v.nguon_chu_de
  from kho.v_mon_chu_de v join kho.don_hang_mon m on m.id=v.mon_id where v.don_id=$1 order by m.ten`, [don.id])).rows
const byTen = t => rows.find(r => r.ten === t)

// 1. đủ 3 dòng — món không nối vẫn CÒN dòng (không bị loại)
ok('1. 3 món → 3 dòng trong view (món không nối KHÔNG bị loại)', rows.length === 3, JSON.stringify(rows.map(r=>r.ten)))

// 2. món sp_id là biến thể nối được → loai đúng, nguon=sp_id
const a = byTen('món nối sp_id')
ok('2. món sp_id=biến thể nối được → loai_ma đúng · nguon_chu_de=sp_id', a && a.loai_ma === bt.loai_ma && a.nguon_chu_de === 'sp_id', JSON.stringify(a)+' kỳ vọng '+bt.loai_ma)

// 4. món biến thể chưa có dong_loai → CÒN dòng, loai_ma NULL, nguon NULL
const d = byTen('món không nối')
ok('4. món biến thể chưa map dòng → còn dòng · loai_ma NULL · nguon NULL', d && d.loai_ma === null && d.nguon_chu_de === null, JSON.stringify(d))

// 5. món sp_id NULL → còn dòng, loai NULL
const e = byTen('món sp_id NULL')
ok('5. món sp_id NULL → còn dòng · loai_ma NULL', e && e.loai_ma === null, JSON.stringify(e))

// 6. MỖI món ra ĐÚNG 0/1 dòng (không fan-out nhiều loại)
const dup = await one(`select coalesce(max(cnt),0)::int mx from (select mon_id, count(*) cnt from kho.v_mon_chu_de where don_id=$1 group by mon_id) x`, [don.id])
ok('6. mỗi món ≤1 dòng trong view (0/1 loại, không nở nhiều loại)', dup.mx === 1, 'max dòng/món='+dup.mx)

await c.query('rollback')
const con = await one(`select count(*)::int n from kho.don_hang where ma_don='WP76A_T'`)
console.log(`\nrollback xong · đơn test còn lại: ${con.n} (phải 0)`)
console.log(`═══ test_wp76a: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
