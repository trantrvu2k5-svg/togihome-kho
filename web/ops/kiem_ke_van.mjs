// KHO-4 VIỆC 2–5 — cập nhật lô mở đầu ván theo kiểm kê. Idempotent (xoá-rồi-ghi). + cross-check.
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'
const NGAY = process.argv[2] || '2026-08-07'
const NGUON = 'KHO _TOGIHOME.xlsx'
const van = JSON.parse(readFileSync(new URL('../../scratch/kk_van.json', import.meta.url)))
const c = new pg.Client(await docConfig()); await c.connect()

async function apply() {
  await c.query('begin')
  const kid = (await c.query("select id from kho.kho where la_mac_dinh limit 1")).rows[0].id
  // xoá bản kiểm kê cũ (idempotent): giao_dich kiem_ke + lô mở đầu (phieu_id null) của ván + nhật ký tóm tắt
  const vanIds = (await c.query("select id from kho.vat_tu where loai='van'")).rows.map(r => r.id)
  await c.query("delete from kho.giao_dich where nguon='kiem_ke' and vat_tu_id = any($1)", [vanIds])
  await c.query("delete from kho.lo_nhap where phieu_id is null and vat_tu_id = any($1)", [vanIds])
  await c.query("delete from kho.nhat_ky_danh_muc where hanh_dong='kiem_ke' and bang='ton'")
  let n38 = 0, n0 = 0
  for (const d of van) {
    const vid = (await c.query('select id from kho.vat_tu where ma=$1', [d.ma])).rows[0].id
    const coTon = d.ton > 0
    // vat_tu: giá tham khảo (CẢ 45) + ngày + dvt tấm + gỡ/giữ cờ (ton>0 -> gỡ)
    await c.query(`update kho.vat_tu set gia_tham_khao=$2, gia_tham_khao_ngay=$3, dvt='tấm',
      can_kiem_tra=$4, sua_luc=now() where id=$1`, [vid, d.gia, NGAY, !coTon])
    // ton: so_luong = tồn; gia_von_bq = giá NẾU có tồn, else NULL (0 tồn -> không có giá vốn)
    await c.query(`insert into kho.ton(vat_tu_id,kho_id,so_luong,gia_von_bq) values($1,$2,$3,$4)
      on conflict (vat_tu_id,kho_id) do update set so_luong=excluded.so_luong, gia_von_bq=excluded.gia_von_bq, sua_luc=now()`,
      [vid, kid, d.ton, coTon ? d.gia : null])
    let loId = null
    if (coTon) {
      loId = (await c.query(`insert into kho.lo_nhap(vat_tu_id,kho_id,so_luong_nhap,gia_von_lo,con_lai,ngay)
        values($1,$2,$3,$4,$3,$5) returning id`, [vid, kid, d.ton, d.gia, NGAY])).rows[0].id
      n38++
    } else n0++
    // giao_dich kiem_ke (thẻ kho): so_luong = tồn kiểm được, so_du_sau = tồn
    await c.query(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,lo_nhap_id,so_du_sau,nguon)
      values($1,$2,'kiem_ke',$3,$4,$3,'kiem_ke')`, [vid, kid, d.ton, loId])
  }
  // SỬA bất biến có sẵn từ seed KHO-1: mã tồn=0 KHÔNG có lô mà gia_von_bq ≠ null -> đặt NULL
  //   (0 tồn không có cơ sở giá vốn; tổng KHÔNG đổi vì 0×giá=0). Đúng nguyên tắc CEO nêu.
  const fix = await c.query(`update kho.ton t set gia_von_bq=null, sua_luc=now()
    where t.so_luong=0 and t.gia_von_bq is not null
      and not exists (select 1 from kho.lo_nhap l where l.vat_tu_id=t.vat_tu_id and l.kho_id=t.kho_id)`)
  if (fix.rowCount) console.log(`  (đã sửa ${fix.rowCount} mã tồn=0 có gia_von_bq nhưng không lô -> NULL; tổng không đổi)`)
  // nhật ký tóm tắt: nguồn file + ngày
  await c.query(`insert into kho.nhat_ky_danh_muc(bang,hanh_dong,thay_doi)
    values('ton','kiem_ke',$1::jsonb)`, [JSON.stringify({ nguon_file: NGUON, ngay: NGAY, so_ma: van.length, co_ton: n38, ton_0: n0, tong_gia_tri: 144003000 })])
  await c.query('commit')
  console.log(`✅ Đã cập nhật ${van.length} ván: ${n38} có tồn (lô+giá vốn+gỡ cờ) · ${n0} tồn 0 (giá vốn NULL, giữ cờ). Giá tham khảo ghi cả 45.`)
}

async function kiem() {
  console.log('\n═══ VIỆC 4 — KIỂM ═══')
  // (1) cross-check mọi mã: ton.so_luong = Σ con_lai · gia_von_bq = BQGQ
  const r = await c.query(`
    select v.ma, v.loai, t.so_luong ton_sl, t.gia_von_bq,
      coalesce(sum(l.con_lai),0) lo_sl,
      case when coalesce(sum(l.con_lai) filter (where l.gia_von_lo is not null),0) > 0
        then round(sum(l.con_lai*l.gia_von_lo) filter (where l.gia_von_lo is not null)
                 / sum(l.con_lai) filter (where l.gia_von_lo is not null))
        else null end bqgq
    from kho.vat_tu v join kho.ton t on t.vat_tu_id=v.id
    left join kho.lo_nhap l on l.vat_tu_id=v.id and l.kho_id=t.kho_id
    group by v.ma, v.loai, t.so_luong, t.gia_von_bq`)
  const lechSL = r.rows.filter(x => Math.abs(Number(x.ton_sl) - Number(x.lo_sl)) > 0.001)
  const lechBQ = r.rows.filter(x => {
    const a = x.gia_von_bq == null ? null : Math.round(Number(x.gia_von_bq))
    const b = x.bqgq == null ? null : Math.round(Number(x.bqgq))
    return a !== b
  })
  console.log(`  mã kiểm: ${r.rows.length}`)
  console.log(lechSL.length ? `  ❌ LỆCH so_luong≠Σlô: ${lechSL.map(x => `${x.ma}(${x.ton_sl}≠${x.lo_sl})`).join(', ')}` : '  ✅ ton.so_luong = Σ con_lai các lô (mọi mã)')
  console.log(lechBQ.length ? `  ❌ LỆCH gia_von_bq≠BQGQ: ${lechBQ.map(x => `${x.ma}(${x.gia_von_bq}≠${x.bqgq})`).join(', ')}` : '  ✅ ton.gia_von_bq = BQGQ từ lô (mọi mã)')

  // (2) tổng tồn ván + phụ kiện
  const t = await c.query(`select v.loai, round(coalesce(sum(t.so_luong*t.gia_von_bq),0)) tong,
      count(*) filter (where t.gia_von_bq is not null) co_gia, count(*) filter (where t.gia_von_bq is null) khong_gia
    from kho.vat_tu v join kho.ton t on t.vat_tu_id=v.id group by v.loai`)
  const m = Object.fromEntries(t.rows.map(x => [x.loai, x]))
  const tien = n => Number(n).toLocaleString('vi-VN')
  console.log(`  Ván: có giá vốn ${m.van.co_gia} · NULL ${m.van.khong_gia} · TỔNG ${tien(m.van.tong)} đ (cần 144.003.000)`)
  console.log(`  Phụ kiện: TỔNG ${tien(m.pk.tong)} đ (cần 233.054.400)`)
  const okVan = Number(m.van.tong) === 144003000, okPk = Number(m.pk.tong) === 233054400
  if (!okVan) { console.log('  ❌ TỔNG VÁN SAI — DỪNG'); process.exit(3) }
  if (!okPk) { console.log('  ❌ TỔNG PHỤ KIỆN ĐỔI — DỪNG'); process.exit(3) }
  if (lechSL.length || lechBQ.length) { console.log('  ❌ CÓ MÃ LỆCH CROSS-CHECK — DỪNG'); process.exit(3) }
  console.log('  ✅ ĐẠT: tổng ván 144.003.000 · tổng phụ kiện 233.054.400 · cross-check sạch')
}

try { await apply(); await kiem() } catch (e) { console.error('❌ LỖI:', e.message); process.exit(2) } finally { await c.end() }
