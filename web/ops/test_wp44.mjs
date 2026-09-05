// TEST CẮN — WP-44 (db/163): ngay_giao_hua CTP = ATP(tải) + thiếu vật tư + lead. Tx rollback, KHÔNG đụng T8-001.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = []) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const uid = async v => (await one(`select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null order by ho_ten limit 1`, [v]))?.a
const U = { ceo: await uid('ceo'), thiet_ke: await uid('thiet_ke'), sale: await uid('sale') }
const TK_NS = (await one(`select id from kho.nguoi_dung where auth_uid=$1`, [U.thiet_ke])).id
let T8   // [L-20] fixture TỰ-SEED trong tx (T8-001 đã xoá lúc dọn demo L-14) — gán sau begin
const TH = (await one(`select ma from kho.thuong_hieu limit 1`)).ma
const KE_SP = 'CAN-A-KE-TIVI-BT'   // lõi KE-HO-MELAMINE → quy trình cat,dan,cam,thung,goi
async function seedTemplate(ma) {
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai) values($1,'seed template',true,'le','moi_len_don') returning id`, [ma])).id
  const nm = (await one(`insert into kho.don_hang_mon(don_id,ten,sp_id,so_luong,gia,dung_moi) values($1,'Món seed',$2,1,1000000,false) returning id`, [did, KE_SP])).id
  for (const hd of ['cat', 'dan', 'cam', 'thung', 'goi'])
    await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,nguon,moc) values($1,$2,10,'go_tay','chuan')`, [nm, hd])
  const vt = (await one(`select vat_tu_id from kho.v_ton_kha_dung where kha_dung > 6 limit 1`)).vat_tu_id
  await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc,hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung)
    values($1,$2,5,'tam','go_tay','chuan','cat',0,5,1)`, [nm, vt])
  // vật tư thứ 2 KHÔNG gia_ncc (T8-001 có vật tư trộn) — cho vế thiếu-lead-mặc-định (12.4)
  const vt2 = (await one(`select v.id from kho.vat_tu v where not exists(select 1 from kho.gia_ncc g where g.vat_tu_id=v.id) limit 1`)).id
  await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc,hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung)
    values($1,$2,3,'tam','go_tay','chuan','dan',0,3,1)`, [nm, vt2])
  await c.query(`set local session_replication_role='origin'`)
  return did
}
const KHO = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
const NCC = (await one(`select id from kho.nha_cung_cap limit 1`)).id
const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: 'wp44/cat.dxf', ten_goc: 'cat.dxf', co_byte: 100 }])
const homNay = (await one(`select current_date::text d`)).d   // 'YYYY-MM-DD' (tránh lệch múi giờ)
const iso = x => String(x).slice(0, 10)
const cong = (base, n) => new Date(Date.parse(iso(base) + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)

async function mkDon(sfx, hen, tt = 'moi_len_don') {
  const ma = 'DEMO-WP44-' + sfx
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach,ma_ns_thiet_ke,ngay_hen_khach)
    values($1,'DEMO wp44 ${sfx}',true,'le',$2,$3,'gioi_thieu',$4,$5) returning id`, [ma, tt, TH, TK_NS, hen])).id
  for (const m of await q(`select id,ten,sp_id,ma_quy_trinh,dung_moi,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh from kho.don_hang_mon where don_id=$1`, [T8])) {
    const nm = (await one(`insert into kho.don_hang_mon(don_id,ten,sp_id,ma_quy_trinh,dung_moi,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh)
      values($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, [did, m.ten, m.sp_id, m.ma_quy_trinh, m.vl, m.kt, m.so_luong, m.gia, m.ma_mau, m.chi_tiet, m.khong_gian, m.anh])).id
    // BOM: du_kien luôn có; nếu tt cần chuẩn thì test tự chốt sau
    await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,nguoi_nhap,moc)
      select $1,hoat_dong,so_don_vi,bieu_thuc,nguon,nguoi_nhap,'chuan' from kho.so_don_vi_mon where mon_id=$2 and moc='chuan'`, [nm, m.id])
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc,hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung)
      select $1,vat_tu_id,so_luong,don_vi,nguon,$3,hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung from kho.don_hang_mon_bom where mon_id=$2 and moc='chuan'`, [nm, m.id, tt === 'bao_gia' ? 'du_kien' : 'chuan'])
  }
  await c.query(`set local session_replication_role='origin'`)
  return { ma, did }
}
const vatTu = async (did, moc) => await q(`select b.vat_tu_id, max(v.ten) ten, sum(b.so_luong_co_so) can from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id=b.mon_id join kho.vat_tu v on v.id=b.vat_tu_id where m.don_id=$1 and b.moc=$2 and b.so_luong_co_so is not null group by b.vat_tu_id`, [did, moc])
async function setTon(vt, sl) { await c.query(`set local session_replication_role='replica'`); await c.query(`delete from kho.ton where vat_tu_id=$1 and kho_id=$2`, [vt, KHO]); await c.query(`insert into kho.ton(vat_tu_id,kho_id,so_luong,gia_von_bq) values($1,$2,$3,0)`, [vt, KHO, sl]); await c.query(`set local session_replication_role='origin'`) }
async function duHet(did, moc) { for (const r of await vatTu(did, moc)) await setTon(r.vat_tu_id, Number(r.can) + 1000) }  // mọi vật tư dư
const goi = async ma => { const r = await as(U.ceo, `select kho.ngay_giao_hua($1) j`, [ma]); return { j: r.r && r.r[0].j, e: r.e } }

await c.query('begin')
const before = (await one(`select count(*)::int n from kho.don_hang`)).n
T8 = await seedTemplate('DEMO-WP44-SEED')   // [L-20] template trong tx (rollback sạch)

// ═══ 11.1 · ĐỦ vật tư → ngày = tải · vat_tu_dang_doan rỗng ═══
{ const D = await mkDon('A', null); await duHet(D.did, 'chuan')
  const { j } = await goi(D.ma)
  console.log(`   11.1 ngay_hua=${iso(j.ngay_hua)} · ngay_theo_vat_tu=${iso(j.ngay_theo_vat_tu)} · ngay_theo_tai=${j.ngay_theo_tai?iso(j.ngay_theo_tai):'—'} · doan=${JSON.stringify(j.vat_tu_dang_doan)}`)
  ok('11.1 đủ vật tư: ngay_theo_vat_tu=hôm nay · vat_tu_dang_doan rỗng · ngày=tải',
    iso(j.ngay_theo_vat_tu) === iso(homNay) && j.vat_tu_dang_doan.length === 0 && j.ngay_theo_tai && iso(j.ngay_hua) === iso(j.ngay_theo_tai), JSON.stringify(j.can_cu)) }

// ═══ 11.2 · THIẾU ván CÓ lead trong gia_ncc → dời theo lead đó · doan rỗng ═══
{ const D = await mkDon('B', null); await duHet(D.did, 'chuan')
  const vts = await vatTu(D.did, 'chuan'); const tgt = vts[0]
  await c.query(`set local session_replication_role='replica'`)
  await c.query(`delete from kho.gia_ncc where vat_tu_id=$1`, [tgt.vat_tu_id])
  await c.query(`insert into kho.gia_ncc(ncc_id,vat_tu_id,don_vi,don_gia,lead_time_ngay,ap_dung_tu) values($1,$2,'tam',1000,30,current_date)`, [NCC, tgt.vat_tu_id])
  await c.query(`set local session_replication_role='origin'`)
  await setTon(tgt.vat_tu_id, 0)
  const { j } = await goi(D.ma)
  console.log(`   11.2 thiếu "${tgt.ten}" lead 30 → ngay_theo_vat_tu=${iso(j.ngay_theo_vat_tu)} (kỳ vọng ${cong(homNay,30)}) · doan=${JSON.stringify(j.vat_tu_dang_doan)}`)
  ok('11.2 thiếu ván CÓ lead: ngay_theo_vat_tu=hôm nay+30 · doan rỗng · can_cu nêu tên+ngày',
    iso(j.ngay_theo_vat_tu) === cong(homNay, 30) && j.vat_tu_dang_doan.length === 0 && j.can_cu.some(s => s.includes(tgt.ten) && /lead 30/.test(s)), JSON.stringify(j.can_cu)) }

// ═══ 11.3 · THIẾU vật tư KHÔNG gia_ncc → lead mặc định 7 · TÊN trong doan · do_tin='uoc' ═══
{ const D = await mkDon('C', null); await duHet(D.did, 'chuan')
  const vts = await vatTu(D.did, 'chuan'); const tgt = vts[0]
  await c.query(`set local session_replication_role='replica'`); await c.query(`delete from kho.gia_ncc where vat_tu_id=$1`, [tgt.vat_tu_id]); await c.query(`set local session_replication_role='origin'`)
  await setTon(tgt.vat_tu_id, 0)
  const { j } = await goi(D.ma)
  console.log(`   11.3 thiếu "${tgt.ten}" KHÔNG gia_ncc → ngay_theo_vat_tu=${iso(j.ngay_theo_vat_tu)} (kỳ vọng ${cong(homNay,7)}) · do_tin=${j.do_tin}`)
  console.log(`        vat_tu_dang_doan = ${JSON.stringify(j.vat_tu_dang_doan)}`)
  ok('11.3 thiếu không gia_ncc: lead 7 · TÊN trong vat_tu_dang_doan · do_tin=uoc',
    iso(j.ngay_theo_vat_tu) === cong(homNay, 7) && j.vat_tu_dang_doan.includes(tgt.ten) && j.do_tin === 'uoc', JSON.stringify(j)) }

// ═══ 11.4 · Hạ 1 tổ năng lực → ngày (theo tải) đổi ═══
{ const D = await mkDon('D', null); await duHet(D.did, 'chuan')
  const t0 = (await goi(D.ma)).j
  // hạ TẤT CẢ tổ xuống rất thấp → atp phải đẩy ngày theo tải ra xa (hoặc báo không xếp nổi)
  await c.query(`savepoint p114`)
  await c.query(`update kho.nang_luc_to set gio_moi_ngay=0.02 where den_ngay is null`)
  const t1 = (await goi(D.ma)).j
  await c.query(`rollback to savepoint p114`)
  console.log(`   11.4 ngay_theo_tai trước=${t0.ngay_theo_tai?iso(t0.ngay_theo_tai):'—'} · sau hạ năng lực=${t1.ngay_theo_tai?iso(t1.ngay_theo_tai):'—'} (ok=${t1.ok})`)
  ok('11.4 hạ năng lực → ngày theo tải LÙI (hoặc atp báo không xếp nổi)',
    t0.ngay_theo_tai && (t1.ngay_theo_tai == null || new Date(t1.ngay_theo_tai) > new Date(t0.ngay_theo_tai)), `${t0.ngay_theo_tai} vs ${t1.ngay_theo_tai}`) }

// ═══ 11.5 · HAI CỬA: báo giá (du_kien) vs thường (chuan) cùng dữ liệu → CÙNG ngày; báo giá 'uoc' + nhãn ═══
{ const Dq = await mkDon('E', null, 'bao_gia'); await duHet(Dq.did, 'du_kien')
  const jq = (await goi(Dq.ma)).j
  console.log(`   11.5 báo giá: moc=${jq.moc_bom} · nhan=${jq.nhan_moc} · do_tin=${jq.do_tin} · ngay_theo_tai=${jq.ngay_theo_tai?iso(jq.ngay_theo_tai):'—'}`)
  ok('11.5 đơn báo giá dùng BOM du_kien · nhãn "ước theo BOM dự kiến" · do_tin=uoc',
    jq.moc_bom === 'du_kien' && /dự kiến/.test(jq.nhan_moc) && jq.do_tin === 'uoc', JSON.stringify(jq.cac_gia_dinh))
  // đơn thường cùng dữ liệu (chuan, cùng vật tư đủ) → ngày theo tải bằng nhau
  const Dn = await mkDon('F', null); await duHet(Dn.did, 'chuan')
  const jn = (await goi(Dn.ma)).j
  console.log(`        thường: ngay_theo_tai=${jn.ngay_theo_tai?iso(jn.ngay_theo_tai):'—'}`)
  ok('11.5 hai cửa RA CÙNG ngày theo tải (cùng quy trình/năng lực)',
    jq.ngay_theo_tai && jn.ngay_theo_tai && iso(jq.ngay_theo_tai) === iso(jn.ngay_theo_tai), `${jq.ngay_theo_tai} vs ${jn.ngay_theo_tai}`) }

// ═══ 11.6 · PO đang về đủ → lấy ngay_ncc_hen thay lead mua mới ═══
{ const D = await mkDon('G', null); await duHet(D.did, 'chuan')
  const vts = await vatTu(D.did, 'chuan'); const tgt = vts[0]; const henPO = cong(homNay, 12)
  await setTon(tgt.vat_tu_id, 0)
  await c.query(`set local session_replication_role='replica'`)
  const dm = (await one(`insert into kho.don_mua(so_don,ncc_id,kho_id,ngay_dat,ngay_can,ngay_ncc_hen,trang_thai,tao_boi) values('PO-WP44-'||floor(random()*1e6),$1,$2,current_date,$3,$3,'xac_nhan',$4) returning id`, [NCC, KHO, henPO, TK_NS])).id
  await c.query(`insert into kho.don_mua_dong(don_mua_id,stt,vat_tu_id,so_luong,dvt) values($1,1,$2,$3,'cai')`, [dm, tgt.vat_tu_id, Number(tgt.can) + 100])
  await c.query(`set local session_replication_role='origin'`)
  const { j } = await goi(D.ma)
  console.log(`   11.6 PO hẹn ${henPO} · ngay_theo_vat_tu=${iso(j.ngay_theo_vat_tu)} (kỳ vọng ${henPO}, KHÔNG phải +7) · can_cu=${JSON.stringify(j.can_cu.filter(s=>s.includes('lô đang về')))}`)
  ok('11.6 PO đang về đủ → ngay_theo_vat_tu = ngay_ncc_hen (không lead mua mới)',
    iso(j.ngay_theo_vat_tu) === henPO && j.can_cu.some(s => /lô đang về/.test(s)), JSON.stringify(j.can_cu)) }

// ═══ 11.7 · đơn ĐÃ KHOÁ lịch → vẫn trả lời, xep_lich KHÔNG đổi ═══
{ const D = await mkDon('H', cong(homNay, 56)); await duHet(D.did, 'chuan')
  // bàn giao GIỮ (jwt ceo, không savepoint) để đơn thật khoá + có xep_lich
  await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ceo, role: 'authenticated' })])
  await c.query(`select kho.ban_giao_xuong($1,'${FILE}'::jsonb,null)`, [D.ma])
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  const n0 = (await one(`select count(*)::int n, to_char(min(tuan_bat_dau),'YYYY-MM-DD') w from kho.xep_lich where ma_don=$1`, [D.ma]))
  const khoa = (await one(`select khoa_lich_luc is not null k from kho.don_hang where ma_don=$1`, [D.ma])).k
  const { j, e } = await goi(D.ma)
  const n1 = (await one(`select count(*)::int n, to_char(min(tuan_bat_dau),'YYYY-MM-DD') w from kho.xep_lich where ma_don=$1`, [D.ma]))
  console.log(`   11.7 khoá=${khoa} · ngay_giao_hua ok=${j?.ok} · xep_lich trước=${n0.n}/${n0.w} sau=${n1.n}/${n1.w}`)
  ok('11.7 đơn đã khoá: ngay_giao_hua vẫn trả lời + xep_lich KHÔNG đổi dòng nào',
    !e && j?.ok === true && n0.n === n1.n && n0.w === n1.w, e || JSON.stringify({ n0, n1 })) }

// ══ 12.x [L-27 db/164] nhãn độ tin: bỏ he_so khỏi giả định, ③ theo đơn ══
const toCua = async did => { const ma = (await one(`select ma_don from kho.don_hang where id=$1`, [did])).ma_don; return (await q(`select distinct ma_to from kho.sched_buoc($1,'chuan') where ma_to is not null`, [ma])).map(r => r.ma_to) }
async function gatTat() {   // xác nhận năng lực CÓ GIỮ (as() cuốn savepoint → không dùng)
  const tos = await q(`select distinct ma_to from kho.nang_luc_to where den_ngay is null`)
  await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ceo, role: 'authenticated' })])
  for (const t of tos) await c.query(`select kho.nl_xac_nhan($1)`, [t.ma_to])
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
}
async function setGat(maTo, v) { await c.query(`set local session_replication_role='replica'`); await c.query(`update kho.nang_luc_to set xac_nhan=$1 where den_ngay is null and ma_to=$2`, [v, maTo]); await c.query(`set local session_replication_role='origin'`) }

// 12.1 · BOM chuan + vật tư đủ + 7/7 gật (he_so vẫn 0,88) → 'cao' · cach_tinh nêu 0,88
{ const D = await mkDon('L1', null); await duHet(D.did, 'chuan'); await gatTat()
  const j = (await goi(D.ma)).j
  console.log(`   12.1 do_tin=${j.do_tin} · cach_tinh=${JSON.stringify(j.cach_tinh)} · cac_gia_dinh=${JSON.stringify(j.cac_gia_dinh)}`)
  ok("12.1 sạch hết + he_so 0,88 → do_tin='cao' · cach_tinh nêu 0,88 (nhãn sống lại)",
    j.do_tin === 'cao' && j.cac_gia_dinh.length === 0 && (j.cach_tinh || []).some(s => /0,88/.test(s)), JSON.stringify(j))
  const toDon = await toCua(D.did)
  // 12.2 · để 1 tổ ĐƠN NÀY DÙNG chưa gật → 'uoc' + tên tổ
  await c.query('savepoint p122'); await setGat(toDon[0], false)
  const j2 = (await goi(D.ma)).j
  const tenTo = (await one(`select coalesce(ts.ten, $1) t from kho.to_san_xuat ts where ts.ma_to=$1`, [toDon[0]]))?.t || toDon[0]
  console.log(`   12.2 tổ ĐÙNG "${toDon[0]}"(${tenTo}) chưa gật → do_tin=${j2.do_tin} · cac_gia_dinh=${JSON.stringify(j2.cac_gia_dinh)}`)
  ok("12.2 tổ đơn DÙNG chưa gật → 'uoc' · căn cứ nêu ĐÚNG tên tổ",
    j2.do_tin === 'uoc' && j2.cac_gia_dinh.some(s => s.includes(tenTo) && /chưa ai xác nhận/.test(s)), JSON.stringify(j2.cac_gia_dinh))
  await c.query('rollback to savepoint p122')
  // 12.3 · để 1 tổ ĐƠN NÀY KHÔNG DÙNG chưa gật → vẫn 'cao'
  const toKhac = (await q(`select distinct ma_to from kho.nang_luc_to where den_ngay is null`)).map(r => r.ma_to).find(t => !toDon.includes(t))
  await c.query('savepoint p123'); await setGat(toKhac, false)
  const j3 = (await goi(D.ma)).j
  console.log(`   12.3 tổ KHÔNG dùng "${toKhac}" chưa gật → do_tin=${j3.do_tin} (đơn dùng: ${toDon.join(',')})`)
  ok("12.3 tổ đơn KHÔNG dùng chưa gật → vẫn 'cao' (③ theo đơn)", j3.do_tin === 'cao', `to_khac=${toKhac} · ${JSON.stringify(j3.cac_gia_dinh)}`)
  await c.query('rollback to savepoint p123') }

// 12.4 · BOM du_kien → uoc; thiếu lead → uoc (không nới nhầm)
{ await gatTat()
  const Dd = await mkDon('L4', null, 'bao_gia'); await duHet(Dd.did, 'du_kien')
  const jd = (await goi(Dd.ma)).j
  ok("12.4 BOM du_kien → vẫn 'uoc'", jd.do_tin === 'uoc' && jd.cac_gia_dinh.some(s => /dự kiến/.test(s)), JSON.stringify(jd.cac_gia_dinh))
  const Dt = await mkDon('L5', null); await duHet(Dt.did, 'chuan')
  // target = vật tư đơn dùng mà KHÔNG có gia_ncc → thiếu nó = lead mặc định (② cháy)
  const tgt = (await one(`select b.vat_tu_id from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id=b.mon_id
    where m.don_id=$1 and b.moc='chuan' and b.so_luong_co_so is not null
      and not exists(select 1 from kho.gia_ncc g where g.vat_tu_id=b.vat_tu_id) limit 1`, [Dt.did]))
  await setTon(tgt.vat_tu_id, 0)
  const jt = (await goi(Dt.ma)).j
  console.log(`   12.4 du_kien do_tin=${jd.do_tin} · thiếu-lead do_tin=${jt.do_tin}`)
  ok("12.4 thiếu lead → vẫn 'uoc'", jt.do_tin === 'uoc' && jt.cac_gia_dinh.some(s => /lead mặc định/.test(s)), JSON.stringify(jt.cac_gia_dinh)) }

await c.query('rollback')
const after = (await one(`select count(*)::int n from kho.don_hang`)).n
ok('DỌN · rollback sạch, T8-001 KHÔNG chạm', before === after, `${before} vs ${after}`)
ok('DỌN · xep_lich prod = 0', (await one(`select count(*)::int n from kho.xep_lich`)).n === 0)
console.log(`\nKẾT QUẢ test_wp44: ${P} pass / ${F} fail`)
await c.end(); process.exit(F ? 1 : 0)
