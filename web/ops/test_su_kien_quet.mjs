// TEST — WP-78 L-05f · su_kien_quet có răng: chặn UPDATE/DELETE · INSERT được · xoa_demo KHÔNG gãy + để LẠI log · 0 tác động.
//   Tất cả trong tx → ROLLBACK (không để lại demo/đơn).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 170) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
async function thu(sql, a = []) { await c.query('savepoint sp'); try { const r = await c.query(sql, a); return { ok: true, rows: r.rows } } catch (e) { await c.query('rollback to savepoint sp'); return { ok: false, err: e.message } } }
async function asU(U, sql, a = []) {
  await c.query('savepoint sp')
  try { await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U, role: 'authenticated' })])
    const r = await c.query(sql, a); await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`); return { ok: true, rows: r.rows }
  } catch (e) { await c.query('rollback to savepoint sp'); return { ok: false, err: e.message } }
}

const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'   // auth_uid ceo
const AUTH = 'fce494fe-e197-40ed-b212-9344cb0d3805'  // auth_uid vai thường (xuong/tho)
const TEM = 'SQ-L05F-TEM', TRAM = 'TRAM-DAN-01', MA = 'DEMO-L05F'

await c.query('begin')
// dựng: đơn demo + tem_ban_ve + tien_do_tem + su_kien_quet (khuôn "cũ xoa_demo sẽ xoá su_kien_quet qua tien_do_tem")
const ns = (await one(`select id from kho.nguoi_dung where auth_uid=$1`, [CEO])).id
await c.query(`insert into kho.don_hang(id,ma_don,sdt_khach,trang_thai,nguoi_tao,la_demo) values(gen_random_uuid(),$1,'0900000000','bao_gia',$2,true)`, [MA, ns])
await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,canh_dan,ghi_luc) values($1,1,$2,'{}',now())`, [MA, TEM])
await c.query(`insert into kho.tien_do_tem(tem_ma,ma_don,trang_thai,cap_nhat_luc) values($1,$2,'dang_lam',now())`, [TEM, MA])
const sk1 = (await one(`insert into kho.su_kien_quet(tem_ma,ma_tram,loai,ket_qua,nguon,so_hong,so_lam_lai) values($1,$2,'vao','nhan','quet',0,0) returning id`, [TEM, TRAM])).id

// ── D1. DELETE su_kien_quet bằng OWNER → TỪ CHỐI (trigger cứng) ──
const d1 = await thu(`delete from kho.su_kien_quet where id=$1`, [sk1])
ok('D1. DELETE su_kien_quet (owner) → TỪ CHỐI (trigger)', !d1.ok && /append-only|CẤM/i.test(d1.err), d1.ok ? '(xoá được — LỖI)' : d1.err)
// ── D2. UPDATE su_kien_quet bằng OWNER → TỪ CHỐI ──
const d2 = await thu(`update kho.su_kien_quet set ket_qua='chan' where id=$1`, [sk1])
ok('D2. UPDATE su_kien_quet (owner) → TỪ CHỐI (trigger)', !d2.ok && /append-only|CẤM/i.test(d2.err), d2.ok ? '(sửa được — LỖI)' : d2.err)
// ── D3. DELETE bằng vai THƯỜNG → TỪ CHỐI ──
const d3 = await asU(AUTH, `delete from kho.su_kien_quet where id=$1`, [sk1])
ok('D3. DELETE su_kien_quet (vai thường) → TỪ CHỐI', !d3.ok, d3.ok ? '(xoá được — LỖI)' : d3.err.slice(0, 80))
// ── D4. INSERT quét mới → VẪN ĐƯỢC (append-only chỉ chặn sửa/xoá) ──
const d4 = await thu(`insert into kho.su_kien_quet(tem_ma,ma_tram,loai,ket_qua,nguon,so_hong,so_lam_lai) values($1,$2,'ra','nhan','quet',0,0) returning id`, [TEM, TRAM])
ok('D4. INSERT quét mới → VẪN GHI ĐƯỢC', d4.ok && d4.rows[0].id, d4.ok ? '' : d4.err)

// ── D5. xoa_demo trọn vòng KHÔNG gãy + su_kien_quet Ở LẠI · đơn/tien_do_tem MẤT ──
const before = (await one(`select count(*)::int n from kho.su_kien_quet where tem_ma=$1`, [TEM])).n
const xd = await asU(CEO, `select kho.xoa_demo($1) j`, [MA])
const skSau = (await one(`select count(*)::int n from kho.su_kien_quet where tem_ma=$1`, [TEM])).n
const donSau = (await one(`select count(*)::int n from kho.don_hang where ma_don=$1`, [MA])).n
const tdSau = (await one(`select count(*)::int n from kho.tien_do_tem where tem_ma=$1`, [TEM])).n
ok('D5. xoa_demo chạy KHÔNG gãy · su_kien_quet GIỮ (' + before + '→' + skSau + ') · đơn+tien_do_tem MẤT',
  xd.ok && xd.rows[0].j.ok === true && xd.rows[0].j.xoa.su_kien_quet === 'giu_lai_log_tho' && skSau === before && skSau >= 2 && donSau === 0 && tdSau === 0,
  JSON.stringify({ xd: xd.ok ? xd.rows[0].j.xoa : xd.err, before, skSau, donSau, tdSau }))

// ── D6. 0 TÁC ĐỘNG: sau xoa_demo, tem là MỒ CÔI → dung_lai_tien_do BỎ QUA (filter đơn-sống = false) ──
const conDon = (await one(`select exists(select 1 from kho.tem_ban_ve tbv join kho.don_hang dh on dh.ma_don=tbv.ma_don where tbv.ma_tam=$1) e`, [TEM])).e
ok('D6. 0 tác động: tem quét demo MỒ CÔI (không đơn sống) → dung_lai_tien_do bỏ qua', conDon === false, 'exists(đơn sống)=' + conDon)
// và không RPC tài chính/năng-suất nào đọc trần: giá vốn=giao_dich (không nối), năng-suất per-tem live
const giaVon = (await one(`select count(*)::int n from information_schema.routines r
  where r.routine_schema='kho' and r.routine_definition ilike '%su_kien_quet%' and (r.routine_name ilike '%gia_von%' or r.routine_name ilike '%tinh_lai%')`)).n
ok('D6b. KHÔNG hàm giá vốn nào đọc su_kien_quet (giá vốn = giao_dich)', giaVon === 0, 'hàm giá vốn đọc su_kien_quet=' + giaVon)

await c.query('rollback')
console.log(`\n═══ test_su_kien_quet: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
