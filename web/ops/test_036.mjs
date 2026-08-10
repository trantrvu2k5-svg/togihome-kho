// TEST PHẢI CẮN (DB-logic) — 036: vai tk_ban_hang · vòng đời báo giá thua/treo · giờ thực · gio_theo_ket_qua.
//   Áp 036 trong tx rồi ROLLBACK. (App-integration test bằng browser thật trên deploy — file riêng.)
import { readFileSync } from 'fs'; import pg from 'pg'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync('/Users/vuquanghai/Documents/togihome-kho/db/036_bao_gia_thua_tk_ban_hang.sql','utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e', tk_ban_hang:'0f0535bd' }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 9000 })
await c.connect()
let P=0,F=0; const ok=(n,cond,e='')=>{console.log((cond?'✅':'❌')+' '+n+(e?'  — '+e:''));cond?P++:F++}
const q=async(s,a=[])=>(await c.query(s,a)).rows
async function asRole(uid, sql, args=[]) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,err=null; try{ r=(await c.query(sql,args)).rows }catch(e){ err=e.message }
  finally{ try{await c.query('rollback to savepoint s')}catch(_){}; await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)") }
  return {rows:r, err}
}
async function updAs(uid, sql, args=[]) {
  await c.query('savepoint u'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let err=null; try{ await c.query(sql,args) }catch(e){ err=e.message }
  if (err) { await c.query('rollback to savepoint u') } else { await c.query('release savepoint u') }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return err
}
try {
  await c.query('begin'); await c.query(sql)
  // uid đầy đủ của tk_ban_hang
  const TKBH = (await q(`select auth_uid from kho.nguoi_dung where vai_tro='tk_ban_hang' limit 1`))[0]?.auth_uid
  const tkbhNs = (await q(`select id from kho.nguoi_dung where auth_uid=$1`,[TKBH]))[0].id
  const tkNs   = (await q(`select id from kho.nguoi_dung where auth_uid=$1`,[U.thiet_ke]))[0].id
  ok('có tài khoản tk_ban_hang', !!TKBH)

  // ── B: tk_ban_hang KHÔNG thấy giá vốn ──
  console.log('\n── B: giá vốn ẩn với tk_ban_hang ──')
  ok('B tham_so_tai_chinh (tiền) → 0 dòng', (await asRole(TKBH,`select dg_gio_tk from kho.tham_so_tai_chinh`)).rows?.length===0)
  ok('B san_pham_mau_gia_von → 0 dòng', (await asRole(TKBH,`select * from kho.san_pham_mau_gia_von limit 1`)).rows?.length===0)
  await c.query(`insert into kho.don_hang(ma_don,dong,trang_thai) values('T36','du_an','bao_gia')`)
  await c.query(`insert into kho.don_hang_gia_von(ma_don,gia_chuyen_giao) values('T36',6500000)`)
  ok('B don_hang_gia_von → 0 dòng', (await asRole(TKBH,`select * from kho.don_hang_gia_von where ma_don='T36'`)).rows?.length===0)
  ok('B ghi_gia_von_don → CHẶN', /chỉ ceo\/kho\/thiet_ke/.test((await asRole(TKBH,`select kho.ghi_gia_von_don('T36',1,1,1,3)`)).err||''))
  ok('B tk_ban_hang ĐỌC được đơn (như sale)', (await asRole(TKBH,`select ma_don from kho.don_hang where ma_don='T36'`)).rows?.length===1)

  // ── C1: bao_gia_thua bắt buộc lý do ──
  console.log('\n── C1: báo giá thua cần lý do ──')
  const e1 = await updAs(U.sale, `update kho.don_hang set trang_thai='bao_gia_thua' where ma_don='T36'`)
  ok('C1 thua KHÔNG lý do → CHẶN', e1 && /lý do/.test(e1), e1||'')
  const e2 = await updAs(U.sale, `update kho.don_hang set trang_thai='bao_gia_thua', ly_do_thua='gia_cao' where ma_don='T36'`)
  ok('C1 thua CÓ lý do → ĐƯỢC', e2===null, e2||'')
  const kt=(await q(`select ngay_ket_thuc_bao_gia from kho.don_hang where ma_don='T36'`))[0].ngay_ket_thuc_bao_gia
  ok('C2 ngay_ket_thuc_bao_gia auto', kt!=null)
  // bite off_thua
  await c.query('savepoint bt'); await c.query(`update kho.don_hang set trang_thai='bao_gia' where ma_don='T36'`)
  await c.query(`select set_config('chan.off_thua','1',true)`)
  const e3 = await updAs(U.sale, `update kho.don_hang set trang_thai='bao_gia_thua' where ma_don='T36'`)
  await c.query(`select set_config('chan.off_thua','',true)`); await c.query('rollback to savepoint bt')
  ok('C1 [CẮN] bỏ off_thua → thua KHÔNG lý do LỌT (ĐỎ)', e3===null, e3||'')

  // ── C3: RLS giờ thực ──
  console.log('\n── C3: RLS giờ thực ──')
  ok('C3 thiet_ke ghi xuong → ĐƯỢC', (await updAs(U.thiet_ke,`insert into kho.gio_thiet_ke_thuc(ma_don,ma_ns,loai_gio,gio_thuc) values('T36','${tkNs}','xuong',4)`))===null)
  ok('C3 thiet_ke ghi ban_hang → CHẶN', (await updAs(U.thiet_ke,`insert into kho.gio_thiet_ke_thuc(ma_don,ma_ns,loai_gio,gio_thuc) values('T36','${tkNs}','ban_hang',4)`))!=null)
  ok('C3 tk_ban_hang ghi ban_hang → ĐƯỢC', (await updAs(TKBH,`insert into kho.gio_thiet_ke_thuc(ma_don,ma_ns,loai_gio,gio_thuc) values('T36','${tkbhNs}','ban_hang',2)`))===null)
  ok('C3 tk_ban_hang ghi xuong → CHẶN', (await updAs(TKBH,`insert into kho.gio_thiet_ke_thuc(ma_don,ma_ns,loai_gio,gio_thuc) values('T36','${tkbhNs}','xuong',2)`))!=null)
  ok('C3 tk_ban_hang ghi hộ NGƯỜI KHÁC → CHẶN', (await updAs(TKBH,`insert into kho.gio_thiet_ke_thuc(ma_don,ma_ns,loai_gio,gio_thuc) values('T36','${tkNs}','ban_hang',2)`))!=null)
  // ghi thật 2 dòng (superuser) cho các test sau
  await c.query(`insert into kho.gio_thiet_ke_thuc(ma_don,ma_ns,loai_gio,gio_thuc) values('T36','${tkbhNs}','ban_hang',2),('T36','${tkNs}','xuong',4)`)
  // đọc: tk_ban_hang chỉ thấy dòng mình
  const rd=(await asRole(TKBH,`select loai_gio from kho.gio_thiet_ke_thuc where ma_don='T36'`)).rows||[]
  ok('C3 tk_ban_hang đọc chỉ dòng MÌNH (ban_hang), không thấy xuong người khác', rd.length>=1 && rd.every(x=>x.loai_gio==='ban_hang'), JSON.stringify(rd))

  // ── C7: plugin đẩy giá vốn kèm giờ → dòng xuong đúng người ──
  console.log('\n── C7: plugin ghi_gia_von_don kèm giờ ──')
  const doc=(await asRole(U.thiet_ke,`select kho.ghi_gia_von_don('T36',3000000,2000000,1500000,6500000,3) j`))
  // asRole rollback -> ghi thật lại (không rollback) để kiểm dòng
  await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:U.thiet_ke,role:'authenticated'})])
  const doc2=(await q(`select kho.ghi_gia_von_don('T36',3000000,2000000,1500000,6500000,3) j`))[0].j
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  const gx=(await q(`select gio_thuc,ma_ns from kho.gio_thiet_ke_thuc where ma_don='T36' and loai_gio='xuong' and gio_thuc=3`))
  ok('C7 đẩy kèm 3 giờ → doc.gio_da_ghi + dòng xuong đúng người', doc2.gio_da_ghi===true && gx.length===1 && gx[0].ma_ns===tkNs)
  // đẩy KHÔNG giờ → vẫn được, báo chưa ghi
  const doc3=(await asRole(U.thiet_ke,`select kho.ghi_gia_von_don('T36',3000000,2000000,1500000,6500000) j`)).rows?.[0]?.j
  ok('C7 đẩy KHÔNG giờ → gio_da_ghi=false (vẫn đẩy)', doc3 && doc3.gio_da_ghi===false)

  // ── C4: gio_theo_ket_qua theo KẾT QUẢ ──
  console.log('\n── C4: gio_theo_ket_qua chuyển nhóm theo kết quả ──')
  await c.query(`update kho.don_hang set ma_ky_ap_dung='2026-07' where ma_don='T36'`)
  // hiện T36 = bao_gia_thua, có giờ (2 ban_hang + 4 xuong + 3 xuong = 9). thua -> tất cả vào BÁN HÀNG
  let gk=(await asRole(U.ceo,`select * from kho.gio_theo_ket_qua('2026-07')`)).rows[0]
  const TONG = Number(gk.gio_ban_hang) + Number(gk.gio_von)
  ok('C4 đơn THUA → mọi giờ vào BÁN HÀNG', TONG>0 && Number(gk.gio_ban_hang)===TONG && Number(gk.gio_von)===0, JSON.stringify(gk))
  // đổi kết quả: thành đơn hàng (moi_len_don) -> mọi giờ vào GIÁ VỐN
  await c.query(`update kho.don_hang set trang_thai='moi_len_don' where ma_don='T36'`)
  gk=(await asRole(U.ceo,`select * from kho.gio_theo_ket_qua('2026-07')`)).rows[0]
  ok('C4 [chuyển nhóm] đổi sang ĐƠN HÀNG → mọi giờ vào GIÁ VỐN', Number(gk.gio_von)===TONG && Number(gk.gio_ban_hang)===0, JSON.stringify(gk))
  ok('C4 gio_theo_ket_qua: sale/tk_ban_hang gọi → CHẶN', /chỉ ceo\/ke_toan/.test((await asRole(TKBH,`select * from kho.gio_theo_ket_qua('2026-07')`)).err||''))

  // ── C5: bao_gia_* không vào he_so_m; bản chưa loại ĐỎ ──
  console.log('\n── C5: he_so_m loại bao_gia_* ──')
  await c.query(`insert into kho.tham_so_tai_chinh(ma_ky,dt_muc_tieu,so_don_ke_hoach,phi_don_le,hh_sale,hh_quan_ly,hh_thiet_ke)
                 values('KY36',1000000000,10,100000,0,0,0) on conflict (ma_ky) do update set dt_muc_tieu=excluded.dt_muc_tieu`)
  await c.query(`insert into kho.don_hang(ma_don,dong,trang_thai,ma_ky_ap_dung) values('KY36-THAT','du_an','moi_len_don','KY36')`)
  await c.query(`insert into kho.don_hang(ma_don,dong,trang_thai,ma_ky_ap_dung,ly_do_thua) values('KY36-THUA','du_an','bao_gia_thua','KY36','gia_cao')`)
  await c.query(`insert into kho.don_hang_gia_von(ma_don,gia_chuyen_giao) values('KY36-THAT',5000000),('KY36-THUA',1000000)`)
  const gcgLoc=(await q(`select avg(g.gia_chuyen_giao) a from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don=g.ma_don where d.ma_ky_ap_dung='KY36' and d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo')`))[0].a
  const gcgRaw=(await q(`select avg(g.gia_chuyen_giao) a from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don=g.ma_don where d.ma_ky_ap_dung='KY36'`))[0].a
  console.log(`   gcg_TB loại thua = ${gcgLoc} (chỉ đơn thật 5tr) · gcg_TB CHƯA loại = ${gcgRaw} (lẫn thua 1tr)`)
  ok('C5 he_so_m loại bao_gia_thua (gcg 5tr)', Number(gcgLoc)===5000000)
  ok('C5 [CẮN] bản CHƯA loại LỆCH (3tr) → ĐỎ', Number(gcgRaw)===3000000 && gcgLoc!==gcgRaw)

  // dtCua (app) loại bao_gia_*
  const LA=t=>t==='bao_gia'||t==='bao_gia_thua'||t==='bao_gia_treo'
  const loaiOf=()=>({dt:true}),kTra=()=>1000000,lapCty=()=>0
  const dtCua=(d)=>loaiOf().dt&&!LA(d.tt)?kTra()-lapCty()-(+d.ship||0):0
  const dtRaw=(d)=>loaiOf().dt&&d.tt!=='bao_gia'?kTra()-lapCty()-(+d.ship||0):0  // bản 035 (chỉ loại bao_gia)
  ok('C5 dtCua(bao_gia_thua)=0', dtCua({tt:'bao_gia_thua'})===0)
  ok('C5 [CẮN] bản 035 tính thua vào doanh thu → ĐỎ', dtRaw({tt:'bao_gia_thua'})===1000000)

  console.log(`\n== KẾT: ${P} pass / ${F} fail ==`)
} catch(e){ console.error('LỖI:', e.message); F++ }
finally { await c.query('rollback'); await c.end(); process.exit(F?1:0) }
