// TEST WP-13b L-6 · ky_gia_hien_hanh() = kỳ ĐÃ XÁC NHẬN mới nhất (chưa có → kỳ mới nhất).
// tx-rollback, 0 rác prod. Vế 2 là vế ĐỎ-được (giá LÙI về kỳ cũ khi xác nhận kỳ cũ hơn).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6', SALE = '6e8ce1ff-984e-458c-9e19-1df68925a298'
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const cfg = await docConfig(); cfg.statement_timeout = 20000
const c = new pg.Client(cfg); await c.connect()
const kg = async () => (await c.query('select kho.ky_gia_hien_hanh() k')).rows[0].k
const setXN = (ky, on) => c.query(`update kho.tham_so_tai_chinh set xac_nhan_luc = ${on ? 'now()' : 'null'} where ma_ky=$1`, [ky])
const vai = u => c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: u, role: 'authenticated' })])
const attempt = async fn => { await c.query('savepoint s'); try { const r = await fn(); return { ok: true, r } } catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: e.message.split('\n')[0] } } }

try {
  await c.query('begin')
  // đảm bảo cả 3 kỳ chưa xác nhận (trạng thái gốc)
  await c.query("update kho.tham_so_tai_chinh set xac_nhan_luc=null where ma_ky in ('2026-07','2026-08','2026-09')")

  // vế 1
  ok('1 cả 3 kỳ chưa xác nhận → ky_gia_hien_hanh()=2026-09 (KHÔNG đổi giá hôm nay)', await kg() === '2026-09')
  // vế 2 (ĐỎ-được): xác nhận 08, 09 vẫn NULL → LÙI về 2026-08
  await setXN('2026-08', true)
  ok('2 xác nhận kỳ 08, 09 NULL → 2026-08 (giá LÙI — đúng luật)', await kg() === '2026-08', await kg())
  // vế 3: xác nhận cả 08+09 → 2026-09
  await setXN('2026-09', true)
  ok('3 xác nhận 08 và 09 → 2026-09', await kg() === '2026-09', await kg())
  // reset về: chỉ 09 xác nhận (cho vế 4)
  await setXN('2026-08', false)

  // vế 4: 09 xác nhận, mở kỳ 10 (chưa xác nhận) → vẫn 2026-09; xác nhận 10 → 2026-10
  await vai(CEO)
  const mo = await attempt(() => c.query("select kho.mo_ky_moi('2026-10')"))
  ok('4a mở kỳ 10 (mo_ky_moi) chạy được', mo.ok, mo.msg)
  ok('4b 09 xác nhận · 10 CHƯA → ky_gia_hien_hanh()=2026-09', await kg() === '2026-09', await kg())
  await setXN('2026-10', true)
  ok('4c xác nhận 10 → ky_gia_hien_hanh()=2026-10', await kg() === '2026-10', await kg())

  // vế 5: CẮN QUA chot_don (RPC nút "Chốt" gọi) — ma_ky_ap_dung theo ky_gia_hien_hanh lúc chốt.
  //   Đơn demo dựng trong tx (rollback). state A: 09 xác nhận, 10 CHƯA → stamp 2026-09; state B: 10 xác nhận → 2026-10.
  const mkDon = async (ma) => {
    const r = await c.query("insert into kho.don_hang(ma_don, ten_khach, trang_thai) values($1,$2,'bao_gia') returning id", [ma, 'DEMO L6 kỳ'])
    return r.rows[0].id
  }
  const chot = async (id) => { await vai(SALE); return attempt(() => c.query("select kho.chot_don($1,$2,$3)", [id, 'khac', 'togihome'])) }
  const maKy = async (id) => (await c.query('select ma_ky_ap_dung from kho.don_hang where id=$1', [id])).rows[0].ma_ky_ap_dung

  // state A: 10 CHƯA xác nhận
  await setXN('2026-10', false)
  const dA = await mkDon('DEMO-L6-A')
  const cA = await chot(dA)
  ok('5a chốt đơn DEMO khi kỳ 10 CHƯA xác nhận → ma_ky_ap_dung=2026-09', cA.ok && await maKy(dA) === '2026-09', (cA.msg || '') + ' ma_ky=' + await maKy(dA))
  // state B: xác nhận 10
  await setXN('2026-10', true)
  const dB = await mkDon('DEMO-L6-B')
  const cB = await chot(dB)
  ok('5b chốt đơn DEMO sau khi xác nhận kỳ 10 → ma_ky_ap_dung=2026-10', cB.ok && await maKy(dB) === '2026-10', (cB.msg || '') + ' ma_ky=' + await maKy(dB))

} finally {
  await c.query('rollback')   // 0 rác prod: kỳ 10, đơn demo, mọi xác nhận đều huỷ
}
// xác nhận prod nguyên trạng
const kgReal = await kg()
const kys = (await c.query("select ma_ky from kho.tham_so_tai_chinh order by ma_ky")).rows.map(r => r.ma_ky)
console.log(`\n── SAU ROLLBACK: kỳ=${kys.join(',')} · ky_gia_hien_hanh()=${kgReal} (mong 2026-09) ──`)
ok('prod nguyên trạng: 3 kỳ 07/08/09, ky_gia_hien_hanh=2026-09', kys.join(',') === '2026-07,2026-08,2026-09' && kgReal === '2026-09')
await c.end()
console.log(`\n═══ test_ky_xac_nhan: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
