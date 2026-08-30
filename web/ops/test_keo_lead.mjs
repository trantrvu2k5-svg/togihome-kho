// TEST — WP-70 L-02b bộ kéo Pancake (nạp FIXTURE, KHÔNG gọi mạng). Owner tx → rollback dọn sạch.
import pg from 'pg'; import { readFileSync } from 'fs'
import { docConfig } from './conn.mjs'
import { dungURL, hoiThoaiToLead, ghiLoLead } from './keo_lead_pancake.mjs'

const FIX = JSON.parse(readFileSync(new URL('./fixtures/pancake_conversations.json', import.meta.url), 'utf8')).conversations
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const cnt = async (where = '') => (await one(`select count(*)::int n from kho.lead ${where}`)).n

const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
await c.query('begin')
// chạy như CEO (current_vai_tro='ceo') để tao_don qua guard; lead_ghi vẫn qua (vai ceo). GUC-only path test ở test_lead m/n.
await c.query('set local role authenticated')
await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: CEO, role: 'authenticated' })])

// ═══ 0 · URL script dựng KHÔNG chứa 'messages' (không đường rò nội dung) ═══
{ const urls = [dungURL('P1', 'tok'), dungURL('P1', 'tok', 'CUR9'), dungURL('page/123', 'a b', null)]
  ok('0. mọi URL script dựng KHÔNG chứa "messages"', urls.every(u => !u.includes('messages')) && urls.every(u => u.includes('/conversations')), JSON.stringify(urls)) }

// ═══ 1 · 3 hội thoại → 3 dòng lead; dòng có ad_id → xac_dinh ═══
const r1 = await ghiLoLead(c, 'FIXPAGE', FIX)
{ const n = await cnt(`where page_id='FIXPAGE'`)
  const ad = await one(`select muc_chac_chan from kho.lead where hoi_thoai_id='FIX-HT-1'`)
  const noad = await one(`select muc_chac_chan from kho.lead where hoi_thoai_id='FIX-HT-2'`)
  ok('1. 3 hội thoại → 3 dòng lead · có ad_id → xac_dinh · không ad → khong_biet', n === 3 && r1.ghi === 3 && ad.muc_chac_chan === 'xac_dinh' && noad.muc_chac_chan === 'khong_biet', JSON.stringify({ n, ghi: r1.ghi, ad: ad.muc_chac_chan, noad: noad.muc_chac_chan })) }

// ═══ 2 · chạy lại cùng fixture → vẫn 3 dòng, cả 3 'khong_doi' ═══
{ const r2 = await ghiLoLead(c, 'FIXPAGE', FIX)
  const n = await cnt(`where page_id='FIXPAGE'`)
  ok('2. chạy lại cùng fixture → vẫn 3 dòng, cả 3 khong_doi', n === 3 && r2.khong_doi === 3 && r2.ghi === 0, JSON.stringify({ n, r2 })) }

// ═══ 3 · đổi sđt 1 hội thoại → 4 dòng, v_lead_hien_hanh vẫn 3 ═══
{ const doi = FIX.map(h => h.id === 'FIX-HT-2' ? { ...h, phone_numbers: ['0900000099'] } : h)
  const r3 = await ghiLoLead(c, 'FIXPAGE', doi)
  const n = await cnt(`where page_id='FIXPAGE'`)
  const nhh = (await one(`select count(*)::int n from kho.v_lead_hien_hanh where page_id='FIXPAGE'`)).n
  const hh2 = await one(`select sdt from kho.v_lead_hien_hanh where hoi_thoai_id='FIX-HT-2'`)
  ok('3. đổi sđt 1 hội thoại → 4 dòng · v_lead_hien_hanh vẫn 3 (dòng mới có sđt)', n === 4 && r3.ghi === 1 && nhh === 3 && hh2.sdt === '0900000099', JSON.stringify({ n, nhh, sdt: hh2.sdt })) }

// ═══ 4 · KHÔNG dòng nào doi_chieu_lo / suy_ref (bộ kéo cấm chế mức suy) ═══
{ const bad = (await one(`select count(*)::int n from kho.lead where muc_chac_chan in ('doi_chieu_lo','suy_ref')`)).n
  ok('4. bộ kéo KHÔNG ghi doi_chieu_lo / suy_ref', bad === 0, 'có ' + bad + ' dòng suy') }

// ═══ 5 · tao_don từ lead có ad → quang_cao · không ad → khac ═══
{ const idAd = (await one(`select id from kho.lead where hoi_thoai_id='FIX-HT-1' order by stt desc limit 1`)).id
  const idNo = (await one(`select id from kho.lead where hoi_thoai_id='FIX-HT-3' order by stt desc limit 1`)).id
  await c.query(`select * from kho.tao_don('${JSON.stringify({ ma_don: 'KEO-AD', ten_khach: 'K', dong: 'le', gia_chot: 5000000 })}'::jsonb, false, '${idAd}')`)
  await c.query(`select * from kho.tao_don('${JSON.stringify({ ma_don: 'KEO-NO', ten_khach: 'K', dong: 'le', gia_chot: 5000000 })}'::jsonb, false, '${idNo}')`)
  const a = await one(`select nguon_khach from kho.don_hang where ma_don='KEO-AD'`)
  const b = await one(`select nguon_khach from kho.don_hang where ma_don='KEO-NO'`)
  ok('5. tao_don lead có ad → quang_cao · lead không ad → khac', a.nguon_khach === 'quang_cao' && b.nguon_khach === 'khac', JSON.stringify({ a: a.nguon_khach, b: b.nguon_khach })) }

// ═══ 6 · MỐC: kéo xong → lead_moc_ghi 1 dòng · lỗi giữa chừng → mốc KHÔNG đổi ═══
{ await c.query(`select kho.lead_moc_ghi('FIXPAGE', $1::timestamptz, $2, $3)`, [r1.max_cap_nhat, r1.last_conversation_id, 3])
  const m1 = await one(`select moc_cap_nhat, so_ban_ghi_lan_cuoi from kho.lead_moc_keo where page_id='FIXPAGE'`)
  const cnt1 = (await one(`select count(*)::int n from kho.lead_moc_keo where page_id='FIXPAGE'`)).n
  // lỗi giữa chừng: hội thoại thiếu thoi_diem (NOT NULL) → ghiLoLead throw → KHÔNG gọi lead_moc_ghi
  let loi = null
  await c.query('savepoint e6')
  try { await ghiLoLead(c, 'FIXPAGE', [{ id: 'FIX-BAD', inserted_at: null, updated_at: '2026-09-01T00:00:00Z', type: 'INBOX', ad_ids: [] }]) }
  catch (e) { loi = e.message; await c.query('rollback to savepoint e6') }
  const m2 = await one(`select moc_cap_nhat from kho.lead_moc_keo where page_id='FIXPAGE'`)
  ok('6. mốc: kéo xong 1 dòng đúng page · lỗi giữa chừng → mốc KHÔNG đổi', cnt1 === 1 && !!m1 && !!loi && String(m2.moc_cap_nhat) === String(m1.moc_cap_nhat), JSON.stringify({ cnt1, loi: !!loi, giu: String(m2.moc_cap_nhat) === String(m1.moc_cap_nhat) })) }

// ═══ 7 · nhiều ad_id → lấy phần tử đầu + cảnh báo (không im lặng) ═══
{ const { lead, canhbao } = hoiThoaiToLead({ id: 'X', inserted_at: '2026-08-01T00:00:00Z', type: 'INBOX', ad_ids: ['A1', 'A2', 'A3'] }, 'PG')
  ok('7. nhiều ad_id → lấy phần tử đầu (A1) + có cảnh báo', lead.ad_id === 'A1' && !!canhbao && canhbao.includes('3 ad_id'), JSON.stringify({ ad: lead.ad_id, canhbao })) }

// ═══ 8 · [L-02e LỖ 2] GUC không rò: bật cờ SÓT trước → ghiLoLead xong → CÙNG PHIÊN thấy cờ RỖNG (finally tắt) ═══
{ await c.query("select set_config('kho.lead_he_thong','1',false)")     // giả lập cờ còn sót từ thao tác trước
  await ghiLoLead(c, 'FIXPAGE', FIX)                                    // ghiLoLead: reset đầu lô + finally luôn tắt
  const g = (await one(`select current_setting('kho.lead_he_thong', true) v`)).v
  ok('8. GUC: sau ghiLoLead, CÙNG PHIÊN cờ đã rỗng (finally tắt, không rò qua pool)', g === '' || g === null, `cờ còn = ${JSON.stringify(g)}`) }

// ═══ 9 · [L-02e LỖ 2] PHIÊN KHÁC không bao giờ thấy cờ bật — kể cả khi phiên chính vừa bật ═══
{ await c.query("select set_config('kho.lead_he_thong','1',false)")     // phiên chính (c) bật cờ
  const c2 = new pg.Client(await docConfig()); await c2.connect()       // một PHIÊN KHÁC
  const g2 = (await c2.query(`select current_setting('kho.lead_he_thong', true) v`)).rows[0].v
  await c2.end()
  await c.query("select set_config('kho.lead_he_thong','',false)")      // dọn cờ phiên chính
  ok('9. GUC: PHIÊN KHÁC không thấy cờ bật (mỗi kết nối cờ riêng, không thừa hưởng)', g2 === '' || g2 === null, `phiên khác thấy = ${JSON.stringify(g2)}`) }

// ═══ 10 · [L-06] NHỊP TIM: lượt 0 lead → lan_keo_luc đổi, lan_co_lead_luc + moc_cap_nhat ĐỨNG YÊN ═══
{ await c.query('savepoint s10')
  await c.query('reset role')   // seed baseline dưới OWNER (insert lead_moc_keo bị revoke với authenticated)
  await c.query(`insert into kho.lead_moc_keo(page_id, moc_cap_nhat, last_conversation_id, lan_keo_luc, lan_co_lead_luc, so_ban_ghi_lan_cuoi)
    values('NHIP','2020-06-01T00:00:00Z','C0','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z',7)
    on conflict (page_id) do update set moc_cap_nhat=excluded.moc_cap_nhat, lan_keo_luc=excluded.lan_keo_luc, lan_co_lead_luc=excluded.lan_co_lead_luc, so_ban_ghi_lan_cuoi=excluded.so_ban_ghi_lan_cuoi`)
  await c.query("select set_config('kho.lead_he_thong','1',true)")
  await c.query(`select kho.lead_moc_ghi('NHIP', null, null, 0)`)     // lượt LẶNG (0 lead)
  const r = await one(`select moc_cap_nhat, lan_keo_luc, lan_co_lead_luc, so_ban_ghi_lan_cuoi from kho.lead_moc_keo where page_id='NHIP'`)
  ok('10. lượt 0 lead → nhịp tim (lan_keo_luc) đổi; lan_co_lead_luc + mốc + số ĐỨNG YÊN',
     new Date(r.lan_keo_luc).getFullYear() >= 2021 && new Date(r.lan_co_lead_luc).getFullYear() === 2020 && new Date(r.moc_cap_nhat).getFullYear() === 2020 && r.so_ban_ghi_lan_cuoi === 7,
     JSON.stringify({ keo: new Date(r.lan_keo_luc).getFullYear(), coLead: new Date(r.lan_co_lead_luc).getFullYear(), moc: new Date(r.moc_cap_nhat).getFullYear(), sbg: r.so_ban_ghi_lan_cuoi }))
  await c.query(`select kho.lead_moc_ghi('NHIP', '2026-08-29T10:00:00Z', 'C9', 4)`)   // lượt CÓ lead
  const r2 = await one(`select moc_cap_nhat, lan_co_lead_luc, so_ban_ghi_lan_cuoi from kho.lead_moc_keo where page_id='NHIP'`)
  ok('10b. lượt CÓ lead → lan_co_lead_luc nhảy now() + mốc + số cập nhật',
     new Date(r2.lan_co_lead_luc).getFullYear() >= 2021 && new Date(r2.moc_cap_nhat).getFullYear() === 2026 && r2.so_ban_ghi_lan_cuoi === 4,
     JSON.stringify({ coLead: new Date(r2.lan_co_lead_luc).getFullYear(), moc: new Date(r2.moc_cap_nhat).getFullYear(), sbg: r2.so_ban_ghi_lan_cuoi }))
  await c.query('rollback to savepoint s10') }

await c.query('rollback')
// dọn: rollback đã bỏ mọi dòng test (lead append-only → owner rollback trong tx); xác nhận
console.log(`\nDọn: lead FIXPAGE còn = ${await cnt(`where page_id='FIXPAGE'`)} (đã rollback)`)
console.log(`═══ test_keo_lead: ${P} pass / ${F} fail ═══`)
await c.end()
process.exit(F ? 1 : 0)
