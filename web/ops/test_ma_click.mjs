// TEST — WP-79b L-06 · ghi_click_chat 15 tham số: MÃ CLICK giữ NGUYÊN VĂN (fbclid/utm) + trần độ dài + mốc.
//   ⚠ fbclid = MÃ CLICK, KHÔNG phải ad_id. Không cắt/hash/đoán chiến dịch. Nhãn 'chua_giai' (không cột nào tên ad_id).
//   Mọi thứ trong 1 transaction, ROLLBACK cuối (không để lại dòng test trong sổ click).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]

await c.query('begin')

// ── D1. MÃ CLICK giữ NGUYÊN VĂN — chuỗi có dấu chấm/gạch/hoa-thường KHÔNG bị cắt/đổi ──
const FB = 'IwAR0aB-cD_eF.gHiJ99xXyZ'   // dạng fbclid thật: có . _ - hoa thường
const id1 = (await one(
  `select kho.ghi_click_chat('web-ban_le-27','zalo','https://zalo.me/x','src=test','UA-test',
     '/sp.27', null, $1, 'fbclid', 'fb_ig', 'social', 'combo_t8', 'vid_a', 'kw', 'https://sconcept.vn/sp.27?fbclid='||$1) id`,
  [FB])).id
const r1 = await one(`select ma_click, loai_ma_click, utm_source, utm_medium, utm_campaign, utm_content, utm_term, trang_dat from kho.click_chat where id=$1`, [id1])
ok('D1. ma_click giữ NGUYÊN VĂN (không cắt/hash/đổi)', r1.ma_click === FB, `ra: ${r1.ma_click}`)
ok('D1b. utm mang đủ 5 trục + loai_ma_click=fbclid', r1.loai_ma_click === 'fbclid' && r1.utm_source === 'fb_ig' && r1.utm_medium === 'social' && r1.utm_campaign === 'combo_t8' && r1.utm_content === 'vid_a' && r1.utm_term === 'kw', JSON.stringify(r1))
ok('D1c. trang_dat = URL trang lúc bấm (khác duong_dan=pathname)', r1.trang_dat === 'https://sconcept.vn/sp.27?fbclid=' + FB)

// ── D2. Trần độ dài (chống phồng), KHÔNG làm sạch nội dung: ma_click 512 · loai 16 · utm 256 · trang_dat 1024 ──
const long = (n, ch = 'x') => ch.repeat(n)
const id2 = (await one(
  `select kho.ghi_click_chat('web-ban_le-27','zalo','d','src=test','UA', '/p.27', null, $1, $2, $3, null, null, null, null, $4) id`,
  [long(600), long(30), long(300), long(1500)])).id
const r2 = await one(`select length(ma_click) a, length(loai_ma_click) b, length(utm_source) d, length(trang_dat) e from kho.click_chat where id=$1`, [id2])
ok('D2. trần độ dài: ma_click≤512 · loai≤16 · utm≤256 · trang_dat≤1024', r2.a === 512 && r2.b === 16 && r2.d === 256 && r2.e === 1024, JSON.stringify(r2))

// ── D3. Vắng mã click (null/rỗng/khoảng trắng) → NULL (lượt không quảng cáo vẫn ghi bình thường) ──
const id3 = (await one(`select kho.ghi_click_chat('web-ban_le-27','messenger','d','src=test','UA','/p.27',null,'   ','',null,null,null,null,null,null) id`)).id
const r3 = await one(`select ma_click, loai_ma_click, trang_dat from kho.click_chat where id=$1`, [id3])
ok('D3. mã click rỗng/khoảng-trắng → NULL (không bịa)', r3.ma_click === null && r3.loai_ma_click === null && r3.trang_dat === null, JSON.stringify(r3))

// ── D4. Tương thích ngược: gọi 6 tham số kiểu cũ (mã click DEFAULT NULL) vẫn ghi được ──
let d4ok = true, d4e = ''
try { await c.query(`select kho.ghi_click_chat('web-ban_le-27','zalo','d','src=test','UA','/p.27')`) } catch (e) { d4ok = false; d4e = e.message }
ok('D4. gọi 6 tham số cũ (không mã click) vẫn chạy — DEFAULT NULL', d4ok, d4e)

// ── D5. MỐC bắt mã click tồn tại (VIỆC 4: trước mốc TRỐNG vĩnh viễn, không lấp ngược) ──
const moc = await one(`select gia_tri::numeric > 0 co, don_vi from kho.tham_so_van_hanh where ma='wp79b_ma_click_tu'`)
ok('D5. mốc wp79b_ma_click_tu tồn tại (epoch_giay > 0)', !!moc && moc.co === true && moc.don_vi === 'epoch_giay', JSON.stringify(moc))

// ── ÂM1. Bản 7 tham số cũ (…,integer) đã DROP — chỉ còn bản 15 tham số ──
const sig = await one(`select
  to_regprocedure('kho.ghi_click_chat(text,text,text,text,text,text,integer)') cu,
  to_regprocedure('kho.ghi_click_chat(text,text,text,text,text,text,integer,text,text,text,text,text,text,text,text)') moi`)
ok('ÂM1. bản 7 tham số DROP · bản 15 tham số tồn tại', sig.cu === null && sig.moi !== null, JSON.stringify(sig))

// ── ÂM2. KHÔNG cột nào tên ad_id/campaign_id (mã click ≠ mã quảng cáo — QD-84) ──
const cols = (await c.query(`select column_name from information_schema.columns where table_schema='kho' and table_name='click_chat'`)).rows.map(r => r.column_name)
const cam = cols.filter(n => /^ad_id$|campaign_id/i.test(n))
ok('ÂM2. click_chat KHÔNG có cột ad_id/campaign_id (mã click nhãn chua_giai)', cam.length === 0, 'thấy: ' + JSON.stringify(cam))

// ── ÂM3. ghi_click_chat KHÔNG cấp cho public/anon/authenticated (chỉ owner qua Hyperdrive gọi được) ──
const grant = (await c.query(`select grantee from information_schema.role_routine_grants
  where routine_schema='kho' and routine_name='ghi_click_chat' and grantee in ('public','anon','authenticated')`)).rows
ok('ÂM3. ghi_click_chat REVOKE public/anon/authenticated', grant.length === 0, JSON.stringify(grant.map(g => g.grantee)))

await c.query('rollback')
console.log(`\n═══ test_ma_click: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
