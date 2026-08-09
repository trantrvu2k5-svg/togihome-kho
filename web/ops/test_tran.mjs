// TEST PHẢI CẮN — trần giảm giá + chặn cứng (030). Áp 030 trong tx rồi ROLLBACK (027-029 đã ở prod).
// Chạy (từ web/): DATABASE_URL='...' node ops/test_tran.mjs
import { readFileSync } from 'fs'
import pg from 'pg'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql030 = strip(readFileSync('/Users/vuquanghai/Documents/togihome-kho/db/030_tran_giam_gia.sql', 'utf8'))
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
await c.connect()
let PASS = 0, FAIL = 0
const ok = (n, cond, e = '') => { console.log((cond ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); cond ? PASS++ : FAIL++ }
const q = async (s, a = []) => (await c.query(s, a)).rows

// thử 1 lần đặt giá cho đơn TEST; trả về null nếu OK, hoặc message nếu bị CHẶN
const GCT = 10000000
async function datGia(chiet, gia_chot, ns, lydo) {
  await c.query('savepoint t')
  try {
    await c.query(`update kho.don_hang set gia_cong_thuc=$1, chiet_khau=$2, gia_chot=$3, ma_ns_duyet_giam=$4, ly_do_giam=$5 where ma_don='TEST-TGG'`,
      [GCT, chiet, gia_chot, ns, lydo])
    return null
  } catch (e) { return e.message }
  finally { await c.query('rollback to savepoint t') }
}
const pctChiet = p => Math.round(GCT * p / 100)

try {
  await c.query('begin')
  console.log('— áp 030 trong tx —')
  await c.query(sql030)
  await c.query(`update kho.tham_so_tai_chinh set he_so_m=1.25 where ma_ky='2026-07'`)
  const sku = (await q(`select ma from kho.san_pham_mau_gia_von where gia_von is not null order by ma limit 1`))[0].ma
  const san = Number((await q(`select kho.gia_san_don_i($1::jsonb,'le') g`, [JSON.stringify([{ sku }])]))[0].g)
  const ceo = (await q(`select id from kho.nguoi_dung where vai_tro='ceo' limit 1`))[0].id   // đã có quyền 'ceo' (seed)
  // trưởng nhóm = một user có sẵn (không phải ceo), cấp quyền 'truong_nhom' qua quyen_duyet_giam
  const truong = (await q(`select id from kho.nguoi_dung where vai_tro<>'ceo' order by id limit 1`))[0].id
  await c.query(`insert into kho.quyen_duyet_giam(ns_id,cap) values($1,'truong_nhom') on conflict (ns_id) do update set cap='truong_nhom'`, [truong])
  await c.query(`insert into kho.don_hang(ma_don,dong,ngay_chot) values('TEST-TGG','le',current_date)`)
  await c.query(`insert into kho.don_hang_mon(don_id,sp_id,gia) values((select id from kho.don_hang where ma_don='TEST-TGG'),$1,5000000)`, [sku])
  console.log(`  sku=${sku} · giá sàn=${san} · gia_cong_thuc=${GCT} · ceo=${ceo.slice(0,8)} truong=${truong.slice(0,8)}\n`)

  // A — 4% (≤ tran_sale 5) → lưu được
  ok('A  giảm 4% → LƯU được (không cần duyệt)', (await datGia(pctChiet(4), GCT - pctChiet(4), null, 'khuyến mãi')) === null)
  // B — 6% không duyệt → ĐỎ
  ok('B  giảm 6% không người duyệt → CHẶN', (await datGia(pctChiet(6), GCT - pctChiet(6), null, 'x')) !== null)
  // C — 6% + trưởng nhóm + lý do → lưu
  ok('C  giảm 6% có trưởng nhóm + lý do → LƯU', (await datGia(pctChiet(6), GCT - pctChiet(6), truong, 'khách quen')) === null)
  // D — 9% chỉ trưởng nhóm → ĐỎ (cần CEO)
  ok('D  giảm 9% chỉ trưởng nhóm → CHẶN (cần CEO)', (await datGia(pctChiet(9), GCT - pctChiet(9), truong, 'ok')) !== null)
  // E — dưới giá sàn + CEO → VẪN ĐỎ
  {
    const gc = san - 100000  // dưới sàn
    ok('E  dưới giá sàn dù CEO duyệt → CHẶN', (await datGia(GCT - gc, gc, ceo, 'sếp duyệt')) !== null, `gia_chot=${gc}<sàn ${san}`)
  }
  // F — nới trần SP 15% → 12% lưu; hết hiệu lực → 12% ĐỎ lại
  await c.query(`insert into kho.noi_tran_sp(sku,tran_moi,ma_ns_duyet,ly_do,hieu_luc_tu,hieu_luc_den)
    values($1,15,$2,'chiến dịch',current_date,current_date+30)`, [sku, ceo])
  ok('F1 nới SP 15% → giảm 12% LƯU (không cần duyệt)', (await datGia(pctChiet(12), GCT - pctChiet(12), null, 'sale')) === null)
  await c.query(`update kho.noi_tran_sp set hieu_luc_tu = current_date - 10, hieu_luc_den = current_date - 1 where sku=$1`, [sku])  // hết hiệu lực (khoảng quá khứ)
  ok('F2 nới hết hiệu lực → giảm 12% CHẶN lại', (await datGia(pctChiet(12), GCT - pctChiet(12), null, 'sale')) !== null)
  // G — SP 15% + kỳ 10% → tran_giam_gia = 15
  await c.query(`update kho.noi_tran_sp set hieu_luc_tu = current_date, hieu_luc_den = current_date + 30 where sku=$1`, [sku])  // bật lại SP 15
  await c.query(`insert into kho.noi_tran_ky(ma_ky,dong,tran_moi,ma_ns_duyet,ly_do,hieu_luc_tu,hieu_luc_den)
    values('2026-07','le',10,$1,'sale off','2026-07-01',current_date+30)`, [ceo])
  const tran = Number((await q(`select kho.tran_giam_gia($1,'le',current_date) t`, [sku]))[0].t)
  ok('G  SP nới 15% + kỳ nới 10% → trần = 15 (mức nới nhất)', tran === 15, `trần=${tran}`)

  // H — sale gọi tran_giam_gia → số; response KHÔNG chứa giá vốn; KHÔNG đọc thẳng noi_tran_sp
  const sale = (await q(`select auth_uid from kho.nguoi_dung where vai_tro='sale' and auth_uid is not null limit 1`))[0]?.auth_uid
  if (sale) {
    await c.query('savepoint h'); await c.query('set local role authenticated')
    await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: sale, role: 'authenticated' })])
    const t = (await q(`select kho.tran_giam_gia($1,'le',current_date)::text t`, [sku]))[0].t
    ok('H  sale gọi tran_giam_gia ra SỐ', /^\d+(\.\d+)?$/.test(t), `=${t}`)
    let gvBlocked = false; try { await q(`select count(*) from kho.san_pham_mau_gia_von`) } catch { gvBlocked = true }
    const ntRows = (await q(`select count(*)::int n from kho.noi_tran_sp`))[0].n  // RLS -> 0
    ok('H  sale KHÔNG đọc giá vốn + KHÔNG đọc noi_tran_sp (ly_do ẩn)', ntRows === 0, `noi_tran_sp thấy ${ntRows} dòng`)
    await c.query('rollback to savepoint h'); await c.query('reset role')
  }

  // I — BỎ TỪNG CHỐT (GUC) → mỗi ca ĐỎ (không chốt thì lọt); bật lại → chặn
  await c.query(`delete from kho.noi_tran_sp`); await c.query(`delete from kho.noi_tran_ky`)  // trần về mặc định 5
  console.log('\n── [CẮN] bỏ từng chốt, in cả hai bản ──')
  // CHỐT lý do: 4% KHÔNG lý do
  const off = async (guc, chiet, gc, ns, lydo) => {
    await c.query('savepoint i'); await c.query(`select set_config($1,'1',true)`, [guc])
    const passWithout = (await datGia(chiet, gc, ns, lydo)) === null
    await c.query(`select set_config($1,'',true)`, [guc])
    const blockedWith = (await datGia(chiet, gc, ns, lydo)) !== null
    await c.query('rollback to savepoint i')
    return { passWithout, blockedWith }
  }
  let r = await off('chan.off_lydo', pctChiet(4), GCT - pctChiet(4), null, '')
  console.log(`   lý do: bỏ chốt → lọt=${r.passWithout} (ĐỎ) | bật chốt → chặn=${r.blockedWith} (XANH)`)
  ok('I  chốt LÝ DO cắn', r.passWithout && r.blockedWith)
  r = await off('chan.off_tran', pctChiet(6), GCT - pctChiet(6), null, 'x')
  console.log(`   trần : bỏ chốt → lọt=${r.passWithout} (ĐỎ) | bật chốt → chặn=${r.blockedWith} (XANH)`)
  ok('I  chốt TRẦN cắn', r.passWithout && r.blockedWith)
  r = await off('chan.off_san', GCT - (san - 100000), san - 100000, ceo, 'sếp')
  console.log(`   sàn  : bỏ chốt → lọt=${r.passWithout} (ĐỎ) | bật chốt → chặn=${r.blockedWith} (XANH)`)
  ok('I  chốt GIÁ SÀN cắn', r.passWithout && r.blockedWith)

  console.log(`\n== KẾT: ${PASS} pass / ${FAIL} fail ==`)
} catch (e) { console.error('LỖI:', e.message); FAIL++ }
finally { await c.query('rollback'); await c.end(); process.exit(FAIL ? 1 : 0) }
