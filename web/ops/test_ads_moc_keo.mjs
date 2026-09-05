// TEST WP-91 (i)+(ii) L-91.1 · ads_moc_keo: sổ mốc kéo + khoá tự hết hạn + đèn trễ (db/229). tx-rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
const cfg = await docConfig(); cfg.statement_timeout = 20000
const c = new pg.Client(cfg); await c.connect()
const attempt = async fn => { await c.query('savepoint s'); try { const r = await fn(); return { ok: true, r } } catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: (e.message || '').split('\n')[0] } } }
// đèn của 1 nguồn từ RPC
const den = async (nguon) => {
  const j = (await c.query("select kho.ads_tinh_trang_keo() j")).rows[0].j
  return (j.nguon || []).find(x => x.nguon === nguon)
}
// chèn 1 lượt 'xong' cho nguồn với ket_thuc cách đây h giờ (owner, bỏ qua grant)
const chenXong = async (nguon, gioTruoc) =>
  c.query("insert into kho.ads_moc_keo(nguon,bat_dau_luc,ket_thuc_luc,trang_thai,so_dong_ghi) values($1, now()-make_interval(hours=>$2), now()-make_interval(hours=>$2), 'xong', 10)", [nguon, gioTruoc])

try {
  await c.query('begin')
  // CÔ LẬP: xoá mốc thật TRONG TX (rollback trả lại) — đèn/chua_chay không bị mốc backfill prod che.
  await c.query('delete from kho.ads_moc_keo')

  // ── vế 1: trễ 1h→xanh · 10h→vàng · 40h→đỏ (ngưỡng 8/26) ──
  await c.query('savepoint v1'); await chenXong('meta_chi_ad', 1)
  ok('1a trễ 1h → XANH', (await den('meta_chi_ad'))?.den === 'xanh', JSON.stringify(await den('meta_chi_ad')))
  await c.query('rollback to savepoint v1'); await c.query('savepoint v1b'); await chenXong('meta_chi_ad', 10)
  ok('1b trễ 10h → VÀNG', (await den('meta_chi_ad'))?.den === 'vang', JSON.stringify(await den('meta_chi_ad')))
  await c.query('rollback to savepoint v1b'); await c.query('savepoint v1c'); await chenXong('meta_chi_ad', 40)
  const d40 = await den('meta_chi_ad')
  ok('1c trễ 40h → ĐỎ · tre_gio≈40', d40?.den === 'do' && Number(d40.tre_gio) >= 39, JSON.stringify(d40))
  await c.query('rollback to savepoint v1c')

  // ── vế 2: nguồn CHƯA CHẠY → 'chua_chay', KHÔNG đỏ, KHÔNG 0 ──
  const d0 = await den('gop_ky')
  ok("2 chưa chạy lần nào → den='chua_chay' · tre_gio=null (không đỏ, không 0)",
    d0?.den === 'chua_chay' && d0.tre_gio === null && d0.lan_xong_luc === null, JSON.stringify(d0))

  // ── vế 3: khoá CÒN HẠN → lượt thứ hai cùng nguồn bị chặn ──
  await c.query('savepoint v3')
  const m1 = await attempt(() => c.query("select kho.ads_moc_keo_ghi('mo','meta_chi_chien_dich') g"))
  const m2 = await attempt(() => c.query("select kho.ads_moc_keo_ghi('mo','meta_chi_chien_dich') g"))
  ok('3 khoá còn hạn → lượt 2 cùng nguồn CHẶN', m1.ok && !m2.ok && /đang chạy|chặn lượt trùng/.test(m2.msg || ''), m2.msg)
  await c.query('rollback to savepoint v3')

  // ── vế 4 (QUAN TRỌNG NHẤT): khoá QUÁ hạn → lượt mới CHẠY ĐƯỢC (bài học WP-70) ──
  await c.query('savepoint v4')
  const o1 = (await c.query("select kho.ads_moc_keo_ghi('mo','gop_ky') g")).rows[0].g
  // giả lập lượt chết: đẩy khoá về quá khứ (finally không chạy)
  await c.query("update kho.ads_moc_keo set khoa_het_han_luc = now()-interval '1 min' where id=$1", [o1.id])
  const o2 = await attempt(() => c.query("select kho.ads_moc_keo_ghi('mo','gop_ky') g"))
  const cuLoi = +(await c.query("select count(*) n from kho.ads_moc_keo where id=$1 and trang_thai='loi'", [o1.id])).rows[0].n
  const moiChay = o2.ok && +(await c.query("select count(*) n from kho.ads_moc_keo where nguon='gop_ky' and trang_thai='dang_chay' and khoa_het_han_luc>now()")).rows[0].n === 1
  ok('4 khoá QUÁ hạn → lượt mới CHẠY ĐƯỢC + thu hồi lượt treo cũ thành loi', o2.ok && moiChay && cuLoi === 1, (o2.msg || '') + ` cuLoi=${cuLoi}`)
  await c.query('rollback to savepoint v4')

  // ── vế 5: lượt kết thúc LỖI → trang_thai='loi' · RPC trả lượt lỗi gần nhất ──
  await c.query('savepoint v5')
  const e1 = (await c.query("select kho.ads_moc_keo_ghi('mo','meta_chi_ad') g")).rows[0].g
  await c.query("select kho.ads_moc_keo_ghi('loi', null, $1, null, null, null, 'Meta 190: token hết hạn')", [e1.id])
  const tt = (await c.query("select trang_thai, loi_van_ban from kho.ads_moc_keo where id=$1", [e1.id])).rows[0]
  const dLoi = await den('meta_chi_ad')
  ok("5 lượt lỗi → trang_thai='loi' · RPC trả lỗi gần nhất",
    tt.trang_thai === 'loi' && dLoi?.loi_gan_nhat && /token hết hạn/.test(dLoi.loi_gan_nhat.van_ban || ''), JSON.stringify({ tt, loi: dLoi?.loi_gan_nhat }))
  await c.query('rollback to savepoint v5')

  // ── vế 6: client (JWT vai thật) INSERT thẳng ads_moc_keo → 403 ──
  await c.query('savepoint v6')
  const uid = (await c.query("select auth_uid a from kho.nguoi_dung where vai_tro='ads_user' and auth_uid is not null limit 1")).rows[0]?.a
    || (await c.query("select auth_uid a from kho.nguoi_dung where auth_uid is not null limit 1")).rows[0]?.a
  const v6 = await attempt(async () => {
    await c.query('set local role authenticated')
    await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
    await c.query("insert into kho.ads_moc_keo(nguon) values('meta_chi_ad')")
  })
  await c.query('reset role')
  ok('6 client (authenticated) INSERT thẳng → 403 permission denied', !v6.ok && /permission denied/i.test(v6.msg || ''), v6.msg)
  await c.query('rollback to savepoint v6')

  // ── vế 9: lượt kết thúc LỖI → khoá NHẢ NGAY → lượt mới chạy được (KHÔNG chờ hết hạn) ──
  await c.query('savepoint v9')
  const a9 = (await c.query("select kho.ads_moc_keo_ghi('mo','gop_ky') g")).rows[0].g
  await c.query("select kho.ads_moc_keo_ghi('loi',null,$1,null,null,null,'kéo giả lập ném lỗi giữa chừng')", [a9.id])
  const nhaLoi = (await c.query("select trang_thai, khoa_het_han_luc from kho.ads_moc_keo where id=$1", [a9.id])).rows[0]
  const b9 = await attempt(() => c.query("select kho.ads_moc_keo_ghi('mo','gop_ky') g"))   // NGAY sau, không chờ hết hạn
  ok('9 lượt lỗi → sổ có dòng loi + khoá NHẢ ngay → lượt mới chạy được',
    nhaLoi.trang_thai === 'loi' && nhaLoi.khoa_het_han_luc === null && b9.ok && b9.r.rows[0].g.id !== a9.id, (b9.msg || '') + ` khoa=${nhaLoi.khoa_het_han_luc}`)
  await c.query('rollback to savepoint v9')

  // ── vế 10: hai lượt "song song" cùng nguồn → đúng MỘT ghi (dang_chay), lượt kia bị chặn (wrapper thoát mã 0) ──
  await c.query('savepoint v10')
  const x1 = await attempt(() => c.query("select kho.ads_moc_keo_ghi('mo','meta_chi_ad') g"))
  const x2 = await attempt(() => c.query("select kho.ads_moc_keo_ghi('mo','meta_chi_ad') g"))
  const dc = +(await c.query("select count(*) n from kho.ads_moc_keo where nguon='meta_chi_ad' and trang_thai='dang_chay' and khoa_het_han_luc>now()")).rows[0].n
  ok('10 hai lượt song song cùng nguồn → đúng MỘT dang_chay · lượt 2 bị chặn (thoát mã 0)',
    x1.ok && !x2.ok && /đang chạy|chặn lượt trùng/.test(x2.msg || '') && dc === 1, `dc=${dc} · x2=${x2.msg}`)
  await c.query('rollback to savepoint v10')

  // ── ĐÈN ĐỦ-SỐ (35 ngày) — tách khỏi dải trễ-giờ ──
  const doPhu = async () => (await c.query("select kho.ads_tinh_trang_keo() j")).rows[0].j.do_phu
  const monKeo = async (tu, den) => c.query("insert into kho.ads_moc_keo(nguon,bat_dau_luc,ket_thuc_luc,trang_thai,khoang_tu,khoang_den) values('meta_chi_ad',now(),now(),'xong',$1,$2)", [tu, den])

  // ── vế 11: đủ 35/35 ngày → dải đủ-số XANH ──
  await c.query('savepoint v11'); await c.query('delete from kho.ads_moc_keo')
  await monKeo('2026-08-02', '2026-09-05')   // phủ trọn cửa sổ 35 ngày (current_date=2026-09-05)
  const p11 = await doPhu()
  ok('11 đủ 35/35 → dải đủ-số XANH · thiếu 0', p11.dai_du_so === 'xanh' && p11.so_ngay_co === 35 && p11.thieu_so_ngay === 0, JSON.stringify(p11))
  await c.query('rollback to savepoint v11')

  // ── vế 12: thiếu ĐÚNG 2 ngày → VÀNG ──
  await c.query('savepoint v12'); await c.query('delete from kho.ads_moc_keo')
  await monKeo('2026-08-04', '2026-09-05')   // bỏ 02,03/08 = thiếu 2 ngày
  const p12 = await doPhu()
  ok('12 thiếu đúng 2 ngày → VÀNG', p12.dai_du_so === 'vang' && p12.thieu_so_ngay === 2, JSON.stringify(p12))
  await c.query('rollback to savepoint v12')

  // ── vế 13: tình trạng THẬT-cũ (chỉ 22/08–31/08) → ĐỎ · khoảng thiếu GỘP đúng 2 (không 25 rời) ──
  await c.query('savepoint v13'); await c.query('delete from kho.ads_moc_keo')
  await monKeo('2026-08-22', '2026-08-31')
  const p13 = await doPhu()
  ok('13 chỉ 22–31/08 → ĐỎ · khoảng thiếu gộp đúng 2 (02–21/08 + 01–05/09)',
    p13.dai_du_so === 'do' && Array.isArray(p13.khoang_thieu) && p13.khoang_thieu.length === 2, JSON.stringify(p13.khoang_thieu))
  await c.query('rollback to savepoint v13')

  // ── vế 14: sổ mốc RỖNG → "chua_co_du_lieu" (KHÔNG thiếu 35, KHÔNG chia 0) ──
  await c.query('savepoint v14'); await c.query('delete from kho.ads_moc_keo')
  const p14 = await doPhu()
  ok('14 sổ mốc RỖNG → dải "chua_co_du_lieu" · thiếu=null · so_ngay_co=null',
    p14.dai_du_so === 'chua_co_du_lieu' && p14.thieu_so_ngay === null && p14.so_ngay_co === null, JSON.stringify(p14))
  await c.query('rollback to savepoint v14')

} finally { await c.query('rollback') }
// xác nhận sạch: 0 dòng ads_moc_keo còn lại do test (đã rollback)
const con = +(await c.query("select count(*) n from kho.ads_moc_keo")).rows[0].n
console.log(`\n── ads_moc_keo prod sau rollback: ${con} dòng THẬT (mốc backfill D2 — hợp lệ; phần của test đã rollback sạch) ──`)
await c.end()
console.log(`═══ test_ads_moc_keo: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
