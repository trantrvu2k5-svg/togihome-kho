// test_suc_khoe_mau — WP-100 L-100.2 · 8 ca cho db/232 (cột thước · sổ thay đổi · tách nền tảng · RPC sức khoẻ mẫu).
//   Dựng CẢ migration + fixtures trong MỘT transaction rồi ROLLBACK → prod nguyên vẹn. In xác nhận sổ mốc thật còn nguyên.
//   Mỗi ca một MỐC NGÀY 2020 riêng → nền 7 ngày tách biệt, không dính 604 dòng chi_ads_ngay thật.
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { readFileSync } from 'node:fs'
import { bocAction, keoAdsLuot } from './keo_chi_ads_meta.mjs'   // [L-100.3] ca 9/10

const c = new pg.Client(await docConfig())
await c.connect()

let pass = 0, fail = 0
const eq = (ten, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${ten}${ok ? '' : `  → nhận ${JSON.stringify(got)} · mong ${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}
const ok_ = (ten, cond, chi_tiet = '') => { console.log(`  ${cond ? '✓' : '✗ FAIL'} ${ten}${cond ? '' : '  → ' + chi_tiet}`); cond ? pass++ : fail++ }

// mẫu tìm 1 ad trong kết quả RPC
const timMau = (kq, ad) => (kq.mau || []).find(m => m.ad_id === ad)

// chèn 1 dòng ad-ngày vào chi_ads_ngay (đủ cột NOT NULL + cột thước mới)
async function ad(o) {
  await c.query(
    `insert into kho.chi_ads_ngay
       (act_id, ad_id, ad_name, ngay, chi_tieu, hien_thi, luot_bam_link, tien_te, nhan_vat, keo_luc, nguon,
        tan_suat, luot_phat, thruplay, xep_hang_chat_luong, xep_hang_tuong_tac, xep_hang_chuyen_doi)
     values ($1,$2,$3,$4,$5,$6,$7,'VND','test',now(),'test',$8,$9,$10,$11,$12,$13)`,
    [o.act || 'act_T', o.ad, o.ten || o.ad, o.ngay, o.chi, o.ht ?? null, o.link ?? null,
     o.tan_suat ?? null, o.lp ?? null, o.tp ?? null, o.xh_cl ?? null, o.xh_tt ?? null, o.xh_cd ?? null])
}
const suc_khoe = async (d) => (await c.query('select kho.ads_suc_khoe_mau($1,$2) k', [d, d])).rows[0].k

try {
  // ── mốc THẬT trước (ngoài transaction) ──
  const mocTruoc = (await c.query("select count(*) n from kho.ads_moc_keo")).rows[0].n
  const chiTruoc = (await c.query("select count(*) n from kho.chi_ads_ngay")).rows[0].n

  await c.query('begin')
  // áp migration (bỏ begin/commit ngoài) — DDL trong transaction, rollback được
  for (const f of ['232_wp100_suc_khoe_mau.sql', '233_wp100_keo_that.sql', '234_wp100_va_thang_doc.sql']) {   // idempotent (if not exists / or replace)
    let sql = readFileSync(new URL('../../db/' + f, import.meta.url), 'utf8')
    sql = sql.replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '')
    await c.query(sql)
  }
  // Fixture dùng ngày 2020/2021 (nền tách biệt). RPC nay RAISE nếu ngưỡng chưa hiệu lực ở ngày truy vấn (db/234 xoá
  //   nhánh mặc định). Lùi hiệu lực 5 ngưỡng về 2019 TRONG TX để phủ mọi ngày test (rollback → prod nguyên).
  await c.query(`update kho.ads_nguong set hieu_luc_tu = date '2019-01-01'
    where ma in ('tan_suat_do','ctr_duoi_nen_phan_tram','hien_thi_toi_thieu_doc','bat_dau_xem_duoi_nen_phan_tram','cpm_tren_nen_phan_tram')
      and hieu_luc_den is null`)

  // ═══ CA 1 — mẫu ảnh: hai cột video "không đo được" (KHÔNG 0) + KHÔNG lọt nền ═══
  const D1 = '2020-01-15'
  await ad({ ad: 'v1a', ngay: D1, chi: 20000, ht: 2000, link: 40, lp: 1600, tp: 800 })
  await ad({ ad: 'v1b', ngay: D1, chi: 20000, ht: 2000, link: 40, lp: 1600, tp: 800 })
  await ad({ ad: 'img1', ngay: D1, chi: 10000, ht: 5000, link: 100 })  // ảnh: lp/tp NULL
  const k1 = await suc_khoe(D1)
  const m1 = timMau(k1, 'img1')
  eq('CA1 mẫu ảnh ty_le_bat_dau_xem = "không đo được"', m1.ty_le_bat_dau_xem, 'không đo được')
  eq('CA1 mẫu ảnh ty_le_giu_xem = "không đo được"', m1.ty_le_giu_xem, 'không đo được')
  ok_('CA1 mẫu ảnh KHÔNG ra 0', m1.ty_le_bat_dau_xem !== 0 && m1.ty_le_giu_xem !== 0)
  eq('CA1 nền video chỉ 2 mẫu (ảnh không lọt)', k1.nen_7ngay.so_mau_video_trong_nen, 2)
  eq('CA1 tổng mẫu trong nền = 3', k1.nen_7ngay.so_mau_trong_nen, 3)

  // ═══ CA 2 — nền tính trên 8 mẫu video ≠ nền trên cả 10 (hai con số khác nhau) ═══
  const D2 = '2020-02-15'
  // 8 mẫu video: rate bắt đầu xem = lp/ht khác nhau
  const vids = [[1000, 800], [1000, 700], [1000, 600], [1000, 500], [1000, 900], [1000, 400], [1000, 300], [1000, 850]]
  let i = 0
  for (const [ht, lp] of vids) { await ad({ ad: `v2_${i}`, ngay: D2, chi: 10000, ht, link: 30, lp, tp: Math.round(lp / 2) }); i++ }
  await ad({ ad: 'img2a', ngay: D2, chi: 5000, ht: 1000, link: 20 })   // ảnh
  await ad({ ad: 'img2b', ngay: D2, chi: 5000, ht: 1000, link: 20 })   // ảnh
  const k2 = await suc_khoe(D2)
  const nen8 = k2.nen_7ngay.bat_dau_xem                        // RPC: trung bình 8 mẫu video (bỏ NULL)
  const nen8_tay = vids.reduce((s, [ht, lp]) => s + lp / ht, 0) / 8   // = 0.68125
  const nen10_tay = (vids.reduce((s, [ht, lp]) => s + lp / ht, 0) + 0 + 0) / 10  // ảnh coi lp=0 → kéo xuống
  ok_('CA2 RPC nền = nền-8-video (bỏ mẫu ảnh)', Math.abs(nen8 - nen8_tay) < 1e-9, `${nen8} vs ${nen8_tay}`)
  ok_('CA2 nền-8 ≠ nền-10 (hai số khác nhau)', Math.abs(nen8_tay - nen10_tay) > 1e-9, `8→${nen8_tay} · 10→${nen10_tay}`)
  eq('CA2 so_mau_video_trong_nen = 8', k2.nen_7ngay.so_mau_video_trong_nen, 8)
  eq('CA2 so_mau_trong_nen = 10', k2.nen_7ngay.so_mau_trong_nen, 10)

  // ═══ CA 3 — hien_thi = 0 → "chưa đủ số để đọc", KHÔNG chia 0 ═══
  const D3 = '2020-03-15'
  await ad({ ad: 'z3', ngay: D3, chi: 100, ht: 0, link: 0 })
  const k3 = await suc_khoe(D3)   // nếu chia 0 thì câu này ném lỗi → try/catch bên dưới bắt
  eq('CA3 hien_thi=0 → "chưa đủ số để đọc"', timMau(k3, 'z3').ket_luan, 'chưa đủ số để đọc')

  // ═══ CA 4 — 300 hiển thị, CTR 0% → "chưa đủ số để đọc" (KHÔNG lỗi mẫu) ═══
  const D4 = '2020-04-15'
  await ad({ ad: 'z4', ngay: D4, chi: 50000, ht: 300, link: 0 })
  eq('CA4 300 hiển thị, CTR 0% → "chưa đủ số để đọc"', timMau(await suc_khoe(D4), 'z4').ket_luan, 'chưa đủ số để đọc')

  // ═══ CA 5 — bắt đầu xem tụt VÀ tần suất 4,1 → trả tầng ĐẦU (bắt đầu xem), không phải tần suất ═══
  const D5 = '2020-05-15'
  await ad({ ad: 'v5a', ngay: D5, chi: 20000, ht: 2000, link: 60, lp: 1600, tp: 800 })  // filler view-start cao 0.8
  await ad({ ad: 'v5b', ngay: D5, chi: 20000, ht: 2000, link: 60, lp: 1600, tp: 800 })
  await ad({ ad: 'v5c', ngay: D5, chi: 20000, ht: 2000, link: 60, lp: 1600, tp: 800 })
  await ad({ ad: 'tgt5', ngay: D5, chi: 40000, ht: 2000, link: 60, lp: 200, tp: 100, tan_suat: 4.1 }) // view-start 0.1 tụt + mỏi
  eq('CA5 bắt đầu xem tụt + tần suất 4,1 → tầng ĐẦU', timMau(await suc_khoe(D5), 'tgt5').ket_luan, 'bắt đầu xem tụt so nền')

  // ═══ CA 6 — tần suất 4,1 mà mọi tầng trên tốt → "tệp đã mỏi" ═══
  const D6 = '2020-06-15'
  await ad({ ad: 'm6', ngay: D6, chi: 40000, ht: 2000, link: 60, lp: 1600, tp: 800, tan_suat: 4.1,
             xh_cl: 'AVERAGE', xh_tt: 'AVERAGE', xh_cd: 'AVERAGE' })  // nền = chính nó → mọi tầng trên qua
  const kl6 = timMau(await suc_khoe(D6), 'm6').ket_luan
  ok_('CA6 mọi tầng trên tốt, tần suất 4,1 → "tệp đã mỏi"', /^tệp đã mỏi/.test(kl6), kl6)

  // ═══ CA 7 — ghi ads_thay_doi hai lần cùng bản ghi → chỉ MỘT dòng ═══
  const ghiTd = () => c.query(
    `insert into kho.ads_thay_doi (act_id, event_time, event_type, doi_tuong, ma_doi_tuong, mo_ta, nguoi_thuc_hien)
     values ('actX','2020-07-15 10:00+07','update_budget','CD Ngủ','cmp_9','tăng ngân sách','Vũ')
     on conflict (act_id, event_time, event_type, coalesce(ma_doi_tuong,'')) do nothing`)
  await ghiTd(); await ghiTd()
  eq('CA7 ghi 2 lần cùng bản ghi → 1 dòng', +(await c.query("select count(*) n from kho.ads_thay_doi where act_id='actX'")).rows[0].n, 1)

  // ═══ CA 8 — tổng platform ≠ tổng bảng chính → RPC trả tổng THEO BẢNG CHÍNH + cờ ước tính ═══
  const D8 = '2020-08-15'
  await ad({ ad: 'x8', act: 'act8', ngay: D8, chi: 100000, ht: 2000, link: 60 })  // bảng chính = 100.000
  await c.query(`insert into kho.chi_ads_nen_tang_ngay (act_id,ad_id,ngay,nen_tang,chi_tieu,hien_thi,tien_te)
                 values ('act8','x8',$1,'facebook',40000,800,'VND'),('act8','x8',$1,'instagram',90000,1200,'VND')`, [D8])
  const m8 = timMau(await suc_khoe(D8), 'x8')  // platform Σ = 130.000 ≠ 100.000
  eq('CA8 RPC trả tổng chi theo BẢNG CHÍNH (100.000)', +m8.chi, 100000)
  eq('CA8 tách nền tảng kèm cờ ước tính', m8.tach_nen_tang.la_uoc_tinh, true)
  const pSum = m8.tach_nen_tang.theo_nen_tang.reduce((s, x) => s + (+x.chi), 0)
  ok_('CA8 tổng platform (130.000) ≠ bảng chính (100.000)', pSum === 130000 && pSum !== 100000, `platform=${pSum}`)

  // ═══ CA 9 — Meta trả mảng action RỖNG cho mẫu ảnh → cột video NULL, KHÔNG 0, không vỡ ═══
  eq('CA9 bocAction([]) = null (mảng rỗng, KHÔNG 0)', bocAction([]), null)
  eq('CA9 bocAction(undefined) = null (trường vắng)', bocAction(undefined), null)
  eq('CA9 bocAction([{value:"7"}]) = 7 (bóc số)', bocAction([{ action_type: 'video_view', value: '7' }]), 7)
  eq('CA9 bocAction(2 phần tử) = tổng', bocAction([{ value: '3' }, { value: '4' }]), 7)

  // ═══ CA 10 — một trong B/C/D ném lỗi → hai việc kia vẫn ghi xong, mốc đúng nguồn báo 'loi' ═══
  //   Ép C lỗi (proxy ném ở ads_thay_doi_ghi). Meta = mock (không chạm mạng). tx = chạy trên chính client (không begin lồng).
  const mock = async (url) => {
    let o
    if (url.includes('/me/adaccounts')) o = { data: [{ name: 'TKtest', account_id: '999', currency: 'VND' }] }
    else if (url.includes('breakdowns=publisher_platform')) o = { data: [{ ad_id: 'ADX', publisher_platform: 'facebook', date_start: '2026-09-05', spend: '600', impressions: '300', inline_link_clicks: '3' }] }
    else if (url.includes('level=campaign')) o = { data: [{ campaign_id: 'CX', campaign_name: 'mc', objective: 'X', date_start: '2026-09-05', spend: '1000', impressions: '500', clicks: '9', inline_link_clicks: '4' }] }
    else if (url.includes('level=ad')) o = { data: [{ ad_id: 'ADX', ad_name: 'mock', date_start: '2026-09-05', spend: '1000', impressions: '500', clicks: '9', inline_link_clicks: '4', frequency: '1.2', video_play_actions: [{ value: '100' }], video_thruplay_watched_actions: [{ value: '50' }] }] }
    else if (url.includes('/activities')) o = { data: [{ event_time: '2026-09-01T10:00:00+0700', event_type: 'update_budget', object_id: 'cmpX', object_name: 'CD', extra_data: '{}', actor_name: 'Tester' }] }
    else o = { data: [] }
    return { json: async () => o }
  }
  // proxy: ép C lỗi ở ads_thay_doi_ghi (reject TỔNG HỢP, KHÔNG chạm DB → tx không bị abort). Object param → JSON string (pg cần vậy cho jsonb).
  const proxy = { query: (t, p = []) => /ads_thay_doi_ghi/.test(t) ? Promise.reject(new Error('ép lỗi C'))
    : c.query(t, p.map(v => (v !== null && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v)) }
  const kq10 = await keoAdsLuot(proxy, { token: 'x', fetch: mock, tx: fn => fn(proxy) })
  const mocMoi = async (nguon) => (await c.query(
    "select trang_thai from kho.ads_moc_keo where nguon=$1 order by id desc limit 1", [nguon])).rows[0]?.trang_thai
  ok_('CA10 đúng 1 việc lỗi = C_thay_doi', kq10.loi.length === 1 && kq10.loi[0].viec === 'C_thay_doi', JSON.stringify(kq10.loi))
  eq('CA10 mốc meta_thay_doi báo "loi"', await mocMoi('meta_thay_doi'), 'loi')
  eq('CA10 B (meta_chi_ad) vẫn "xong"', await mocMoi('meta_chi_ad'), 'xong')
  eq('CA10 D (meta_nen_tang) vẫn "xong"', await mocMoi('meta_nen_tang'), 'xong')

  // ═══ CA 11 — ngưỡng tầng 1 (bắt-đầu-xem) chốt đúng mốc 80% nền: 79% → ĐỎ · 81% → không ═══
  //   4 filler video 0.8 + target. đỏ: target 0.60 (nền 0.76 → 79%, mốc 80%×0.76=0.608 → 0.60<0.608 đỏ).
  const fill = async (d, pre, lp) => { for (let n = 0; n < 4; n++) await ad({ ad: `${pre}${n}`, ngay: d, chi: 50000, ht: 1000, link: 40, lp: 800, tp: 400, tan_suat: 1.5 }) ; await ad({ ad: `${pre}t`, ngay: d, chi: 50000, ht: 1000, link: 40, lp, tp: 300, tan_suat: 1.5 }) }
  const D11a = '2021-01-15'; await fill(D11a, 'f11a_', 600)   // 0.60/0.76 = 79% → đỏ
  eq('CA11 bắt-đầu-xem 79% nền → tầng 1 ĐỎ', timMau(await suc_khoe(D11a), 'f11a_t').ket_luan, 'bắt đầu xem tụt so nền')
  const D11b = '2021-02-15'; await fill(D11b, 'f11b_', 619)   // 0.619/0.7638 = 81% → không đỏ
  eq('CA11 bắt-đầu-xem 81% nền → KHÔNG đỏ (đang tốt)', timMau(await suc_khoe(D11b), 'f11b_t').ket_luan, 'đang tốt')

  // ═══ CA 12 — bắt đầu xem tụt VÀ CPM cao → ket_luan tầng 1, ghi_chu có CPM (hai trường riêng) ═══
  const D12 = '2021-03-15'
  for (let n = 0; n < 4; n++) await ad({ ad: `f12_${n}`, ngay: D12, chi: 50000, ht: 1000, link: 40, lp: 800, tp: 400, tan_suat: 1.5 })
  await ad({ ad: 'tgt12', ngay: D12, chi: 80000, ht: 1000, link: 40, lp: 400, tp: 200, tan_suat: 1.5 })  // bắt đầu 0.4 tụt + cpm 80k > nền56k×1.3
  const m12 = timMau(await suc_khoe(D12), 'tgt12')
  eq('CA12 ket_luan = tầng 1 (bắt đầu xem)', m12.ket_luan, 'bắt đầu xem tụt so nền')
  eq('CA12 ghi_chu có CPM (trường riêng)', m12.ghi_chu, 'giá đấu đang đắt hơn nền')

  // ═══ CA 13 — mọi tầng tốt, CPM = nền ×1,35 → ket_luan "đang tốt", ghi_chu CPM. ket_luan TUYỆT ĐỐI không là CPM ═══
  const D13 = '2021-04-15'
  for (let n = 0; n < 4; n++) await ad({ ad: `f13_${n}`, ngay: D13, chi: 40000, ht: 1000, link: 40, lp: 800, tp: 400, tan_suat: 1.5 })
  await ad({ ad: 'tgt13', ngay: D13, chi: 59178, ht: 1000, link: 40, lp: 800, tp: 400, tan_suat: 1.5 })  // cpm 59178 = nền43836×1.35
  const m13 = timMau(await suc_khoe(D13), 'tgt13')
  eq('CA13 ket_luan "đang tốt" (KHÔNG là câu CPM)', m13.ket_luan, 'đang tốt')
  eq('CA13 ghi_chu = CPM đắt', m13.ghi_chu, 'giá đấu đang đắt hơn nền')

  // ═══ CA 14 — CPM = nền ×1,15 → KHÔNG ghi chú gì ═══
  const D14 = '2021-05-15'
  for (let n = 0; n < 4; n++) await ad({ ad: `f14_${n}`, ngay: D14, chi: 40000, ht: 1000, link: 40, lp: 800, tp: 400, tan_suat: 1.5 })
  await ad({ ad: 'tgt14', ngay: D14, chi: 47792, ht: 1000, link: 40, lp: 800, tp: 400, tan_suat: 1.5 })  // cpm 47792 = nền41558×1.15 < ×1.3
  const m14 = timMau(await suc_khoe(D14), 'tgt14')
  eq('CA14 CPM ×1,15 → ghi_chu null', m14.ghi_chu, null)
  eq('CA14 ket_luan "đang tốt"', m14.ket_luan, 'đang tốt')

  // ═══ CA 15 — mẫu ảnh, CPM cao → chạy đúng, hai cột video vẫn "không đo được" ═══
  const D15 = '2021-06-15'
  for (let n = 0; n < 4; n++) await ad({ ad: `f15_${n}`, ngay: D15, chi: 40000, ht: 1000, link: 40, lp: 800, tp: 400, tan_suat: 1.5 })
  await ad({ ad: 'img15', ngay: D15, chi: 120000, ht: 2000, link: 80 })  // ẢNH, cpm 60k > nền44k×1.3
  const m15 = timMau(await suc_khoe(D15), 'img15')
  eq('CA15 mẫu ảnh ty_le_bat_dau_xem = "không đo được"', m15.ty_le_bat_dau_xem, 'không đo được')
  eq('CA15 mẫu ảnh ty_le_giu_xem = "không đo được"', m15.ty_le_giu_xem, 'không đo được')
  eq('CA15 mẫu ảnh vẫn chạy đúng (ket_luan đang tốt)', m15.ket_luan, 'đang tốt')
  eq('CA15 mẫu ảnh ghi_chu = CPM đắt', m15.ghi_chu, 'giá đấu đang đắt hơn nền')

  await c.query('rollback')

  // ── mốc THẬT sau (đã rollback) — phải y nguyên ──
  const mocSau = (await c.query("select count(*) n from kho.ads_moc_keo")).rows[0].n
  const chiSau = (await c.query("select count(*) n from kho.chi_ads_ngay")).rows[0].n
  ok_(`SỔ MỐC thật còn nguyên (ads_moc_keo ${mocTruoc}→${mocSau})`, mocTruoc === mocSau)
  ok_(`chi_ads_ngay thật còn nguyên (${chiTruoc}→${chiSau})`, chiTruoc === chiSau)
} catch (e) {
  try { await c.query('rollback') } catch {}
  console.log('  ✗ FAIL (ném lỗi):', e.message); fail++
} finally {
  await c.end()
}

console.log(`\n═══ test_suc_khoe_mau: ${pass} pass / ${fail} fail ═══`)
process.exit(fail ? 1 : 0)
