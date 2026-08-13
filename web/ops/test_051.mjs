// TEST CẮN — 051 ban_thiet_ke + cổng khoá cắt. Áp trong tx rồi ROLLBACK.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/051_ban_thiet_ke.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', kho:'66272566-1897-4c57-aa3f-98a81636302a',
  sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e',
  tk_ban_hang:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[]){ await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message;try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e)await c.query('rollback to savepoint s'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
// as() với KEEP (giữ thay đổi để test bước sau): không rollback savepoint
async function asK(uid,q,a=[]){ await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message}
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
try{
  await c.query('begin')
  await c.query('drop function if exists kho.gui_ban_thiet_ke(text,text,jsonb,jsonb)').catch(()=>{})
  await c.query(sql)
  await c.query("set local role postgres").catch(()=>{})

  // ── dựng 2 đơn test: du_an (cần duyệt) + le mẫu sẵn (miễn) ──
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai) values
    ('BTK-DA','du_an','le_rieng','dang_thiet_ke'),('BTK-LE','le','le_sang','xong_file')`)
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Tủ áo',1,0,true from kho.don_hang where ma_don='BTK-DA'`)
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Kệ mẫu sẵn',1,0,false from kho.don_hang where ma_don='BTK-LE'`)

  // 1) GỬI BẢN KHÔNG ẢNH → CHẶN
  const noAnh = await as(U.thiet_ke, `select kho.gui_ban_thiet_ke('BTK-DA','ghi chú','[]'::jsonb)`)
  ok('gửi bản KHÔNG ảnh → CHẶN', /ít nhất 1 ảnh/.test(noAnh.e||''), noAnh.e||'(lọt!)')

  // guard: sale KHÔNG được gửi bản
  const saleGui = await as(U.sale, `select kho.gui_ban_thiet_ke('BTK-DA','x','[{"duong_dan_nho":"a","duong_dan_to":"b"}]'::jsonb)`)
  ok('sale gửi bản → CHẶN (chỉ ceo/thiet_ke/tk_ban_hang)', /chỉ ceo\/thiet_ke\/tk_ban_hang/.test(saleGui.e||''))

  const anh1 = `[{"duong_dan_nho":"BTK-DA/1/a_nho.webp","duong_dan_to":"BTK-DA/1/a_to.webp","byte_nho":38000,"byte_to":390000,"thu_tu":0}]`
  // 2) CỔNG TEM: du_an CHƯA có bản duyệt → đẩy tem CHẶN Ở SERVER (gọi thẳng day_tem_ban_ve)
  const temChan = await as(U.thiet_ke, `select kho.day_tem_ban_ve('BTK-DA', '[{"ma_tam":"T1","vai_tro":"dot","dai":600,"rong":400,"day":17,"canh_dan":[],"kien":1}]'::jsonb)`)
  ok('[CẮN] du_an chưa duyệt → đẩy tem CHẶN Ở SERVER (day_tem_ban_ve trực tiếp)', /chưa có bản thiết kế nào KHÁCH DUYỆT/.test(temChan.e||''), temChan.e?'':'LỌT (ĐỎ như bản chưa vá)')

  // 3) le mẫu sẵn → đẩy tem ĐƯỢC, không cần bản duyệt
  const temLe = await as(U.thiet_ke, `select kho.day_tem_ban_ve('BTK-LE', '[{"ma_tam":"T1","vai_tro":"dot","dai":600,"rong":400,"day":17,"canh_dan":[],"kien":1}]'::jsonb)`)
  ok('le mẫu sẵn → đẩy tem ĐƯỢC (miễn cổng duyệt)', temLe.e===null, temLe.e||'')

  // 4) gửi bản 1 (KEEP) + duyệt → 5) gửi bản 2 + duyệt bản 2 → bản 1 tự thay_the
  const g1 = await asK(U.thiet_ke, `select (kho.gui_ban_thiet_ke('BTK-DA','bản 1', '${anh1}'::jsonb)->>'ban_id') b`)
  const ban1 = g1.r[0].b
  ok('gửi bản 1 OK', !!ban1, g1.e||'')
  // "Khách đổi ý" thiếu ghi chú → CHẶN
  const doiY = await as(U.sale, `select kho.phan_hoi_ban('${ban1}','khach_doi_y','')`)
  ok('"Khách đổi ý" KHÔNG ghi chú → CHẶN', /bắt buộc có ghi chú/.test(doiY.e||''), doiY.e||'(lọt!)')
  // thiet_ke KHÔNG được phản hồi (chấm mình)
  const tkPh = await as(U.thiet_ke, `select kho.phan_hoi_ban('${ban1}','khach_duyet','')`)
  ok('thiet_ke tự phản hồi → CHẶN (chỉ ceo/sale/tk_ban_hang)', /chỉ ceo\/sale\/tk_ban_hang/.test(tkPh.e||''))
  // sale duyệt bản 1 (KEEP)
  await asK(U.sale, `select kho.phan_hoi_ban('${ban1}','khach_duyet','ok')`)
  const st1 = (await c.query(`select trang_thai from kho.ban_thiet_ke where id='${ban1}'`)).rows[0].trang_thai
  ok('bản 1 duyệt → khach_duyet', st1==='khach_duyet', st1)
  // giờ du_an ĐÃ có bản duyệt → đẩy tem ĐƯỢC
  const temOk = await as(U.thiet_ke, `select kho.day_tem_ban_ve('BTK-DA', '[{"ma_tam":"T1","vai_tro":"dot","dai":600,"rong":400,"day":17,"canh_dan":[],"kien":1}]'::jsonb)`)
  ok('du_an có bản duyệt → đẩy tem ĐƯỢC', temOk.e===null, temOk.e||'')

  // gửi bản 2 (KEEP) + duyệt bản 2 → bản 1 tự thay_the
  const g2 = await asK(U.thiet_ke, `select (kho.gui_ban_thiet_ke('BTK-DA','bản 2', '${anh1.replace(/\/1\//g,'/2/')}'::jsonb)->>'ban_id') b`)
  const ban2 = g2.r[0].b
  await asK(U.sale, `select kho.phan_hoi_ban('${ban2}','khach_duyet','duyệt bản 2')`)
  const sts = (await c.query(`select id,phien_ban,trang_thai from kho.ban_thiet_ke where ma_don='BTK-DA' order by phien_ban`)).rows
  const duyet = sts.filter(x=>x.trang_thai==='khach_duyet')
  ok('[CẮN] chỉ MỘT bản khach_duyet tại một thời điểm', duyet.length===1 && duyet[0].id===ban2, JSON.stringify(sts.map(x=>x.phien_ban+':'+x.trang_thai)))
  ok('bản 1 cũ tự chuyển thay_the', sts.find(x=>x.id===ban1).trang_thai==='thay_the')

  // 6) LINK gửi khách — không giá/khách, hết hạn
  const lk = await asK(U.sale, `select kho.link_gui_khach('${ban2}') d`)
  const linkDoc = lk.r[0].d
  ok('link_gui_khach trả token + ảnh', !!linkDoc.token && Array.isArray(linkDoc.anh), lk.e||'')
  // khách (anon) xem
  const xem = await as(null, `select kho.xem_link_khach('${linkDoc.token}') d`)
  const xd = xem.r?.[0]?.d
  ok('khách (anon) xem link → thấy món + ghi chú', xem.e===null && xd && Array.isArray(xd.mon), xem.e||'')
  const flat = JSON.stringify(xd||{})
  ok('[CẮN] link KHÔNG rò giá/tên khách/đơn khác', !/gia|gia_ban|khach|sdt|dia_chi|thanh_toan/i.test(flat.replace(/ghi_chu|thu_tu/g,'')), flat.slice(0,80))
  // hết hạn: đẩy het_han về quá khứ
  await c.query(`update kho.link_ban_khach set het_han = now() - interval '1 day' where token='${linkDoc.token}'`)
  const hh = await as(null, `select kho.xem_link_khach('${linkDoc.token}')`)
  ok('link quá 7 ngày → hết hạn', /hết hạn/.test(hh.e||''), hh.e||'(lọt!)')

  // 7) xuong CHỈ thấy bản khach_duyet (RLS)
  const xView = await as(U.xuong, `select phien_ban,trang_thai from kho.ban_thiet_ke where ma_don='BTK-DA' order by phien_ban`)
  ok('[CẮN] xuong chỉ thấy bản khach_duyet (không thấy nháp/thay_the)',
     xView.r && xView.r.length===1 && xView.r[0].trang_thai==='khach_duyet', JSON.stringify(xView.r))

  // 8b) ghi thẳng bảng (không qua RPC) → CHẶN bởi RLS (writes chỉ qua RPC definer)
  const direct = await as(U.thiet_ke, `update kho.ban_thiet_ke set ghi_chu='x' where id='${ban2}'`)
  ok('ghi THẲNG ban_thiet_ke (không qua RPC) → CHẶN (RLS)', /permission denied/.test(direct.e||''), direct.e||'(lọt!)')
  // 8) file_3d > 100MB → CHẶN (CHECK) — thử ở tầng service (bỏ RLS) để chạm CHECK
  await c.query('savepoint f3d')
  let f3dErr=null; try{ await c.query(`update kho.ban_thiet_ke set file_3d_byte=104857601 where id='${ban2}'`) }catch(x){f3dErr=x.message; await c.query('rollback to savepoint f3d')}
  ok('file_3d > 100MB → CHẶN (CHECK)', f3dErr!==null && /check|file_3d/i.test(f3dErr||''), f3dErr||'(lọt!)')

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message,e.stack?.split('\n').slice(0,3).join('\n'));F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
