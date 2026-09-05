// TEST WP-18b(1) L-19 · day_tem_ban_ve ghi tem_ban_ve.mon_id (db/227, QD-107). tx-rollback.
//   Gán 3 nhánh: nguồn gửi → ghi; 1 món → gán duy nhất; nhiều món không gửi → RAISE.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'      // vai ceo (đẩy tem)
const THO_AUTH = '73bbdefd-10af-4f44-9ab8-d92e029299a2' // vai tho (quét)
const A = '600286f2-2482-4dff-b0a4-a3183740be56'        // ns thợ (người làm)
const KE_SP = 'CAN-A-KE-TIVI-BT'   // SP lõi KE-HO-MELAMINE → buoc_cua_mon = cat,dan,cam,thung,goi
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const cfg = await docConfig(); cfg.statement_timeout = 25000
const c = new pg.Client(cfg); await c.connect()
const vai = u => c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: u, role: 'authenticated' })])
const attempt = async fn => { await c.query('savepoint s'); try { const r = await fn(); return { ok: true, r } } catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: (e.message || '').split('\n')[0] } } }
const monId = async (temMa) => (await c.query("select mon_id::text m from kho.tem_ban_ve where ma_tam=$1 order by phien_ban desc limit 1", [temMa])).rows[0]?.m

// dựng đơn le (bỏ qua cổng khoá cắt) trang_thai cho_cat, N món SP KE-HO. Trả {oid, ma, mons:[id...]}
async function mkDon(ma, soMon) {
  const oid = (await c.query("insert into kho.don_hang(ma_don,ten_khach,trang_thai,dong) values($1,'DEMO tem-mon','cho_cat','le') returning id", [ma])).rows[0].id
  const mons = []
  for (let i = 0; i < soMon; i++) mons.push((await c.query(
    "insert into kho.don_hang_mon(don_id,sp_id,ten,so_luong,gia,dung_moi) values($1,$2,$3,1,1000000,false) returning id",
    [oid, KE_SP, 'Món ' + (i + 1)])).rows[0].id)
  return { oid, ma, mons }
}
const tam = (maTam, monId) => { const t = { ma_tam: maTam, vai_tro: 'day', dai: 1900, rong: 550, day: 18 }; if (monId) t.mon_id = monId; return t }

try {
  await c.query('begin')

  // ── vế 1: nguồn GỬI mon_id (đơn 2 món) → tem ghi ĐÚNG món được chỉ định ──
  await c.query('savepoint s1'); await vai(CEO)
  const d1 = await mkDon('TMI-1', 2)
  const r1 = await attempt(() => c.query("select kho.day_tem_ban_ve('TMI-1',$1::jsonb)", [JSON.stringify([tam('TMI-1#1', d1.mons[1])])]))
  ok('1 nguồn gửi mon_id (đơn 2 món) → tem ghi đúng món chỉ định', r1.ok && (await monId('TMI-1#1')) === d1.mons[1], (r1.msg || '') + ' got=' + await monId('TMI-1#1') + ' mong=' + d1.mons[1])
  await c.query('rollback to savepoint s1')

  // ── vế 2: đơn 1 món, nguồn KHÔNG gửi → gán món duy nhất ──
  await c.query('savepoint s2'); await vai(CEO)
  const d2 = await mkDon('TMI-2', 1)
  const r2 = await attempt(() => c.query("select kho.day_tem_ban_ve('TMI-2',$1::jsonb)", [JSON.stringify([tam('TMI-2#1', null)])]))
  ok('2 đơn 1 món, không gửi → gán món duy nhất', r2.ok && (await monId('TMI-2#1')) === d2.mons[0], (r2.msg || '') + ' got=' + await monId('TMI-2#1'))
  await c.query('rollback to savepoint s2')

  // ── vế 3: đơn NHIỀU món, nguồn KHÔNG gửi → RAISE (KHÔNG im lặng gán món đầu) ──
  await c.query('savepoint s3'); await vai(CEO)
  await mkDon('TMI-3', 2)
  const r3 = await attempt(() => c.query("select kho.day_tem_ban_ve('TMI-3',$1::jsonb)", [JSON.stringify([tam('TMI-3#1', null)])]))
  ok('3 đơn nhiều món, không gửi mon_id → RAISE (nói rõ mấy món + cần gửi gì)',
    !r3.ok && /có 2 món.*phải gửi "mon_id"/.test(r3.msg || ''), r3.msg)
  await c.query('rollback to savepoint s3')

  // ── vế 3b: nguồn gửi mon_id của ĐƠN KHÁC → RAISE (không cho gán chéo đơn) ──
  await c.query('savepoint s3b'); await vai(CEO)
  const dOther = await mkDon('TMI-OTH', 1)
  await mkDon('TMI-3B', 1)
  const r3b = await attempt(() => c.query("select kho.day_tem_ban_ve('TMI-3B',$1::jsonb)", [JSON.stringify([tam('TMI-3B#1', dOther.mons[0])])]))
  ok('3b nguồn gửi mon_id đơn KHÁC → RAISE (không gán chéo đơn)',
    !r3b.ok && /KHÔNG thuộc đơn/.test(r3b.msg || ''), r3b.msg)
  await c.query('rollback to savepoint s3b')

  // ── vế 4: CHUỖI THẬT — quét trạm CÓ trong quy trình đi qua; trạm KHÔNG có vẫn chặn ──
  await c.query('savepoint s4'); await vai(CEO)
  const d4 = await mkDon('TMI-4', 1)
  await attempt(() => c.query("select kho.day_tem_ban_ve('TMI-4',$1::jsonb)", [JSON.stringify([tam('TMI-4#1', null)])]))
  const vm4 = await monId('TMI-4#1')
  // dọn phiên 2 trạm rồi mở phiên thợ A
  await c.query("update kho.phien_tram set ket_thuc=now() where ma_tram=any($1) and ket_thuc is null", [['TRAM-CAT-01', 'TRAM-LOT-01']])
  await vai(THO_AUTH)
  await attempt(() => c.query("select kho.mo_phien($1,'TRAM-CAT-01')", [A]))
  await attempt(() => c.query("select kho.mo_phien($1,'TRAM-LOT-01')", [A]))
  const qCat = await attempt(() => c.query("select kho.tram_quet('TMI-4#1','TRAM-CAT-01',0,0,'vao') g"))
  const gCat = qCat.ok ? qCat.r.rows[0].g : null
  const catSai = gCat && gCat.ket_qua === 'chan' && /không có bước cho trạm/.test(gCat.ly_do_chan || gCat.ly_do || '')
  ok('4a tem có mon_id (' + (vm4 ? 'ĐÚNG' : 'NULL!') + ') → quét TRAM-CAT (trong quy trình) KHÔNG SAI_TRAM',
    !!vm4 && !!gCat && !catSai, JSON.stringify(gCat && { kq: gCat.ket_qua, ly: gCat.ly_do_chan || gCat.ly_do }))
  const qLot = await attempt(() => c.query("select kho.tram_quet('TMI-4#1','TRAM-LOT-01',0,0,'vao') g"))
  const gLot = qLot.ok ? qLot.r.rows[0].g : null
  const lotSai = gLot && gLot.ket_qua === 'chan' && /không có bước cho trạm/.test(gLot.ly_do_chan || gLot.ly_do || '')
  ok('4b quét TRAM-LOT (KHÔNG trong quy trình KE-HO) → vẫn CHẶN SAI_TRAM đúng như cũ',
    !!lotSai, JSON.stringify(gLot && { kq: gLot.ket_qua, ly: gLot.ly_do_chan || gLot.ly_do }))
  await c.query('rollback to savepoint s4')

  // ── vế 5: đơn 2 món — mỗi tem về đúng món của nó ──
  await c.query('savepoint s5'); await vai(CEO)
  const d5 = await mkDon('TMI-5', 2)
  await attempt(() => c.query("select kho.day_tem_ban_ve('TMI-5',$1::jsonb)",
    [JSON.stringify([tam('TMI-5#A', d5.mons[0]), tam('TMI-5#B', d5.mons[1])])]))
  const mA = await monId('TMI-5#A'), mB = await monId('TMI-5#B')
  ok('5 đơn 2 món → mỗi tem về đúng món (A≠B, không lẫn)',
    mA === d5.mons[0] && mB === d5.mons[1] && mA !== mB, `A=${mA} B=${mB}`)
  await c.query('rollback to savepoint s5')

  // ── vế 6: xoa_demo xoá sạch đơn demo có tem mang mon_id (CASCADE) — không tái lập blocker WP-17b ──
  await c.query('savepoint s6'); await vai(CEO)
  await mkDon('TMI-6', 1)
  await attempt(() => c.query("select kho.day_tem_ban_ve('TMI-6',$1::jsonb)", [JSON.stringify([tam('TMI-6#1', null)])]))
  const temTruoc = +(await c.query("select count(*) n from kho.tem_ban_ve where ma_don='TMI-6'")).rows[0].n
  const x6 = await attempt(() => c.query("select kho.xoa_demo('TMI-6', null)"))
  const donSau = +(await c.query("select count(*) n from kho.don_hang where ma_don='TMI-6'")).rows[0].n
  const temSau = +(await c.query("select count(*) n from kho.tem_ban_ve where ma_don='TMI-6'")).rows[0].n
  ok('6 xoa_demo xoá đơn có tem mang mon_id (CASCADE) → đơn+tem(' + temTruoc + '→' + temSau + ')=0',
    x6.ok && donSau === 0 && temSau === 0, (x6.msg || '') + ` don=${donSau} tem=${temSau}`)
  await c.query('rollback to savepoint s6')

  // ── vế 7 (SQL): authenticated KHÔNG INSERT/UPDATE mon_id ──
  const priv = (await c.query("select has_column_privilege('authenticated','kho.tem_ban_ve','mon_id','UPDATE') u, has_column_privilege('authenticated','kho.tem_ban_ve','mon_id','INSERT') i")).rows[0]
  ok('7a authenticated KHÔNG UPDATE/INSERT mon_id (cột-mới ĐÓNG WP-11b)', priv.u === false && priv.i === false, JSON.stringify(priv))

} finally { await c.query('rollback') }

// ── vế 7b (REST live): client PATCH tem_ban_ve.mon_id → 40x ──
import { readFileSync } from 'fs'
let url = '', anon = ''
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  if (l.startsWith('VITE_SUPABASE_URL=')) url = l.split('=')[1].trim()
  if (l.startsWith('VITE_SUPABASE_ANON_KEY=')) anon = l.split('=')[1].trim()
}
try {
  const res = await fetch(`${url}/rest/v1/tem_ban_ve?ma_tam=eq.ANY-TAM`, {
    method: 'PATCH', headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json', 'Content-Profile': 'kho', 'Accept-Profile': 'kho' },
    body: JSON.stringify({ mon_id: '00000000-0000-0000-0000-000000000000' })
  })
  const body = await res.text()
  ok(`7b REST PATCH mon_id (client) → chặn (HTTP ${res.status})`, res.status >= 400 && /mon_id|permission denied/i.test(body), `status=${res.status} body=${body.slice(0, 150)}`)
} catch (e) { ok('7b REST PATCH → chặn', false, 'fetch: ' + e.message) }

await c.end()
console.log(`\n═══ test_tem_mon_id: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
