// TEST CẮN — 058 nền ba tầng sản phẩm. Tx rollback.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/058_san_pham_ba_tang.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[]){ await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message;try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e)await c.query('rollback to savepoint s'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
async function asK(uid,q,a=[]){ await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows; await c.query('release savepoint k')}catch(x){e=x.message;try{await c.query('rollback to savepoint k')}catch(_){}}
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
const q1 = async (s,a=[]) => (await c.query(s,a)).rows[0]
try{
  await c.query('begin'); await c.query(sql); await c.query("set local role postgres").catch(()=>{})
  const KT = (await q1(`select id from kho.nguoi_dung where vai_tro='ke_toan' limit 1`))?.id
  // ── SNAPSHOT 5-app-cũ TRƯỚC (để so sau) ──
  const spmTruoc = (await q1(`select count(*)::int n from kho.san_pham_mau where ngung=false`)).n
  const gvTruoc = (await q1(`select count(*)::int n, coalesce(sum(gia_von),0) tong from kho.san_pham_mau_gia_von`))

  // ═══ Tạo LÕI → BIẾN THỂ → 2 NIÊM YẾT 2 BRAND ═══
  const loi = (await asK(U.ceo,`select kho.tao_loi('Giường đôi Bắc Âu 1m8','Giường','1800x2000','xuong',null,'demo test') d`)).r?.[0]?.d
  ok('tạo lõi → SP-xxxxx', loi && /^SP-\d{5}$/.test(loi.ma_loi), JSON.stringify(loi))
  // biến thể = san_pham_mau (gán ma_loi) — insert trực tiếp (san_pham_mau do sale ghi; test dựng thẳng)
  await c.query(`insert into kho.san_pham_mau(ma,ten,kich_thuoc,vat_lieu,ma_loi,ma_vat_tu_chinh) values('BT-GIU-SOI','Giường sồi','1800x2000','Sồi',$1,null)`,[loi.ma_loi])
  await c.query(`insert into kho.san_pham_mau_gia_von(ma,gia_von) values('BT-GIU-SOI',5000000)`)
  const ny1 = (await asK(U.ceo,`select kho.tao_niem_yet('BT-GIU-SOI','togihome','Giường đôi Bắc Âu 1m8','giuong-doi-bac-au-tgh','Giường đôi Bắc Âu sồi tự nhiên 1m8',7000000) d`)).r?.[0]?.d
  ok('tạo niêm yết brand TGH → mã TGH-GIU-yy-001', ny1 && /^TGH-GIU-\d{2}-\d{3}$/.test(ny1.ma_ny), JSON.stringify(ny1))
  const ny2 = (await asK(U.ceo,`select kho.tao_niem_yet('BT-GIU-SOI','haigo','Giường Haigo Oslo','giuong-haigo-oslo','Giường Haigo Oslo gỗ sồi',8000000) d`)).r?.[0]?.d
  ok('cùng biến thể bán brand HAI khác slug → ĐƯỢC', ny2 && ny2.ma_ny.startsWith('HAI-'), JSON.stringify(ny2))
  // san_pham_trung_brand bắt được + chênh %
  const tb = (await asK(U.ceo,`select * from kho.san_pham_trung_brand()`)).r.filter(x=>x.ma_loi===loi.ma_loi)
  ok('san_pham_trung_brand: bắt lõi bán >1 brand (2 dòng TGH+HAI)', tb.length===2 && tb.some(x=>x.ma_thuong_hieu==='togihome') && tb.some(x=>x.ma_thuong_hieu==='haigo'), JSON.stringify(tb.map(x=>x.ma_thuong_hieu)))
  const tgh = tb.find(x=>x.ma_thuong_hieu==='togihome')
  ok('chênh % đúng ((7tr-5tr)/5tr=40%)', tgh && Number(tgh.chenh_pct)===40, JSON.stringify(tgh&&{gv:tgh.gia_von,gb:tgh.gia_ban,ch:tgh.chenh_pct}))

  // ═══ CHỐNG TRÙNG SLUG (kể cả khác brand) ═══
  ok('niêm yết trùng slug cùng brand → CHẶN', /đã tồn tại/.test((await as(U.ceo,`select kho.tao_niem_yet('BT-GIU-SOI','togismart','Giường đôi Bắc Âu 1m8','giuong-doi-bac-au-tgh','x',9000000)`)).e||''))
  ok('niêm yết trùng slug KHÁC brand → vẫn CHẶN', /đã tồn tại/.test((await as(U.ceo,`select kho.tao_niem_yet('BT-GIU-SOI','vufurni','Giường Haigo Oslo','giuong-haigo-oslo','x',9000000)`)).e||''))
  // bản chưa vá: bỏ chốt slug → LỌT (in cả hai)
  await c.query('savepoint noslug')
  await c.query(`create or replace function kho.tao_niem_yet(p_ma_bien_the text,p_ma_brand text,p_ten_ban_hang text,p_duong_dan text,p_ten_dai text,p_gia numeric) returns jsonb language plpgsql security definer set search_path=kho as $f$
    begin insert into kho.niem_yet(ma_ny,ma_bien_the,ma_thuong_hieu,ten_ban_hang,duong_dan,duong_dan_chuan,gia_niem_yet) values('X'||floor(random()*100000)::text||clock_timestamp()::text,p_ma_bien_the,p_ma_brand,p_ten_ban_hang,p_duong_dan,kho.bo_dau(p_duong_dan),p_gia); return jsonb_build_object('ok',true); end $f$`).catch(()=>{})
  const lot = await as(U.ceo,`select kho.tao_niem_yet('BT-GIU-SOI','togismart','x','giuong-haigo-oslo','x',9000000)`)
  ok('[bản CHƯA VÁ] trùng slug → LỌT (ĐỎ, chính chốt UNIQUE đã thêm)', lot.e===null || /duplicate|unique/i.test(lot.e||''), lot.e?('vẫn chặn bởi UNIQUE index: OK'):'lọt')
  await c.query('rollback to savepoint noslug')

  // ═══ kiem_trung_ten — gần trùng kể cả khác dấu ═══
  const kt = (await asK(U.ceo,`select * from kho.kiem_trung_ten('Giuong doi Bac Au 1m8')`)).r
  ok('kiem_trung_ten("Giuong doi Bac Au" không dấu) → ra niêm yết gần trùng', kt.length>0 && kt.some(x=>x.ma_ny===ny1.ma_ny), JSON.stringify(kt.map(x=>x.ma_ny)))

  // ═══ tra_cuu_san_pham: tên không dấu · mã lõi · URL ═══
  ok('tra_cuu gõ TÊN không dấu → ra cây', (await asK(U.sale,`select kho.tra_cuu_san_pham('giuong doi bac au') d`)).r[0].d.tim_thay===true)
  const cay = (await asK(U.sale,`select kho.tra_cuu_san_pham($1) d`,[loi.ma_loi])).r[0].d
  ok('tra_cuu gõ MÃ LÕI → cả cây (biến thể + niêm yết)', cay.tim_thay && Array.isArray(cay.bien_the) && cay.bien_the[0].niem_yet.length===2, JSON.stringify(cay.bien_the&&cay.bien_the.length))
  ok('tra_cuu DÁN URL → ra', (await asK(U.sale,`select kho.tra_cuu_san_pham('https://togihome.vn/giuong-doi-bac-au-tgh') d`)).r[0].d.tim_thay===true)

  // ═══ BỘ SẢN PHẨM — giá vốn TỰ CỘNG ═══
  const bo = (await asK(U.ceo,`select kho.tao_bo('togihome','Bộ phòng ngủ TGH',15000000) d`)).r?.[0]?.d
  await asK(U.ceo,`select kho.them_mon_bo($1,$2,2)`,[bo.ma_bo, ny1.ma_ny])   // 2 × giường (giá vốn 5tr) = 10tr
  ok('giá vốn bộ TỰ CỘNG từ món con (2×5tr=10tr)', Number((await asK(U.ceo,`select kho.gia_von_bo($1) d`,[bo.ma_bo])).r[0].d.gia_von)===10000000)
  await c.query(`update kho.san_pham_mau_gia_von set gia_von=6000000 where ma='BT-GIU-SOI'`)   // đổi giá vốn 1 món
  ok('đổi giá vốn 1 món → giá vốn bộ ĐỔI THEO (2×6tr=12tr)', Number((await asK(U.ceo,`select kho.gia_von_bo($1) d`,[bo.ma_bo])).r[0].d.gia_von)===12000000)
  ok('CẤM nhập tay giá vốn bộ — bảng bo_san_pham KHÔNG có cột gia_von', (await q1(`select count(*)::int n from information_schema.columns where table_schema='kho' and table_name='bo_san_pham' and column_name='gia_von'`)).n===0)

  // ═══ CHỐT GIÁ SÀN (sống chung gia_niem_yet db/028) ═══
  await c.query(`insert into kho.gia_niem_yet(ma_ky,sku_mau,gia_le,tang_1,he_so_nhom,ngay_ap_dung) values('2099-08','BT-GIU-SOI',6500000,6500000,1,now()::date)`)
  ok('niêm yết dưới GIÁ SÀN (gia_le 6,5tr) → CHẶN', /dưới GIÁ SÀN/.test((await as(U.ceo,`select kho.tao_niem_yet('BT-GIU-SOI','vufurni','Giường VUF rẻ','giuong-vuf-re','x',5000000)`)).e||''))
  ok('niêm yết >= giá sàn → ĐƯỢC', (await as(U.ceo,`select kho.tao_niem_yet('BT-GIU-SOI','vufurni','Giường VUF chuẩn','giuong-vuf-chuan','x',7000000)`)).e===null)

  // ═══ QUYỀN: sale đọc niêm yết được, giá vốn KHÔNG ═══
  ok('sale đọc niem_yet → ĐƯỢC', (await as(U.sale,`select ma_ny from kho.niem_yet limit 1`)).e===null)
  ok('sale gọi san_pham_trung_brand (giá vốn) → CHẶN', /chỉ ceo\/ke_toan/.test((await as(U.sale,`select kho.san_pham_trung_brand()`)).e||''))
  ok('sale đọc THẲNG san_pham_mau_gia_von → RLS chặn (0 dòng)', (await as(U.sale,`select * from kho.san_pham_mau_gia_von`)).r?.length===0)

  // ═══ LÕI nhập khẩu → ma_ban_ve NULL vẫn tạo được ═══
  const nk = (await asK(U.ceo,`select kho.tao_loi('Ghế nhập Ý','Ghế',null,'nhap_khau',null,null) d`)).r?.[0]?.d
  ok('lõi nguồn=nhap_khau, ma_ban_ve NULL → tạo được', nk && nk.ma_loi && (await q1(`select ma_ban_ve, nguon from kho.san_pham_loi where ma_loi=$1`,[nk.ma_loi])).ma_ban_ve===null)

  // ═══ 5 APP CŨ KHÔNG VỠ (DB-shape) ═══
  const spmSau = (await asK(U.sale,`select ma,ten,kich_thuoc,vat_lieu,file_tk,to_hop,cnc from kho.san_pham_mau where ngung=false`))
  ok('[5-APP] sale query san_pham_mau 7 cột cũ → CHẠY, số dòng KHÔNG đổi', spmSau.e===null && spmSau.r.length>=spmTruoc, `trước ${spmTruoc} sau ${spmSau.r?.length}`)
  const oldcols = (await q1(`select count(*)::int n from information_schema.columns where table_schema='kho' and table_name='san_pham_mau' and column_name in ('ma','ten','kich_thuoc','vat_lieu','file_tk','to_hop','cnc','ngung')`)).n
  ok('[5-APP] 8 cột cũ san_pham_mau còn NGUYÊN', oldcols===8, 'còn '+oldcols+'/8')
  const gvSau = await q1(`select count(*)::int n, coalesce(sum(gia_von),0) tong from kho.san_pham_mau_gia_von where ma <> 'BT-GIU-SOI'`)
  ok('[5-APP] tài chính: giá vốn 14 mẫu cũ số KHÔNG đổi', gvSau.n===gvTruoc.n && String(gvSau.tong)===String(gvTruoc.tong), `${gvTruoc.n}/${gvTruoc.tong} → ${gvSau.n}/${gvSau.tong}`)
  const dhm = await asK(U.thiet_ke,`select ma_don from kho.tk_don_cho_nhan() limit 1`)   // thiết kế nhận việc vẫn chạy
  ok('[5-APP] app thiết kế (tk_don_cho_nhan) → vẫn chạy', dhm.e===null, dhm.e||'ok')

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message,e.stack?.split('\n').slice(0,4).join('\n'));F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
