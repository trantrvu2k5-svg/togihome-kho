// TEST CẮN — WP-46 (db/168): tien_do_tam trả MẢNG mọi bước sẵn sàng (nhánh song song). Tx rollback, KHÔNG đụng prod.
//   Dùng TU-AO-MELAMINE thật: 100→200→250→{300 thùng ∥ 310 cụp}, 320 ray(truoc 300), 400 canh(300,310), 500 goi(400,320).
//   ⚠ TU-AO THẬT có 320=ray sau 300 (spec L-37 mô tả giản lược bỏ 320) → kỳ vọng tính TỪ buoc_truoc thật, không từ sketch.
//   15.1 sau 250 → {300,310} · 15.2 sau 300 → {310,320}, 400 CHƯA · 15.3 sau 310 → có 400 · 15.4 KE-HO mỗi lần 1
//   15.5 xong → rỗng + xong_mon · 15.6 xoá xep_lich vẫn đủ (QD-69) · 15.7 buoc_ke=phần tử đầu · 15.9 quét trạm cụp → đầu là 310
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
const PPL = (await q(`select nd.id from kho.nguoi_dung nd where nd.auth_uid is not null
    and nd.id not in (select nguoi_id from kho.ca_lam where ket_thuc is null and nguoi_id is not null)
    and nd.id not in (select sq.nguoi_id from kho.su_kien_quet sq where sq.ket_qua='nhan' and sq.nguoi_id is not null
                      group by sq.nguoi_id, sq.tem_ma, sq.ma_tram having count(*) filter (where sq.loai='vao') > count(*) filter (where sq.loai='ra'))
    order by nd.id limit 20`)).map(r => r.id)
const tramOf = async (qt, tt) => (await one(`select tr.ma_tram from kho.quy_trinh_buoc b join kho.tram tr on tr.hoat_dong=b.hoat_dong where b.ma_quy_trinh=$1 and b.thu_tu=$2`, [qt, tt]))?.ma_tram
const buocs = async qt => (await q(`select thu_tu from kho.quy_trinh_buoc where ma_quy_trinh=$1 order by thu_tu`, [qt])).map(r => r.thu_tu)
async function buildMon(qt, tem) {
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach) values('DEMO-WP46-'||$2,'x',true,'le','cho_cat',$1,'gioi_thieu') returning id`, [TH, tem])).id
  const mon = (await one(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh,dung_moi,so_luong) values($1,'món 46',$2,false,1) returning id`, [did, qt])).id
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values((select ma_don from kho.don_hang where id=$1),1,$2,'carcass',$3)`, [did, tem, mon])
  await c.query(`set local session_replication_role='origin'`); return did
}
let kPer = 0
async function openPhien(tram) {
  const nguoi = PPL[kPer++ % PPL.length]
  await c.query(`set local session_replication_role='replica'`)
  await c.query(`update kho.tram set dang_dung=true where ma_tram=$1`, [tram])
  await c.query(`update kho.phien_tram set ket_thuc=now() where ma_tram=$1 and ket_thuc is null`, [tram])
  await c.query(`insert into kho.phien_tram(nguoi_id,ma_tram,bat_dau,nguon) values($1,$2,now(),'chon')`, [nguoi, tram])
  await c.query(`set local session_replication_role='origin'`)
}
async function jwt(fn) {
  await c.query('savepoint j'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: THO, role: 'authenticated' })])
  let r = null, e = null
  try { r = await fn() } catch (x) { e = x.message; try { await c.query('rollback to savepoint j') } catch (_) {} }
  if (!e) await c.query('release savepoint j')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return { r, e }
}
const scan = async (tem, tram, loai) => (await jwt(async () => (await c.query(`select kho.tram_quet($1,$2,0,0,$3) j`, [tem, tram, loai])).rows[0].j)).r
const tdt = async (tem, tram = null) => (await jwt(async () => (await c.query(`select kho.tien_do_tam($1,$2) j`, [tem, tram])).rows[0].j)).r
async function readyManual(qt, doneArr) {
  const done = new Set(doneArr)
  const bs = await q(`select thu_tu, buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh=$1 order by thu_tu`, [qt])
  return bs.filter(b => !done.has(b.thu_tu) && (b.buoc_truoc || []).every(p => done.has(p))).map(b => b.thu_tu)
}
const dsThuTu = td => (td?.buoc_ke_ds || []).map(x => x.thu_tu)
const QT = 'TU-AO-MELAMINE', KE = 'KE-HO-MELAMINE'
const T = {}, TK = {}

await c.query('begin')
const before = { don: (await one(`select count(*)::int n from kho.don_hang`)).n, sq: (await one(`select count(*)::int n from kho.su_kien_quet`)).n }
for (const b of await buocs(QT)) T[b] = await tramOf(QT, b)
for (const b of await buocs(KE)) TK[b] = await tramOf(KE, b)
const vaoRa = async (tem, t, Tmap) => { await openPhien(Tmap[t]); await scan(tem, Tmap[t], 'vao'); return scan(tem, Tmap[t], 'ra') }

// ═══ 15.1 · sau 250 → buoc_ke_ds ĐỦ {300,310} (ca then chốt: trước đây giấu 310) ═══
{ await c.query('savepoint s1'); kPer = 0
  await buildMon(QT, 'A'); for (const t of [100, 200, 250]) await vaoRa('A', t, T)
  const td = await tdt('A'); const ds = dsThuTu(td); const man = await readyManual(QT, [100, 200, 250])
  console.log('   15.1 buoc_ke_ds =', JSON.stringify(td.buoc_ke_ds))
  ok('15.1 sau 250 → buoc_ke_ds có ĐỦ 2 nhánh {300,310} (kèm trường tổ mỗi bước), khớp buoc_truoc',
    JSON.stringify(ds) === JSON.stringify([300, 310]) && JSON.stringify(ds) === JSON.stringify(man) && td.buoc_ke_ds.every(x => 'to' in x), JSON.stringify(ds))
  await c.query('rollback to savepoint s1') }

// ═══ 15.2 · sau 300 (chưa 310) → 400 CHƯA sẵn sàng ; ready = {310,320} thật (320=ray sau 300) ═══
{ await c.query('savepoint s2'); kPer = 0
  await buildMon(QT, 'B'); for (const t of [100, 200, 250, 300]) await vaoRa('B', t, T)
  const td = await tdt('B'); const ds = dsThuTu(td); const man = await readyManual(QT, [100, 200, 250, 300])
  console.log('   15.2 buoc_ke_ds =', JSON.stringify(ds), '· (spec sketch {310}; TU-AO thật thêm 320=ray sau 300)')
  ok('15.2 sau 300 chưa 310 → 400 CHƯA sẵn sàng (điểm gộp cần cả hai); 310 còn ; khớp buoc_truoc {310,320}',
    !ds.includes(400) && ds.includes(310) && JSON.stringify(ds) === JSON.stringify(man), JSON.stringify(ds))
  await c.query('rollback to savepoint s2') }

// ═══ 15.3 · sau 310 → điểm gộp 400 MỞ (ready có 400) ═══
{ await c.query('savepoint s3'); kPer = 0
  await buildMon(QT, 'C'); for (const t of [100, 200, 250, 300, 310]) await vaoRa('C', t, T)
  const td = await tdt('C'); const ds = dsThuTu(td); const man = await readyManual(QT, [100, 200, 250, 300, 310])
  console.log('   15.3 buoc_ke_ds =', JSON.stringify(ds))
  ok('15.3 sau 300+310 → điểm gộp 400 sẵn sàng (khớp buoc_truoc)', ds.includes(400) && JSON.stringify(ds) === JSON.stringify(man), JSON.stringify(ds))
  await c.query('rollback to savepoint s3') }

// ═══ 15.4 · KE-HO thẳng: mỗi lần chỉ 1 phần tử, không nhân bản, không rỗng oan ═══
{ await c.query('savepoint s4'); kPer = 0
  await buildMon(KE, 'D'); const bs = await buocs(KE)
  const dem = []
  for (let i = 0; i < bs.length; i++) {
    const td = await tdt('D'); dem.push(dsThuTu(td).length)
    await vaoRa('D', bs[i], TK)
  }
  console.log('   15.4 số phần tử buoc_ke_ds qua từng bước:', JSON.stringify(dem))
  ok('15.4 KE-HO thẳng: mỗi bước buoc_ke_ds đúng 1 phần tử (không nhân bản, không rỗng oan)', dem.every(n => n === 1), JSON.stringify(dem))
  await c.query('rollback to savepoint s4') }

// ═══ 15.5 · bước cuối xong → mảng rỗng + xong_mon=true ═══
{ await c.query('savepoint s5'); kPer = 0
  await buildMon(KE, 'E'); for (const t of await buocs(KE)) await vaoRa('E', t, TK)
  const td = await tdt('E')
  console.log('   15.5 buoc_ke_ds =', JSON.stringify(td.buoc_ke_ds), '· xong_mon =', td.xong_mon)
  ok('15.5 mọi bước ra → buoc_ke_ds rỗng + xong_mon=true', dsThuTu(td).length === 0 && td.xong_mon === true, JSON.stringify(td.buoc_ke_ds))
  await c.query('rollback to savepoint s5') }

// ═══ 15.6 · xoá sạch xep_lich của đơn → buoc_ke_ds VẪN đủ như 15.1 (đồ thị thuần, QD-69) ═══
{ await c.query('savepoint s6'); kPer = 0
  const did = await buildMon(QT, 'F'); for (const t of [100, 200, 250]) await vaoRa('F', t, T)
  await c.query(`set local session_replication_role='replica'`)
  await c.query(`delete from kho.xep_lich where ma_don=(select ma_don from kho.don_hang where id=$1)`, [did])
  await c.query(`set local session_replication_role='origin'`)
  const ds = dsThuTu(await tdt('F'))
  console.log('   15.6 sau xoá xep_lich, buoc_ke_ds =', JSON.stringify(ds))
  ok('15.6 xoá xep_lich → buoc_ke_ds vẫn {300,310} (bước kế thuần đồ thị, không phụ thuộc lịch)', JSON.stringify(ds) === JSON.stringify([300, 310]), JSON.stringify(ds))
  await c.query('rollback to savepoint s6') }

// ═══ 15.7 · trường cũ buoc_ke (buoc_ke_tiep) trỏ đúng phần tử đầu mảng ═══
{ await c.query('savepoint s7'); kPer = 0
  await buildMon(QT, 'G'); for (const t of [100, 200, 250]) await vaoRa('G', t, T)
  const td = await tdt('G')
  console.log('   15.7 buoc_ke_tiep =', td.buoc_ke_tiep, '· ds[0] =', dsThuTu(td)[0])
  ok('15.7 buoc_ke_tiep (trường cũ) = phần tử đầu mảng đã sắp (UI L-33 không chết)', td.buoc_ke_tiep === dsThuTu(td)[0], JSON.stringify(td.buoc_ke_tiep))
  await c.query('rollback to savepoint s7') }

// ═══ 15.9 · quét ở trạm nhánh CỤP sau 250 → phần tử đầu = 310 (cua_tram_nay), không phải 300 ═══
{ await c.query('savepoint s9'); kPer = 0
  await buildMon(QT, 'H'); for (const t of [100, 200, 250]) await vaoRa('H', t, T)
  await openPhien(T[310])                                  // mở phiên trạm cụp
  const r = await scan('H', T[310], 'vao')                 // quét ở trạm cụp
  const ds = ((r && r.buoc_ke_ds) || []).map(x => x.thu_tu)
  console.log('   15.9 quét trạm cụp → buoc_ke_ds =', JSON.stringify(ds), '· đầu cua_tram_nay =', r?.buoc_ke_ds?.[0]?.cua_tram_nay)
  ok('15.9 quét ở trạm nhánh cụp → phần tử ĐẦU buoc_ke_ds = 310 (bước của trạm đó), không phải 300', ds[0] === 310 && ds.includes(300), JSON.stringify(ds))
  await c.query('rollback to savepoint s9') }

await c.query('rollback')
const after = { don: (await one(`select count(*)::int n from kho.don_hang`)).n, sq: (await one(`select count(*)::int n from kho.su_kien_quet`)).n }
ok(`prod nguyên (don ${after.don} · su_kien_quet ${after.sq})`, after.don === before.don && after.sq === before.sq, JSON.stringify({ before, after }))
await c.end()

// ═══ 15.8 · HỒI QUY bảy bộ ═══
console.log('\n── 15.8 · hồi quy bảy bộ (46a · 43 · 44 · 45 · 47 · 074 · 077) + bộ này ──')
let sumP = P, sumF = F
console.log(`   test_wp46 (bộ này): ${P} pass / ${F} fail`)
const WEB = dirname(OPS)
const parse = out => { const m = out.match(/(\d+)\s*pass\s*[\/·]\s*(\d+)\s*fail/i) || out.match(/(\d+)\s*PASS[^\d]+(\d+)\s*FAIL/i); return m ? [+m[1], +m[2]] : [0, 999] }
// test_wp46a chạy năm bộ + tự in TỔNG; 074/077 riêng
for (const f of ['test_wp46a.mjs', 'test_074.mjs', 'test_077.mjs']) {
  let out = ''
  try { out = execFileSync('node', [join('ops', f)], { encoding: 'utf8', cwd: WEB, maxBuffer: 10 * 1024 * 1024 }) }
  catch (e) { out = (e.stdout || '') + (e.stderr || '') }
  if (f === 'test_wp46a.mjs') {
    const m = out.match(/TỔNG năm bộ:\s*(\d+)\s*pass\s*\/\s*(\d+)\s*fail/i)
    const [p, fl] = m ? [+m[1], +m[2]] : [0, 999]; sumP += p; sumF += fl
    console.log(`   năm bộ (46a+43+44+45+47): ${m ? p + ' pass / ' + fl + ' fail' : '⚠ KHÔNG ĐỌC ĐƯỢC'}`)
  } else {
    const [p, fl] = parse(out); sumP += p; sumF += fl
    console.log(`   ${f}: ${p} pass / ${fl} fail`)
  }
}
console.log(`\n═══ TỔNG bảy bộ + WP-46: ${sumP} pass / ${sumF} fail ═══`)
process.exit(sumF ? 1 : 0)
