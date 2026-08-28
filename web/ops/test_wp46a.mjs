// TEST CẮN — WP-46a (db/165): HAI NÚT. loai do NGƯỜI khai, bỏ đoán chẵn/lẻ. Tx rollback, KHÔNG đụng prod.
//   13.1 vào→ra: 1 bước xong, so_buoc_xong 0→1, so_phut có số · 13.2 vào×2 → RAISE "đang giữ việc này rồi"
//   13.3 ra khi chưa vào → RAISE "chưa nhận việc" · 13.4 sq_ghi thiếu/loạn loai → RAISE
//   13.5 tiền-đề: vào bước 2 khi bước 1 chưa ra → NHAY_BUOC như cũ · 13.6 giữ trạm A rồi vào trạm B → CHO PHÉP + cảnh báo
//   13.7 viec_dang_giu: giữ 1 → 1 dòng + giờ; sau ra → biến mất · 13.8 5 bước trọn vòng → 5/5 xong món
//   L-34 (phiên thợ): 14.1 chưa phiên→RAISE · 14.2 A mở phiên→ghi A · 14.3 B tiếp quản→ghi B không A (lỗi 313h)
//   14.4 phiên hôm qua→RAISE · 14.5 viec_dang_giu không nhầm người · 14.6 hai trạm hai thợ đúng người
//   13.9 hồi quy wp43·wp44·wp45·wp47 + bộ này (năm bộ)
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'; import { dirname, join } from 'path'
const OPS = dirname(fileURLToPath(import.meta.url))
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]

const THO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro in ('tho','xuong','ceo') and auth_uid is not null and dang_hoat_dong order by vai_tro limit 1`)).a
const TH = (await one(`select ma from kho.thuong_hieu limit 1`)).ma
// người quét SẠCH: có auth, không đang mở ca, KHÔNG đang giữ vao nào (để viec_dang_giu/cảnh báo không dính việc prod thật)
const PPL = (await q(`select nd.id from kho.nguoi_dung nd where nd.auth_uid is not null
    and nd.id not in (select nguoi_id from kho.ca_lam where ket_thuc is null and nguoi_id is not null)
    and nd.id not in (select sq.nguoi_id from kho.su_kien_quet sq where sq.ket_qua='nhan' and sq.nguoi_id is not null
                      group by sq.nguoi_id, sq.tem_ma, sq.ma_tram
                      having count(*) filter (where sq.loai='vao') > count(*) filter (where sq.loai='ra'))
    order by nd.id limit 20`)).map(r => r.id)

// quét qua tram_quet (đường web thật, có gác vai) — trả {j,e}; RAISE → e có nội dung, savepoint cuộn lại
async function scan(tem, tram, loai) {
  await c.query('savepoint sc'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: THO, role: 'authenticated' })])
  let j = null, e = null
  try { j = (await c.query(`select kho.tram_quet($1,$2,0,0,$3) j`, [tem, tram, loai])).rows[0].j }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint sc') } catch (_) {} }
  if (!e) await c.query('release savepoint sc')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return { j, e }
}
const tramOf = async (qt, tt) => (await one(`select tr.ma_tram from kho.quy_trinh_buoc b join kho.tram tr on tr.hoat_dong=b.hoat_dong where b.ma_quy_trinh=$1 and b.thu_tu=$2`, [qt, tt]))?.ma_tram
const buocs = async qt => (await q(`select thu_tu from kho.quy_trinh_buoc where ma_quy_trinh=$1 order by thu_tu`, [qt])).map(r => r.thu_tu)
async function buildMon(qt, tem) {   // đơn + món + tem, KHÔNG mở ca (test tự mở để kiểm soát người)
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach) values('DEMO-WP46A-'||$2,'x',true,'le','cho_cat',$1,'gioi_thieu') returning id`, [TH, tem])).id
  const mon = (await one(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh,dung_moi,so_luong) values($1,'món 46a',$2,false,1) returning id`, [did, qt])).id
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values((select ma_don from kho.don_hang where id=$1),1,$2,'carcass',$3)`, [did, tem, mon])
  await c.query(`set local session_replication_role='origin'`)
}
let kPer = 0
// WP-46a L-34: nguồn "ai làm" nay là PHIÊN THỢ (không ca_lam). Helper mở phiên hôm nay tại trạm.
async function openPhien(tram, P_ = null) {
  const nguoi = P_ || PPL[kPer++]
  await c.query(`set local session_replication_role='replica'`)
  await c.query(`update kho.tram set dang_dung=true where ma_tram=$1`, [tram])
  await c.query(`update kho.phien_tram set ket_thuc=now() where ma_tram=$1 and ket_thuc is null`, [tram])
  await c.query(`insert into kho.phien_tram(nguoi_id,ma_tram,bat_dau,nguon) values($1,$2,now(),'chon')`, [nguoi, tram])
  await c.query(`set local session_replication_role='origin'`)
  return nguoi
}
const tdt = async tem => await one(`select so_buoc_xong, tong_so_buoc, trang_thai from kho.tien_do_tem where tem_ma=$1`, [tem])
const QT = 'KE-HO-MELAMINE'   // 5 bước thẳng: 100,200,250,300,400
const T = {}   // trạm theo bước, nạp sau

await c.query('begin')
const before = { don: (await one(`select count(*)::int n from kho.don_hang`)).n, sq: (await one(`select count(*)::int n from kho.su_kien_quet`)).n, td: (await one(`select count(*)::int n from kho.tien_do_tem`)).n }
for (const b of await buocs(QT)) T[b] = await tramOf(QT, b)

// ═══ 13.1 · vào→ra ở 1 trạm: 1 bước xong, so_buoc_xong 0→1, so_phut có số ═══
{ await c.query('savepoint t1'); kPer = 0
  await buildMon(QT, 'A'); await openPhien(T[100])
  const rV = await scan('A', T[100], 'vao'); const xdVao = (await tdt('A'))?.so_buoc_xong
  const rR = await scan('A', T[100], 'ra'); const xdRa = (await tdt('A'))?.so_buoc_xong
  const sp = (await one(`select so_phut from kho.su_kien_quet where tem_ma='A' and ma_tram=$1 and loai='ra'`, [T[100]]))?.so_phut
  console.log(`   13.1 vào ok=${rV.j?.ok} ra ok=${rR.j?.ok} · so_buoc_xong ${xdVao}→${xdRa} · so_phut=${sp}`)
  ok('13.1 vào→ra: 1 bước xong, so_buoc_xong nhích 0→1, so_phut có số',
    rV.j?.ok === true && rR.j?.ok === true && Number(xdVao) === 0 && Number(xdRa) === 1 && sp != null, rV.e || rR.e)
  await c.query('rollback to savepoint t1') }

// ═══ 13.2 · vào hai lần liên tiếp cùng trạm → RAISE "đang giữ việc này rồi" (vế then chốt) ═══
{ await c.query('savepoint t2'); kPer = 0
  await buildMon(QT, 'B'); await openPhien(T[100])
  const r1 = await scan('B', T[100], 'vao'); const r2 = await scan('B', T[100], 'vao')
  console.log(`   13.2 lần1 ok=${r1.j?.ok} · lần2 e=${(r2.e || '').slice(0, 60)}`)
  ok('13.2 vào×2 cùng trạm → RAISE "đang giữ việc này rồi" (không âm thầm thành ra)',
    r1.j?.ok === true && !!r2.e && /đang giữ việc này rồi/.test(r2.e), r2.e || 'không RAISE')
  await c.query('rollback to savepoint t2') }

// ═══ 13.3 · ra khi chưa vào → RAISE "chưa nhận việc" ═══
{ await c.query('savepoint t3'); kPer = 0
  await buildMon(QT, 'C'); await openPhien(T[100])
  const r = await scan('C', T[100], 'ra')
  console.log(`   13.3 ra-chưa-vào e=${(r.e || '').slice(0, 60)}`)
  ok('13.3 ra khi chưa vào → RAISE "chưa nhận việc"', !!r.e && /chưa nhận việc/.test(r.e), r.e || 'không RAISE')
  await c.query('rollback to savepoint t3') }

// ═══ 13.4 · sq_ghi thiếu/loạn loai → RAISE (gọi thẳng sq_ghi, chủ sở hữu) ═══
{ await c.query('savepoint t4')
  let eNull = null, eLa = null
  try { await c.query(`select kho.sq_ghi('Z','Z',null,'quet',null,null,0,0)`) } catch (x) { eNull = x.message; await c.query('rollback to savepoint t4') }
  await c.query('savepoint t4b')
  try { await c.query(`select kho.sq_ghi('Z','Z','xyz','quet',null,null,0,0)`) } catch (x) { eLa = x.message; await c.query('rollback to savepoint t4b') }
  console.log(`   13.4 null→${(eNull || '').slice(0, 50)} · 'xyz'→${(eLa || '').slice(0, 50)}`)
  ok('13.4 sq_ghi loai=null hoặc lạ → RAISE (không đoán hộ)',
    !!eNull && /loai phải/.test(eNull) && !!eLa && /loai phải/.test(eLa), eNull + ' | ' + eLa)
  await c.query('rollback to savepoint t4') }

// ═══ 13.5 · tiền-đề (QD-01) GIỮ NGUYÊN: vào bước 2 khi bước 1 chưa ra → NHAY_BUOC ═══
{ await c.query('savepoint t5'); kPer = 0
  await buildMon(QT, 'D'); await openPhien(T[200])
  const r = await scan('D', T[200], 'vao')
  console.log(`   13.5 vào bước2 ok=${r.j?.ok} loi=${r.j?.loi}`)
  ok('13.5 tiền-đề không hồi quy: vào bước 2 khi bước 1 chưa ra → chặn NHAY_BUOC (graceful)',
    r.j?.ok === false && r.j?.loi === 'NHAY_BUOC', JSON.stringify(r.j))
  await c.query('rollback to savepoint t5') }

// ═══ 13.6 · giữ việc trạm A rồi vào món khác cùng người → CHO PHÉP + cảnh báo (QD-69) ═══
{ await c.query('savepoint t6'); kPer = 0
  await buildMon(QT, 'E'); await buildMon(QT, 'E2')
  const Pnguoi = await openPhien(T[100])   // MỘT người giữ ca ở trạm bước-1
  const rY = await scan('E', T[100], 'vao')     // giữ việc E (chưa ra)
  const rX = await scan('E2', T[100], 'vao')    // vào việc E2 cùng người, cùng trạm — món khác
  console.log(`   13.6 giữ E ok=${rY.j?.ok} · vào E2 ok=${rX.j?.ok} canh_bao=${JSON.stringify(rX.j?.canh_bao)}`)
  ok('13.6 đang giữ việc khác → vào việc mới VẪN CHO PHÉP + có cảnh báo trong jsonb (không chặn)',
    rY.j?.ok === true && rX.j?.ok === true && rX.j?.canh_bao != null && /giữ/.test(String(rX.j.canh_bao)), JSON.stringify(rX.j))
  await c.query('rollback to savepoint t6') }

// ═══ 13.7 · viec_dang_giu: giữ 1 → 1 dòng + giờ; sau ra → biến mất ═══
{ await c.query('savepoint t7'); kPer = 0
  await buildMon(QT, 'G'); const Pg = await openPhien(T[100])
  await scan('G', T[100], 'vao')
  const giu = await q(`select tem, tram, giu_gio from kho.viec_dang_giu($1)`, [Pg])
  await scan('G', T[100], 'ra')
  const sau = await q(`select tem from kho.viec_dang_giu($1)`, [Pg])
  console.log(`   13.7 đang giữ=${giu.length} (tem=${giu[0]?.tem} giờ=${giu[0]?.giu_gio}) · sau ra=${sau.length}`)
  ok('13.7 viec_dang_giu: giữ 1 → đúng 1 dòng + có số giờ; sau ra → 0 dòng',
    giu.length === 1 && giu[0].tem === 'G' && giu[0].giu_gio != null && sau.length === 0, JSON.stringify(giu))
  await c.query('rollback to savepoint t7') }

// ═══ 13.8 · món thẳng 5 bước trọn vòng vào/ra → 5/5, bước cuối báo xong món ═══
{ await c.query('savepoint t8'); kPer = 0
  await buildMon(QT, 'H'); for (const b of await buocs(QT)) await openPhien(T[b])
  let last = null
  for (const b of await buocs(QT)) { await scan('H', T[b], 'vao'); last = await scan('H', T[b], 'ra') }
  const td = await tdt('H')
  console.log(`   13.8 tien_do_tem: ${td?.so_buoc_xong}/${td?.tong_so_buoc} · ${td?.trang_thai} · last.xong=${JSON.stringify(last.j?.xong)}`)
  ok('13.8 5 bước trọn vòng: so_buoc_xong=5/5, trang_thai=xong_het (bước cuối báo xong món)',
    Number(td?.so_buoc_xong) === 5 && Number(td?.tong_so_buoc) === 5 && td?.trang_thai === 'xong_het', JSON.stringify(td))
  await c.query('rollback to savepoint t8') }

// ══════════ L-34 · PHIÊN THỢ thay ca làm nguồn "ai làm" ══════════
async function moPhien(nguoiId, tram) {   // gọi mo_phien qua jwt (tram_gac_vai)
  await c.query('savepoint mp'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: THO, role: 'authenticated' })])
  let j = null, e = null
  try { j = (await c.query(`select kho.mo_phien($1,$2) j`, [nguoiId, tram])).rows[0].j } catch (x) { e = x.message; try { await c.query('rollback to savepoint mp') } catch (_) {} }
  if (!e) await c.query('release savepoint mp')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return { j, e }
}
const nguoiCua = async (tem, tram, loai = 'vao') => (await one(`select nguoi_id from kho.su_kien_quet where tem_ma=$1 and ma_tram=$2 and loai=$3 and ket_qua='nhan' order by luc desc limit 1`, [tem, tram, loai]))?.nguoi_id
const bat = async tram => { await c.query(`set local session_replication_role='replica'`); await c.query(`update kho.tram set dang_dung=true where ma_tram=$1`, [tram]); await c.query(`set local session_replication_role='origin'`) }

// ═══ 14.1 · chưa có phiên → quét → RAISE "chưa có thợ nhận trạm" ═══
{ await c.query('savepoint u1')
  await buildMon(QT, 'U1'); await bat(T[100])   // trạm bật NHƯNG không mở phiên
  const r = await scan('U1', T[100], 'vao')
  console.log(`   14.1 e=${(r.e || '').slice(0, 60)}`)
  ok('14.1 chưa có phiên → RAISE "chưa có thợ nhận trạm"', !!r.e && /chưa có thợ nhận trạm/.test(r.e), r.e || JSON.stringify(r.j))
  await c.query('rollback to savepoint u1') }

// ═══ 14.2 · thợ A mở phiên → quét vào/ra → su_kien_quet.nguoi_id = A ═══
{ await c.query('savepoint u2')
  const A = PPL[0]; await buildMon(QT, 'U2'); await bat(T[100])
  const mp = await moPhien(A, T[100])
  await scan('U2', T[100], 'vao'); await scan('U2', T[100], 'ra')
  const who = await nguoiCua('U2', T[100], 'ra')
  console.log(`   14.2 mo_phien nhận=${mp.j?.nguoi_nhan} · su_kien_quet.nguoi_id = A? ${who === A}`)
  ok('14.2 A mở phiên → quét ghi nguoi_id = A', mp.j?.nguoi_nhan_id === A && who === A, mp.e || who)
  await c.query('rollback to savepoint u2') }

// ═══ 14.3 · thợ B tiếp quản CHÍNH trạm → phiên A tự đóng, ghi cho B (không A) ═══ (vế then chốt — lỗi 313 giờ)
{ await c.query('savepoint u3')
  const A = PPL[0], B = PPL[1]; await buildMon(QT, 'U3A'); await buildMon(QT, 'U3B'); await bat(T[100])
  await moPhien(A, T[100]); await scan('U3A', T[100], 'vao')   // A nhận việc U3A
  const mp = await moPhien(B, T[100])                          // B tiếp quản
  await scan('U3B', T[100], 'vao')                             // quét tiếp → phải cho B
  const whoB = await nguoiCua('U3B', T[100], 'vao')
  const conMoA = (await one(`select count(*)::int n from kho.phien_tram where ma_tram=$1 and nguoi_id=$2 and ket_thuc is null`, [T[100], A])).n
  console.log(`   14.3 mo_phien nhường=${mp.j?.nguoi_nhuong} nhận=${mp.j?.nguoi_nhan} · U3B ghi cho B? ${whoB === B} · phiên A còn mở? ${conMoA}`)
  ok('14.3 B tiếp quản → phiên A tự đóng, quét tiếp ghi cho B KHÔNG A',
    mp.j?.nguoi_nhuong_id === A && mp.j?.nguoi_nhan_id === B && whoB === B && conMoA === 0, JSON.stringify(mp.j))
  await c.query('rollback to savepoint u3') }

// ═══ 14.4 · phiên mở HÔM QUA → quét → RAISE (phiên không kéo qua ngày) ═══
{ await c.query('savepoint u4')
  const A = PPL[0]; await buildMon(QT, 'U4'); await bat(T[100])
  await c.query(`set local session_replication_role='replica'`)
  await c.query(`insert into kho.phien_tram(nguoi_id,ma_tram,bat_dau,nguon) values($1,$2,now()-interval '1 day','chon')`, [A, T[100]])
  await c.query(`set local session_replication_role='origin'`)
  const r = await scan('U4', T[100], 'vao')
  console.log(`   14.4 phiên hôm qua → e=${(r.e || '').slice(0, 50)}`)
  ok('14.4 phiên mở hôm qua → RAISE "chưa có thợ nhận trạm" (không kéo qua ngày)', !!r.e && /chưa có thợ nhận trạm/.test(r.e), r.e || JSON.stringify(r.j))
  await c.query('rollback to savepoint u4') }

// ═══ 14.5 · viec_dang_giu: A giữ đúng việc mình; B tiếp quản không nhầm sang B ═══
{ await c.query('savepoint u5')
  const A = PPL[0], B = PPL[1]; await buildMon(QT, 'U5A'); await buildMon(QT, 'U5B'); await bat(T[100])
  await moPhien(A, T[100]); await scan('U5A', T[100], 'vao')            // A giữ U5A
  const giuA1 = await q(`select tem from kho.viec_dang_giu($1)`, [A])
  await moPhien(B, T[100]); await scan('U5B', T[100], 'vao')            // B giữ U5B
  const giuA2 = (await q(`select tem from kho.viec_dang_giu($1)`, [A])).map(r => r.tem)
  const giuB = (await q(`select tem from kho.viec_dang_giu($1)`, [B])).map(r => r.tem)
  console.log(`   14.5 A giữ=${JSON.stringify(giuA2)} · B giữ=${JSON.stringify(giuB)}`)
  ok('14.5 viec_dang_giu tra theo su_kien_quet.nguoi_id: A thấy U5A không thấy U5B; B thấy U5B',
    giuA1.length === 1 && giuA1[0].tem === 'U5A' && giuA2.includes('U5A') && !giuA2.includes('U5B') && giuB.includes('U5B') && !giuB.includes('U5A'), JSON.stringify({ giuA2, giuB }))
  await c.query('rollback to savepoint u5') }

// ═══ 14.6 · hai trạm hai thợ, quét đan xen → mỗi sự kiện đúng người ═══
{ await c.query('savepoint u6')
  const A = PPL[0], B = PPL[1]; await buildMon(QT, 'U6M'); await buildMon(QT, 'U6N'); await bat(T[100]); await bat(T[200])
  await moPhien(A, T[100]); await moPhien(B, T[200])
  await scan('U6M', T[100], 'vao'); await scan('U6M', T[100], 'ra')   // A (bước1)
  await scan('U6N', T[100], 'vao')                                     // A (đan xen)
  await scan('U6M', T[200], 'vao')                                     // B (bước2, đã qua bước1)
  const mT100 = await nguoiCua('U6M', T[100], 'vao'), mT200 = await nguoiCua('U6M', T[200], 'vao'), nT100 = await nguoiCua('U6N', T[100], 'vao')
  console.log(`   14.6 U6M@T100=A?${mT100 === A} U6M@T200=B?${mT200 === B} U6N@T100=A?${nT100 === A}`)
  ok('14.6 hai trạm hai thợ đan xen → mỗi sự kiện gán đúng người', mT100 === A && mT200 === B && nT100 === A, JSON.stringify({ mT100, mT200, nT100, A, B }))
  await c.query('rollback to savepoint u6') }

// prod nguyên?
await c.query('rollback')
const after = { don: (await one(`select count(*)::int n from kho.don_hang`)).n, sq: (await one(`select count(*)::int n from kho.su_kien_quet`)).n, td: (await one(`select count(*)::int n from kho.tien_do_tem`)).n }
ok(`prod nguyên (don ${after.don} · su_kien_quet ${after.sq} · tien_do_tem ${after.td})`,
  after.don === before.don && after.sq === before.sq && after.td === before.td, JSON.stringify({ before, after }))
await c.end()

// ═══ 13.9 · HỒI QUY năm bộ (wp43·wp44·wp45·wp47 + wp46a) ═══
console.log('\n── 13.9 · hồi quy năm bộ ──')
let sumP = P, sumF = F
console.log(`   test_wp46a (bộ này): ${P} pass / ${F} fail`)
const WEB = dirname(OPS)   // test_wp47 đọc ./.env, ./ops/.env.robot → chạy từ web/
for (const f of ['test_wp43.mjs', 'test_wp44.mjs', 'test_wp45.mjs', 'test_wp47.mjs']) {
  let out = ''
  try { out = execFileSync('node', [join('ops', f)], { encoding: 'utf8', cwd: WEB }) }
  catch (e) { out = (e.stdout || '') + (e.stderr || '') }
  const m = out.match(/(\d+)\s*pass\s*\/\s*(\d+)\s*fail/i) || out.match(/(\d+)\s*PASS[^\d]+(\d+)\s*FAIL/i)
  const p = m ? +m[1] : 0, fl = m ? +m[2] : 999
  sumP += p; sumF += fl
  console.log(`   ${f}: ${m ? p + ' pass / ' + fl + ' fail' : '⚠ KHÔNG ĐỌC ĐƯỢC KẾT QUẢ'}`)
}
console.log(`\n═══ TỔNG năm bộ: ${sumP} pass / ${sumF} fail ═══`)
process.exit(sumF ? 1 : 0)
