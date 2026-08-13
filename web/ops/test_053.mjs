// TEST CẮN — 053 nền app thiết kế. Áp trong tx rồi ROLLBACK.
//   Hai vai TÁCH: thiet_ke (SẢN XUẤT, đẩy tem) ⟂ tk_ban_hang (BÁN HÀNG, gửi bản).
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/053_nen_app_thiet_ke.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', kho:'66272566-1897-4c57-aa3f-98a81636302a',
  sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e',
  tk_ban_hang:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb' }
const B_UID = '00000000-0000-4000-8000-0000000b0b0b'   // thiet_ke B (dựng trong test)
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[]){ await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message;try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e)await c.query('rollback to savepoint s'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
async function asK(uid,q,a=[]){ await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message}
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
const q1 = async (s,a=[]) => (await c.query(s,a)).rows[0]
try{
  await c.query('begin')
  await c.query('drop function if exists kho.gui_ban_thiet_ke(text,text,jsonb,jsonb)').catch(()=>{})
  await c.query(sql)
  await c.query("set local role postgres").catch(()=>{})

  // ── người: thiet_ke A (thật) · thiet_ke B (dựng) · lấy nguoi_dung.id ──
  const A = (await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[U.thiet_ke])).id
  const TKB = (await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[U.tk_ban_hang])).id
  await c.query(`insert into kho.nguoi_dung(auth_uid,ho_ten,vai_tro,dang_hoat_dong) values($1,'Thợ TK B','thiet_ke',true)`,[B_UID])
  const B = (await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[B_UID])).id

  // ── đơn nền (kỳ K053) ──
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke) values
    ('D-A','du_an','le_rieng','moi_len_don','K053','thiet_ke_rieng'),
    ('D-C','du_an','le_rieng','dang_thiet_ke','K053',null),
    ('D-E','du_an','le_rieng','xong_file','K053','co_file_san'),
    ('D-TKB','du_an','le_rieng','dang_thiet_ke','K053','co_mon_dung_moi')`)
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Tủ',1,0,true from kho.don_hang where ma_don='D-A'`)

  // ══════════ 1. CHIA VIỆC ══════════
  const n1 = await asK(U.thiet_ke, `select kho.nhan_viec_thiet_ke('D-A')`)
  const dA = await q1(`select ma_ns_thiet_ke,buoc_thiet_ke,trang_thai,luc_nhan_thiet_ke from kho.don_hang where ma_don='D-A'`)
  ok('A nhận việc → giữ đúng người + dang_dung + nhan_thiet_ke + có mốc nhận',
     n1.e===null && dA.ma_ns_thiet_ke===A && dA.buoc_thiet_ke==='dang_dung' && dA.trang_thai==='nhan_thiet_ke' && dA.luc_nhan_thiet_ke!==null,
     n1.e||JSON.stringify(dA))
  // B (thiet_ke khác) nhận đơn A đang cầm → CHẶN, báo A
  const bTake = await as(B_UID, `select kho.nhan_viec_thiet_ke('D-A')`)
  ok('B nhận đơn A đang cầm → CHẶN, báo người cầm', /đang do .* cầm/.test(bTake.e||''), bTake.e||'(lọt!)')
  const saleTake = await as(U.sale, `select kho.nhan_viec_thiet_ke('D-C')`)
  ok('sale nhận việc thiết kế → CHẶN (chỉ ceo/thiet_ke/tk_ban_hang)', /chỉ ceo/.test(saleTake.e||''), saleTake.e||'(lọt!)')
  const xuongTake = await as(U.xuong, `select kho.nhan_viec_thiet_ke('D-C')`)
  ok('xuong nhận việc thiết kế → CHẶN', /chỉ ceo/.test(xuongTake.e||''), xuongTake.e||'(lọt!)')
  // tk_ban_hang nhận việc → ĐƯỢC (hai vai đều nhận được việc thiết kế)
  const tkbTake = await asK(U.tk_ban_hang, `select kho.nhan_viec_thiet_ke('D-TKB')`)
  ok('tk_ban_hang nhận việc → ĐƯỢC', tkbTake.e===null, tkbTake.e||'')
  // 5-đơn: cho A cầm thêm 4 đơn (tổng 5 gồm D-A) → nhận đơn thứ 6 CHẶN
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,ma_ns_thiet_ke,buoc_thiet_ke)
    select 'D-F'||g,'du_an','le_rieng','nhan_thiet_ke','K053',$1,'dang_dung' from generate_series(1,4) g`,[A])
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung) values('D-SIX','du_an','le_rieng','moi_len_don','K053')`)
  const six = await as(U.thiet_ke, `select kho.nhan_viec_thiet_ke('D-SIX')`)
  ok('A đang cầm 5 đơn → nhận đơn thứ 6 CHẶN (tối đa 5)', /tối đa 5/.test(six.e||''), six.e||'(lọt!)')

  // ══════════ 3. GHI GIỜ — loai_gio theo VAI ══════════
  await asK(U.thiet_ke, `select kho.ghi_gio_thiet_ke('D-A',2)`)
  const gA = await q1(`select loai_gio,gio_thuc from kho.gio_thiet_ke_thuc where ma_don='D-A' order by ghi_luc desc limit 1`)
  ok('thiet_ke ghi giờ → loai_gio=xuong (SẢN XUẤT)', gA.loai_gio==='xuong' && Number(gA.gio_thuc)===2, JSON.stringify(gA))
  await asK(U.tk_ban_hang, `select kho.ghi_gio_thiet_ke('D-TKB',1.5)`)
  const gT = await q1(`select loai_gio from kho.gio_thiet_ke_thuc where ma_don='D-TKB' order by ghi_luc desc limit 1`)
  ok('tk_ban_hang ghi giờ → loai_gio=ban_hang (BÁN HÀNG)', gT.loai_gio==='ban_hang', JSON.stringify(gT))
  const gSale = await as(U.sale, `select kho.ghi_gio_thiet_ke('D-A',1)`)
  ok('sale ghi giờ thiết kế → CHẶN', /chỉ thiết kế/.test(gSale.e||''), gSale.e||'(lọt!)')

  // ══════════ 2. KANBAN tự chuyển bước (trên D-A) ══════════
  const anh = `[{"duong_dan_nho":"D-A/1/n.webp","duong_dan_to":"D-A/1/t.webp","byte_nho":1,"byte_to":2,"thu_tu":0}]`
  const b1 = (await asK(U.thiet_ke, `select (kho.gui_ban_thiet_ke('D-A','bản 1','${anh}'::jsonb)->>'ban_id') b`)).r[0].b
  ok('gửi bản → buoc=cho_duyet', (await q1(`select buoc_thiet_ke b from kho.don_hang where ma_don='D-A'`)).b==='cho_duyet')
  await asK(U.sale, `select kho.phan_hoi_ban('${b1}','chua_dung_yeu_cau','hiểu sai yêu cầu')`)
  ok('phản hồi "Chưa đúng yêu cầu" → buoc=sua_gop_y', (await q1(`select buoc_thiet_ke b from kho.don_hang where ma_don='D-A'`)).b==='sua_gop_y')
  const b2 = (await asK(U.thiet_ke, `select (kho.gui_ban_thiet_ke('D-A','bản 2','${anh.replace(/\/1\//g,'/2/')}'::jsonb)->>'ban_id') b`)).r[0].b
  await asK(U.sale, `select kho.phan_hoi_ban('${b2}','khach_duyet','ok')`)
  ok('phản hồi "Khách duyệt" → KHÔNG hạ về sua_gop_y (giữ cho_duyet)', (await q1(`select buoc_thiet_ke b from kho.don_hang where ma_don='D-A'`)).b==='cho_duyet')

  // ══════════ Q2 CHỐT — ĐẨY TEM (D-A đã khách duyệt, A cầm) ══════════
  const tem = `[{"ma_tam":"T1","vai_tro":"dot","dai":600,"rong":400,"day":17,"canh_dan":[],"kien":1}]`
  const temB = await as(B_UID, `select kho.day_tem_ban_ve('D-A','${tem}'::jsonb)`)
  ok('B (thiet_ke khác) đẩy tem đơn của A → CHẶN, báo A cầm', /đang do .* cầm/.test(temB.e||''), temB.e||'(LỌT!)')
  const temTKB = await as(U.tk_ban_hang, `select kho.day_tem_ban_ve('D-A','${tem}'::jsonb)`)
  ok('tk_ban_hang đẩy tem → CHẶN "không xuất file cắt"', /không xuất file cắt/.test(temTKB.e||''), temTKB.e||'(LỌT!)')
  const temCeo = await as(U.ceo, `select kho.day_tem_ban_ve('D-A','${tem}'::jsonb)`)
  ok('ceo đẩy tem → ĐƯỢC (bỏ qua chốt người cầm)', temCeo.e===null, temCeo.e||'')
  // đơn chưa ai nhận + có bản khách duyệt → thiet_ke đẩy CHẶN "chưa ai nhận"
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values('D-C',1,$1,'khach_duyet')`,[A])
  const temC = await as(U.thiet_ke, `select kho.day_tem_ban_ve('D-C','${tem}'::jsonb)`)
  ok('đơn CHƯA AI NHẬN + thiet_ke đẩy tem → CHẶN "chưa ai nhận"', /CHƯA AI NHẬN/.test(temC.e||''), temC.e||'(LỌT!)')

  // BẢN CHƯA VÁ: dựng lại day_tem_ban_ve KIỂU db/051 (không chốt Q2) → B đẩy đơn A LỌT (ĐỎ). In cả hai.
  await c.query('savepoint chuava')
  await c.query(`create or replace function kho.day_tem_ban_ve(p_ma_don text, p_tam jsonb)
    returns jsonb language plpgsql security definer set search_path to 'kho' as $f$
    declare v_pb integer; t jsonb; v_don kho.don_hang; v_le boolean;
    begin
      if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke') then raise exception 'chỉ ceo/kho/thiet_ke'; end if;
      select * into v_don from kho.don_hang d where d.ma_don=p_ma_don;
      v_le := (v_don.dong='le' and not exists(select 1 from kho.don_hang_mon m where m.don_id=v_don.id and m.dung_moi));
      if not v_le and not exists(select 1 from kho.ban_thiet_ke b where b.ma_don=p_ma_don and b.trang_thai='khach_duyet') then
        raise exception 'chưa duyệt'; end if;
      select coalesce(max(phien_ban),0)+1 into v_pb from kho.tem_ban_ve where ma_don=p_ma_don;
      for t in select * from jsonb_array_elements(p_tam) loop
        insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,duong_dan_svg)
          values(p_ma_don,v_pb,t->>'ma_tam',t->>'vai_tro',(t->>'dai')::numeric,(t->>'rong')::numeric,(t->>'day')::numeric,'[]'::jsonb,1,'x');
      end loop;
      return jsonb_build_object('ok',true);
    end $f$;`)
  const temBraw = await as(B_UID, `select kho.day_tem_ban_ve('D-A','${tem}'::jsonb)`)
  ok('[bản CHƯA VÁ] B đẩy tem đơn A → LỌT (ĐỎ, chính là lỗ hổng đã vá)', temBraw.e===null, temBraw.e?('bị chặn: '+temBraw.e):'lọt như dự kiến')
  await c.query('rollback to savepoint chuava')

  // A (người cầm) đẩy tem → ĐƯỢC + buoc=xong_file
  const temA = await asK(U.thiet_ke, `select kho.day_tem_ban_ve('D-A','${tem}'::jsonb)`)
  ok('A (người cầm) đẩy tem → ĐƯỢC', temA.e===null, temA.e||'')
  ok('đẩy tem → buoc=xong_file', (await q1(`select buoc_thiet_ke b from kho.don_hang where ma_don='D-A'`)).b==='xong_file')

  // ══════════ 4. LỖI DO FILE ══════════
  await c.query(`insert into kho.loi_lam_lai(ngay,ma_don,loai_loi,so_luong,ma_ns_ghi,do_file) values(now()::date,'D-A','xxx',1,$1,true)`,[B])
  ok('lỗi do_file=true → tự gán ma_ns_thiet_ke của đơn (A)',
     (await q1(`select ma_ns_thiet_ke m from kho.loi_lam_lai where ma_don='D-A' and do_file order by id desc limit 1`)).m===A)
  await c.query(`insert into kho.loi_lam_lai(ngay,ma_don,loai_loi,so_luong,ma_ns_ghi,do_file) values(now()::date,'D-A','yyy',1,$1,false)`,[B])
  ok('lỗi do_file=false → ma_ns_thiet_ke NULL',
     (await q1(`select ma_ns_thiet_ke m from kho.loi_lam_lai where ma_don='D-A' and not do_file order by id desc limit 1`)).m===null)

  // ══════════ TEM 1 vs 2 phiên (file đúng lần đầu) — D-E của A, 2 phiên tem ══════════
  await c.query(`update kho.don_hang set ma_ns_thiet_ke=$1, buoc_thiet_ke='xong_file' where ma_don='D-E'`,[A])
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,duong_dan_svg) values
    ('D-E',1,'T','dot',1,1,17,'[]',1,'x'),('D-E',2,'T','dot',1,1,17,'[]',1,'x')`)
  const ttx_ceo = await asK(U.ceo, `select * from kho.tt_thiet_ke_xuong('K053')`)
  const rowA = ttx_ceo.r.find(x=>x.ma_ns===A)
  // D-A: 1 phiên (đúng lần đầu) · D-E: 2 phiên (không) → 50%
  ok('file đúng lần đầu = % đơn chỉ 1 phiên tem (D-A 1p, D-E 2p → 50%)',
     rowA && Number(rowA.file_dung_lan_dau_pct)===50, JSON.stringify(rowA&&{f:rowA.file_dung_lan_dau_pct,so:rowA.so_don_can_cu}))
  ok('lỗi do file xưởng bắt được đếm đúng (A: 1)', rowA && rowA.loi_do_file_bat===1, JSON.stringify(rowA&&rowA.loi_do_file_bat))
  ok('có giờ ghi → ước lệch KHÁC NULL, ba chỉ số kia vẫn chạy',
     rowA && rowA.uoc_lech_gio_tb!==null && rowA.viec_xong_chuan_hoa!==null && rowA.file_dung_lan_dau_pct!==null,
     JSON.stringify(rowA&&{u:rowA.uoc_lech_gio_tb}))
  ok('so_don_can_cu < 5 → cảnh báo "chưa đủ đơn"', rowA && rowA.du_tin===false && /Chưa đủ đơn/.test(rowA.canh_bao||''), JSON.stringify(rowA&&rowA.canh_bao))

  // ══════════ ước lệch NULL khi KHÔNG ghi giờ — kỳ K53B, B cầm 1 đơn xong, KHÔNG giờ ══════════
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke,ma_ns_thiet_ke,buoc_thiet_ke)
    values('D-NG','du_an','le_rieng','xong_file','K53B','co_file_san',$1,'xong_file')`,[B])
  const ttxB = (await asK(U.ceo, `select * from kho.tt_thiet_ke_xuong('K53B')`)).r.find(x=>x.ma_ns===B)
  ok('KHÔNG đơn nào ghi giờ → ước lệch NULL nhưng việc-xong + file-đúng VẪN tính',
     ttxB && ttxB.uoc_lech_gio_tb===null && Number(ttxB.viec_xong_chuan_hoa)>0, JSON.stringify(ttxB&&{u:ttxB.uoc_lech_gio_tb,v:ttxB.viec_xong_chuan_hoa}))

  // ══════════ 5. GUARD hai bảng thành tích TÁCH VAI ══════════
  ok('tt_thiet_ke_xuong: tk_ban_hang gọi → CHẶN',
     /chỉ ceo hoặc thiết kế sản xuất/.test((await as(U.tk_ban_hang,`select kho.tt_thiet_ke_xuong('K053')`)).e||''))
  ok('tt_thiet_ke_ban_hang: thiet_ke gọi → CHẶN',
     /chỉ ceo hoặc thiết kế bán hàng/.test((await as(U.thiet_ke,`select kho.tt_thiet_ke_ban_hang('K053')`)).e||''))

  // ══════════ RLS: mỗi vai chỉ thấy số CHÍNH MÌNH · ceo thấy hết ══════════
  // cho B cũng có 1 đơn xong trong K053 để chứng minh ceo thấy ≥2 người, A chỉ thấy 1
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke,ma_ns_thiet_ke,buoc_thiet_ke)
    values('D-B1','du_an','le_rieng','xong_file','K053','co_file_san',$1,'xong_file')`,[B])
  const selfA = (await asK(U.thiet_ke, `select ma_ns from kho.tt_thiet_ke_xuong('K053')`)).r
  ok('RLS: thiet_ke A chỉ thấy DÒNG CHÍNH MÌNH', selfA.length===1 && selfA[0].ma_ns===A, JSON.stringify(selfA.map(x=>x.ma_ns)))
  const allCeo = (await asK(U.ceo, `select ma_ns from kho.tt_thiet_ke_xuong('K053')`)).r
  ok('RLS: ceo thấy HẾT (≥2 người)', allCeo.length>=2 && allCeo.some(x=>x.ma_ns===A) && allCeo.some(x=>x.ma_ns===B), JSON.stringify(allCeo.map(x=>x.ma_ns)))

  // ══════════ 5b/6. BÁN HÀNG: sale trả về vì hiểu sai vs khách đổi ý · KHONG_XEP_HANG ══════════
  // D-TKB (tk_ban_hang cầm): 1 bản chua_dung_yeu_cau (stays) + 1 bản khach_doi_y (stays) + 1 khach_duyet
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values
    ('D-TKB',1,$1,'chua_dung_yeu_cau'),('D-TKB',2,$1,'khach_doi_y')`,[TKB])
  const ttbh = (await asK(U.ceo, `select * from kho.tt_thiet_ke_ban_hang('K053')`)).r.find(x=>x.ma_ns===TKB)
  ok('sale trả về vì HIỂU SAI = chỉ đếm chua_dung_yeu_cau (=1, KHÔNG gộp khach_doi_y)',
     ttbh && ttbh.sale_tra_ve_hieu_sai===1, JSON.stringify(ttbh&&ttbh.sale_tra_ve_hieu_sai))
  ok('tỷ lệ khách chốt = KHONG_XEP_HANG (trả số, không xếp hạng)', ttbh && ttbh.xep_hang_ty_le==='KHONG_XEP_HANG', JSON.stringify(ttbh&&ttbh.xep_hang_ty_le))
  // nguyen_nhan_sua đếm CẢ HAI, tách riêng
  const nn = (await asK(U.ceo, `select * from kho.nguyen_nhan_sua('K053')`)).r
  const mp = Object.fromEntries(nn.map(x=>[x.trang_thai,x.so_lan]))
  ok('nguyen_nhan_sua đếm TÁCH: có cả chua_dung_yeu_cau LẪN khach_doi_y',
     mp['chua_dung_yeu_cau']>=1 && mp['khach_doi_y']>=1, JSON.stringify(mp))

  // ══════════ Demo bị LOẠI khỏi mọi hàm thành tích ══════════
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke,ma_ns_thiet_ke,buoc_thiet_ke,la_demo)
    values('D-DEMO','du_an','le_rieng','xong_file','KDEMO','full_can',$1,'xong_file',true)`,[A])
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values('D-DEMO',1,$1,'chua_dung_yeu_cau')`,[A])
  const demoX = (await asK(U.ceo, `select * from kho.tt_thiet_ke_xuong('KDEMO')`)).r
  ok('demo LOẠI khỏi tt_thiet_ke_xuong (kỳ KDEMO rỗng)', demoX.length===0, JSON.stringify(demoX))
  const demoN = (await asK(U.ceo, `select * from kho.nguyen_nhan_sua('KDEMO')`)).r
  ok('demo LOẠI khỏi nguyen_nhan_sua', demoN.length===0, JSON.stringify(demoN))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message,e.stack?.split('\n').slice(0,4).join('\n'));F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
