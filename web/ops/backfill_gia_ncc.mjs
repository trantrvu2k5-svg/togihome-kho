// backfill_gia_ncc.mjs — BACKFILL bảng giá NCC cho vật tư NHÓM VÁN chưa có dòng gia_ncc.
// Chỉ đạo CEO 23/08 (L-87). MỘT TẦNG: chỉ ghi dữ liệu qua RPC gia_ncc_ghi, KHÔNG đổi schema.
//
// Logic (theo chỉ đạo):
//   • Phạm vi: ván (kho.la_nhom_van) đang dùng, CHƯA có dòng gia_ncc nào (idempotent — chạy lại không đè).
//   • NCC gắn: NCC của LÔ NHẬP gần nhất (không huỷ) của mã đó; mã không có lô/không tra được NCC → Gỗ Tản Viên.
//   • Đơn giá (chưa VAT): gia_von_lo của lô gần nhất (đã ở ĐƠN VỊ CƠ SỞ theo QD-58);
//     không có lô → gia_von_bq (ton); không có nốt → BỎ QUA + liệt kê (KHÔNG bịa 0đ).
//   • lead_time_ngay = 4 [TẠM — CEO cấp 23/08, chưa đo].
//   • Ghi TỪNG DÒNG qua RPC kho.gia_ncc_ghi (lịch sử tự ghi theo đường chuẩn), KHÔNG INSERT thẳng.
//
// Chạy: node ops/backfill_gia_ncc.mjs        → DRY-RUN (in bảng dự kiến + danh sách bỏ qua, KHÔNG ghi)
//       node ops/backfill_gia_ncc.mjs --that → GHI THẬT
import pg from 'pg'; import { docConfig } from './conn.mjs'
const THAT = process.argv.includes('--that')
const LEAD = 4
const GHI_CHU = 'backfill 23/08 [TẠM] giá vốn lô gần nhất, lead 4 chưa đo'
const fmt = n => Number(n).toLocaleString('vi-VN')
const c = new pg.Client(await docConfig()); await c.connect()
const q = async (s, a = []) => (await c.query(s, a)).rows

try {
  const nccDefault = (await q("select id,ten from kho.nha_cung_cap where ten ilike '%Tản Viên%' order by ten limit 1"))[0]
  const actor = (await q("select auth_uid a, ho_ten, vai_tro from kho.nguoi_dung where vai_tro in ('ceo','kho') and dang_hoat_dong order by (vai_tro='ceo') desc, ho_ten limit 1"))[0]
  if (!nccDefault) throw new Error('không thấy NCC Gỗ Tản Viên')
  if (!actor) throw new Error('không thấy vai ceo/kho đang hoạt động để ghi')

  // ── phạm vi + nguồn giá/NCC (lô gần nhất không huỷ; NCC qua phiếu→đơn mua) ──
  const rows = await q(`
    select v.id vat_tu_id, v.ma, v.ten, v.don_vi_co_so,
           lo.gia_von_lo, lo.ncc_id lo_ncc, ncc.ten lo_ncc_ten, t.gia_von_bq
    from kho.vat_tu v
    left join lateral (
      select l.gia_von_lo, dm.ncc_id
      from kho.lo_nhap l
      left join kho.phieu p on p.id = l.phieu_id
      left join kho.don_mua dm on dm.id = p.don_mua_id
      where l.vat_tu_id = v.id and l.lo_da_huy = false
      order by l.tao_luc desc, l.id desc limit 1
    ) lo on true
    left join kho.nha_cung_cap ncc on ncc.id = lo.ncc_id
    left join lateral (
      select gia_von_bq from kho.ton
      where vat_tu_id = v.id and coalesce(gia_von_bq,0) > 0
      order by sua_luc desc limit 1
    ) t on true
    where kho.la_nhom_van(v.nhom_id) and v.ngung_dung = false
      and not exists (select 1 from kho.gia_ncc g where g.vat_tu_id = v.id)
    order by v.ma`)

  // ── vật tư ván ĐÃ có gia_ncc (bỏ qua idempotent — chỉ để minh bạch) ──
  const daCo = await q(`select v.ma from kho.vat_tu v
    where kho.la_nhom_van(v.nhom_id) and v.ngung_dung = false
      and exists (select 1 from kho.gia_ncc g where g.vat_tu_id = v.id) order by v.ma`)

  const plan = [], skip = []
  for (const r of rows) {
    let gia = null, nguon = null
    if (r.gia_von_lo != null && Number(r.gia_von_lo) > 0) { gia = Number(r.gia_von_lo); nguon = 'lô gần nhất' }
    else if (r.gia_von_bq != null && Number(r.gia_von_bq) > 0) { gia = Number(r.gia_von_bq); nguon = 'gia_von_bq' }
    if (gia == null) { skip.push({ ma: r.ma, ly_do: 'không có lô + không có gia_von_bq (>0)' }); continue }
    if (!r.don_vi_co_so) { skip.push({ ma: r.ma, ly_do: 'thiếu don_vi_co_so' }); continue }
    plan.push({
      vat_tu_id: r.vat_tu_id, ma: r.ma, don_vi: r.don_vi_co_so, gia, nguon,
      ncc_id: r.lo_ncc || nccDefault.id,
      ncc_ten: r.lo_ncc ? r.lo_ncc_ten : nccDefault.ten + ' (mặc định)'
    })
  }

  // ── in dự kiến ──
  console.log(`\n═══ ${THAT ? 'GHI THẬT' : 'DRY-RUN'} · backfill bảng giá NCC (ván) ═══`)
  console.log(`Phạm vi ván chưa có gia_ncc: ${rows.length} · sẽ điền: ${plan.length} · bỏ qua: ${skip.length} · đã có (idempotent bỏ): ${daCo.length}`)
  console.log(`\nMÃ | NCC gắn | nguồn giá | đơn giá (chưa VAT) | đơn vị`)
  plan.forEach(p => console.log(`  ${p.ma} | ${p.ncc_ten} | ${p.nguon} | ${fmt(p.gia)} | ${p.don_vi}`))
  if (skip.length) { console.log(`\nBỎ QUA (không bịa 0đ):`); skip.forEach(s => console.log(`  ${s.ma} — ${s.ly_do}`)) }
  if (daCo.length) console.log(`\nĐÃ CÓ, bỏ qua idempotent: ${daCo.map(x => x.ma).join(', ')}`)

  if (!THAT) { console.log(`\n[DRY-RUN] chưa ghi gì. Chạy lại với --that để ghi thật.`); await c.end(); process.exit(0) }

  // ── ghi thật qua RPC dưới vai ceo/kho ──
  console.log(`\nGhi qua RPC gia_ncc_ghi dưới vai ${actor.vai_tro} (${actor.ho_ten})…`)
  await c.query('begin')
  await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor.a, role: 'authenticated' })])
  let ok = 0
  for (const p of plan) {
    await c.query('select kho.gia_ncc_ghi($1,$2,$3,$4,$5,$6)', [p.ncc_id, p.vat_tu_id, p.don_vi, p.gia, LEAD, GHI_CHU])
    ok++
  }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  await c.query('commit')
  console.log(`\n✅ ĐÃ GHI ${ok} dòng · bỏ qua ${skip.length}.`)
} catch (e) {
  try { await c.query('rollback') } catch (_) {}
  console.error('💥 LỖI:', e.message); process.exit(1)
} finally { await c.end() }
