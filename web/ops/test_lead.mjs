// TEST CẮN — WP-70 L-01 (db/175): lead SỔ append-only + chu_de đóng + tao_don nhận lead. Outer BEGIN…ROLLBACK.
//   a INSERT thẳng lead → từ chối · b UPDATE/DELETE → từ chối · c lead_ghi 2× → 1 dòng + khong_doi
//   d lead_ghi +sđt → 2 dòng, hiện hành = dòng mới · e muc_chac_chan/luong sai → lỗi
//   f chu_de_ma lạ → lỗi, NULL → được · g tao_don(lead_id) → don_hang.lead_id · h không lead_id vẫn chạy + bao_gia
//   i lead KHÔNG có cột nội dung tin nhắn
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') } catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const uid = async v => (await one(`select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null limit 1`, [v]))?.a
const CEO = await uid('ceo'); const SALE = await uid('sale')
const base = { page_id: 'P1', hoi_thoai_id: 'H1', loai: 'inbox', thoi_diem_hoi_thoai: '2026-08-10T09:00:00Z', luong: 'qua_web', muc_chac_chan: 'xac_dinh', ad_id: 'AD1' }
const ghi = (o) => `select kho.lead_ghi('${JSON.stringify({ ...base, ...o })}'::jsonb) j`

await c.query('begin')

// ═══ a · INSERT thẳng lead qua PostgREST (authenticated) → TỪ CHỐI ═══
{ const r = await as(CEO, `insert into kho.lead(stt,page_id,hoi_thoai_id,thoi_diem_hoi_thoai,luong,muc_chac_chan,dau_van) values(999,'P','H',now(),'qua_web','xac_dinh','x')`)
  ok('a. INSERT thẳng lead (client) → TỪ CHỐI', !!r.e && /denied|policy|row-level|permission/i.test(r.e), r.e || 'LỌT') }

// tạo 1 dòng qua lead_ghi để test UPDATE/DELETE
const g1 = await as(CEO, ghi({}), [], true)
const leadId = g1.r?.[0]?.j?.id
ok('c1. lead_ghi lần 1 → da_ghi', g1.r?.[0]?.j?.ket === 'da_ghi', JSON.stringify(g1.r?.[0]?.j || g1.e))

// ═══ b · UPDATE/DELETE lead → TỪ CHỐI ═══
{ const u = await as(CEO, `update kho.lead set sdt='0900' where id='${leadId}'`)
  const d = await as(CEO, `delete from kho.lead where id='${leadId}'`)
  ok('b. UPDATE lead → từ chối', !!u.e, u.e); ok('b. DELETE lead → từ chối', !!d.e, d.e) }

// ═══ c · lead_ghi 2 lần cùng dữ liệu → 1 dòng, lần 2 'khong_doi' ═══
{ const g2 = await as(CEO, ghi({}), [], true)
  const n = (await one(`select count(*)::int n from kho.lead where page_id='P1' and hoi_thoai_id='H1'`)).n
  ok('c. lead_ghi lần 2 cùng data → khong_doi + vẫn 1 dòng', g2.r?.[0]?.j?.ket === 'khong_doi' && n === 1, JSON.stringify({ ket: g2.r?.[0]?.j, n })) }

// ═══ d · lead_ghi lần 3 thêm sđt → 2 dòng; v_lead_hien_hanh = dòng mới ═══
{ const g3 = await as(CEO, ghi({ sdt: '0912345678' }), [], true)
  const n = (await one(`select count(*)::int n from kho.lead where page_id='P1' and hoi_thoai_id='H1'`)).n
  const hh = await one(`select sdt, stt from kho.v_lead_hien_hanh where page_id='P1' and hoi_thoai_id='H1'`)
  ok('d. +sđt → 2 dòng · v_lead_hien_hanh = dòng mới (có sđt, stt lớn nhất)', g3.r?.[0]?.j?.ket === 'da_ghi' && n === 2 && hh.sdt === '0912345678', JSON.stringify({ n, hh })) }

// ═══ e · muc_chac_chan / luong sai → lỗi ═══
{ const e1 = await as(CEO, ghi({ hoi_thoai_id: 'H2', muc_chac_chan: 'bay_bong' }))
  const e2 = await as(CEO, ghi({ hoi_thoai_id: 'H3', luong: 'bay' }))
  ok('e. muc_chac_chan sai → lỗi · luong sai → lỗi', !!e1.e && !!e2.e, (e1.e || '') + ' | ' + (e2.e || '')) }

// ═══ f · [L-08] loai_ma lạ → lỗi (FK loai_thuong_mai); NULL → được ═══
{ const bad = await as(CEO, ghi({ hoi_thoai_id: 'H4', loai_ma: 'KHONG_CO' }))
  const nul = await as(CEO, ghi({ hoi_thoai_id: 'H5', loai_ma: null }))
  ok('f. loai_ma lạ → lỗi (FK) · NULL → được', !!bad.e && /foreign key|loai/i.test(bad.e) && !nul.e && nul.r?.[0]?.j?.ket === 'da_ghi', (bad.e || 'lạ-lọt') + ' | ' + (nul.e || 'nul-ok')) }

// ═══ g · tao_don(p_lead_id) → don_hang.lead_id đúng ═══
{ const r = await as(CEO, `select * from kho.tao_don('${JSON.stringify({ ma_don: 'LEAD-T1', ten_khach: 'K', dong: 'le', gia_chot: 5000000 })}'::jsonb, false, '${leadId}')`, [], true)
  const d = await one(`select lead_id, trang_thai, nguon_khach from kho.don_hang where ma_don='LEAD-T1'`)
  ok('g. tao_don(p_lead_id) → don_hang.lead_id đúng + nguồn đọc từ lead', !r.e && d.lead_id === leadId && d.trang_thai === 'bao_gia', JSON.stringify({ e: r.e, d })) }

// ═══ h · tao_don KHÔNG lead_id vẫn chạy + ép bao_gia (không phá WP-07) ═══
{ const r = await as(CEO, `select * from kho.tao_don('${JSON.stringify({ ma_don: 'LEAD-T2', ten_khach: 'K2', dong: 'le', gia_chot: 3000000, nguon_khach: 'gioi_thieu' })}'::jsonb, false)`, [], true)
  const d = await one(`select lead_id, trang_thai, nguon_khach from kho.don_hang where ma_don='LEAD-T2'`)
  ok('h. tao_don KHÔNG lead_id vẫn chạy · trang_thai=bao_gia · lead_id NULL · nguon giữ nguyên', !r.e && d.lead_id === null && d.trang_thai === 'bao_gia' && d.nguon_khach === 'gioi_thieu', JSON.stringify({ e: r.e, d })) }

// ═══ i · lead KHÔNG có cột nội dung tin nhắn ═══
{ const cols = (await q(`select column_name from information_schema.columns where table_schema='kho' and table_name='lead'`)).map(x => x.column_name)
  const xau = cols.filter(x => /noi_dung|message|text_tin|content|noidung/i.test(x))
  ok('i. lead KHÔNG có cột nội dung tin nhắn', xau.length === 0, 'cột xấu: ' + JSON.stringify(xau)) }

// ═══ [L-02a] j · lead có ad_id (xac_dinh) → tao_don → nguon_khach = 'quang_cao' ═══
{ const r = await as(CEO, `select * from kho.tao_don('${JSON.stringify({ ma_don: 'LEAD-AD', ten_khach: 'K', dong: 'le', gia_chot: 5000000 })}'::jsonb, false, '${leadId}')`, [], true)
  const d = await one(`select nguon_khach from kho.don_hang where ma_don='LEAD-AD'`)
  ok('j. lead có ad_id → nguon_khach = quang_cao', !r.e && d.nguon_khach === 'quang_cao', JSON.stringify({ e: r.e, d })) }

// ═══ [L-02a] k · lead suy_ref/doi_chieu_lo/khong_biet KHÔNG ad_id → nguon_khach='khac' (KHÔNG bơm số suy) ═══
for (const [mcc, sfx] of [['suy_ref', 'SR'], ['doi_chieu_lo', 'DL'], ['khong_biet', 'KB']]) {
  const g = await as(CEO, ghi({ hoi_thoai_id: 'HN' + sfx, muc_chac_chan: mcc, ad_id: null }), [], true)
  const lid = g.r?.[0]?.j?.id
  const r = await as(CEO, `select * from kho.tao_don('${JSON.stringify({ ma_don: 'LEAD-' + sfx, ten_khach: 'K', dong: 'le', gia_chot: 5000000 })}'::jsonb, false, '${lid}')`, [], true)
  const d = await one(`select nguon_khach from kho.don_hang where ma_don='LEAD-${sfx}'`)
  ok(`k. lead ${mcc} KHÔNG ad_id → nguon_khach='khac' (không suy quảng cáo)`, !r.e && d.nguon_khach === 'khac', JSON.stringify({ e: r.e, d })) }

// ═══ [L-02a] m/n · lead_ghi: vai NULL + KHÔNG GUC → từ chối · có GUC kho.lead_he_thong → ghi được ═══
const FAKE = '00000000-0000-0000-0000-0000000000ff'
{ await c.query('savepoint g'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: FAKE, role: 'authenticated' })])
  let em = null; try { await c.query(ghi({ hoi_thoai_id: 'HG1' })) } catch (x) { em = x.message }
  await c.query('rollback to savepoint g'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  ok('m. lead_ghi vai NULL + KHÔNG GUC → TỪ CHỐI', !!em && /hệ thống|ke_toan/i.test(em), em) }
{ await c.query('savepoint g'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: FAKE, role: 'authenticated' })])
  await c.query("select set_config('kho.lead_he_thong','1',true)")
  let en = null, rn = null; try { rn = (await c.query(ghi({ hoi_thoai_id: 'HG2' }))).rows } catch (x) { en = x.message }
  await c.query("select set_config('kho.lead_he_thong','',true)")
  await c.query('rollback to savepoint g'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  ok('n. lead_ghi có GUC kho.lead_he_thong (vai NULL) → ghi được', !en && rn?.[0]?.j?.ket === 'da_ghi', en || JSON.stringify(rn?.[0]?.j)) }

// ═══ [L-02a] o · lead_moc_keo: ghi 2× cùng page_id → 1 dòng, giá trị lần sau (MỐC, upsert) ═══
{ await as(CEO, `select kho.lead_moc_ghi('PG1', '2026-08-01'::timestamptz, 'C100', 60)`, [], true)
  await as(CEO, `select kho.lead_moc_ghi('PG1', '2026-08-20'::timestamptz, 'C200', 42)`, [], true)
  const n = (await one(`select count(*)::int n from kho.lead_moc_keo where page_id='PG1'`)).n
  const row = await one(`select last_conversation_id, so_ban_ghi_lan_cuoi from kho.lead_moc_keo where page_id='PG1'`)
  ok('o. lead_moc_keo 2× cùng page_id → 1 dòng, giá trị lần sau', n === 1 && row.last_conversation_id === 'C200' && row.so_ban_ghi_lan_cuoi === 42, JSON.stringify({ n, row })) }

await c.query('rollback')
console.log(`\n═══ test_lead: ${P} pass / ${F} fail ═══`)
await c.end()
process.exit(F ? 1 : 0)
