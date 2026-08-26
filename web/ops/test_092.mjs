// TEST CẮN — 092 · form "Báo giá mới" v5 (L-53): 3 cột mới + đường ghi (RLS) + không lộ vốn + sđt trùng. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
try {
  await c.query('begin')

  // ═══ 1 · 3 cột mới tồn tại đúng kiểu ═══
  console.log('── 1 · cột db/092 ──')
  const col = Object.fromEntries((await q(`select column_name,data_type,column_default from information_schema.columns
    where table_schema='kho' and table_name='don_hang' and column_name in ('phong_cach','ngan_sach_trieu','tu_dung')`)).map(r => [r.column_name, r]))
  ok('#1 phong_cach text', col.phong_cach?.data_type === 'text', JSON.stringify(col.phong_cach))
  ok('#1 ngan_sach_trieu numeric', col.ngan_sach_trieu?.data_type === 'numeric')
  ok('#1 tu_dung boolean default false', col.tu_dung?.data_type === 'boolean' && /false/.test(col.tu_dung?.column_default || ''))

  // ═══ 2 · SALE ghi báo giá qua ĐÚNG đường (upsert don_hang, RLS dh_them) — 3 trường mới vào đủ ═══
  console.log('\n── 2 · sale ghi được, đọc lại đúng ──')
  const brand = (await q(`select ma from kho.thuong_hieu limit 1`))[0].ma
  // WP-07: tạo báo giá qua RPC tao_don (server ép bao_gia; client không gửi trang_thai). Đọc lại bằng owner q.
  const ins = await asK(U.sale, `select * from kho.tao_don(jsonb_build_object(
      'ma_don','KIEM092','dong','le','ten_khach','KH kiểm','sdt_khach','0900000092','thuong_hieu',$1::text,'loai','le_sang',
      'phong_cach','tân cổ điển','ngan_sach_trieu',30,'tu_dung',true,'ghi_chu','yêu cầu riêng X','link','http://vd'), false)`, [brand])
  ok('#2 sale tạo đơn báo giá qua tao_don (WP-07)', ins.e === null, ins.e || '')
  const r = (await q(`select phong_cach,ngan_sach_trieu,tu_dung,ghi_chu,link,ngay_tao_bao_gia,trang_thai from kho.don_hang where ma_don='KIEM092'`))[0] || {}
  ok('#2 tao_don ép trang_thai=bao_gia', r.trang_thai === 'bao_gia', r.trang_thai)
  ok('#2 phong_cach/ngan_sach/tu_dung/ghi_chu/link lưu đúng',
    r.phong_cach === 'tân cổ điển' && Number(r.ngan_sach_trieu) === 30 && r.tu_dung === true && r.ghi_chu === 'yêu cầu riêng X' && r.link === 'http://vd', JSON.stringify(r))
  ok('#2 ngay_tao_bao_gia TỰ set (trigger moc_bao_gia) — "ngày hỏi giá" không cần app ghi', r.ngay_tao_bao_gia != null)

  // ═══ 3 · đường ghi chặn vai KHÔNG phải sale ═══
  console.log('\n── 3 · vai NULL/xuong/tho KHÔNG ghi được báo giá ──')
  const chan = uid => asK(uid, `insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('KIEM092X','bao_gia','le','x')`)
  ok('#3 vai NULL → CHẶN', (await chan(U.NULLVAI)).e !== null)
  ok('#3 xuong → CHẶN', (await chan(U.xuong)).e !== null)
  ok('#3 tho → CHẶN', (await chan(U.tho)).e !== null)

  // ═══ 4 · ngân sách âm bị CHECK chặn ═══
  console.log('\n── 4 · ràng buộc số ──')
  const am = await asK(U.sale, `select * from kho.tao_don(jsonb_build_object('ma_don','KIEM092A','dong','le','ten_khach','x','ngan_sach_trieu',-5), false)`)
  ok('#4 ngan_sach_trieu = -5 → CHECK chặn', am.e !== null && /ngan_sach|check/i.test(am.e), am.e || '(không lỗi)')
  const kdIns = await asK(U.sale, `select * from kho.tao_don(jsonb_build_object('ma_don','KIEM092B','dong','le','ten_khach','x'), false)`)
  const kd = kdIns.e ? { r: null } : { r: await q(`select tu_dung from kho.don_hang where ma_don='KIEM092B'`) }
  ok('#4 không truyền tu_dung → mặc định false', kd.r && kd.r[0].tu_dung === false)

  // ═══ 5 · SĐT trùng gắn khách cũ, KHÔNG tạo khách trùng (PK sdt) ═══
  console.log('\n── 5 · sđt trùng không tạo khách trùng ──')
  await q(`insert into kho.khach(sdt,ten,tinh) values('0900000092','Tên cũ','Hà Nội') on conflict (sdt) do nothing`)
  const up = await asK(U.sale, `insert into kho.khach(sdt,ten,tinh) values('0900000092','Tên mới','Bắc Ninh')
    on conflict (sdt) do update set ten=excluded.ten, tinh=excluded.tinh returning sdt`)
  const cnt = (await q(`select count(*)::int n from kho.khach where sdt='0900000092'`))[0].n
  ok('#5 upsert onConflict(sdt) → vẫn 1 khách (PK sdt chặn trùng)', up.e === null && cnt === 1, 'n=' + cnt)

  // ═══ 6 · form KHÔNG lộ giá vốn (don_hang không có cột vốn; giá vốn ở bảng riêng) ═══
  console.log('\n── 6 · không lộ giá vốn ──')
  const gv = (await q(`select column_name from information_schema.columns where table_schema='kho' and table_name='don_hang'
    and (column_name ilike '%gia_von%' or column_name ilike '%khoi_%gia%' or column_name ilike '%chuyen_giao%')`)).map(x => x.column_name)
  ok('#6 don_hang KHÔNG có cột giá vốn → form select(*) không lộ vốn', gv.length === 0, gv.join(','))

  await c.query('rollback')
  console.log('   (đã ROLLBACK KIEM092*)')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_092: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
