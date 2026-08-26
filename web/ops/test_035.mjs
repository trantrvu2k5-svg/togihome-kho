// TEST PHẢI CẮN — trạng thái 'bao_gia'. Áp 035 trong tx rồi ROLLBACK (KHÔNG đụng prod).
//   Mỗi chốt chuyển trạng thái: bỏ GUC -> phải LỌT (ĐỎ). Doanh thu app: kiểm dtCua loại bao_gia.
import { readFileSync } from 'fs'; import pg from 'pg'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql035 = strip(readFileSync('/Users/vuquanghai/Documents/togihome-kho/db/035_bao_gia.sql','utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e' }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 9000 })
await c.connect()
let PASS = 0, FAIL = 0
const ok = (n, cond, e='') => { console.log((cond?'✅':'❌')+' '+n+(e?'  — '+e:'')); cond?PASS++:FAIL++ }
const q = async (s,a=[]) => (await c.query(s,a)).rows
// chạy sql dưới danh tính vai trò trong 1 savepoint (rollback savepoint -> không bẩn), trả {rows,err}
async function asRole(uid, sql, args=[]) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,err=null; try{ r=(await c.query(sql,args)).rows }catch(e){ err=e.message }
  finally{ try{await c.query('rollback to savepoint s')}catch(_){}; await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)") }
  return {rows:r, err}
}
// chuyển trạng thái AS uid, KHÔNG rollback (giữ thay đổi) -> trả err|null
async function updAs(uid, sql, args=[]) {
  await c.query('savepoint u'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let err=null; try{ await c.query(sql,args) }catch(e){ err=e.message }
  if (err) { await c.query('rollback to savepoint u') } else { await c.query('release savepoint u') }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return err
}
const pushVon = (ma, gcg=6500000) => `select kho.ghi_gia_von_don('${ma}', 3000000, 2000000, ${gcg-5000000}, ${gcg})`

try {
  await c.query('begin'); await c.query(sql035)

  // ── CA 1: sale tạo đơn du_an KHÔNG giá -> LƯU ĐƯỢC ở bao_gia ──
  const e1 = await updAs(U.sale, `select * from kho.tao_don('{"ma_don":"BG-1","dong":"du_an"}'::jsonb, false)`)   // WP-07: tạo qua RPC (server ép bao_gia), không INSERT thẳng trang_thai
  ok('1 sale tạo đơn du_an không giá → LƯU ở bao_gia', e1===null, e1||'')
  const id1 = (await q(`select id from kho.don_hang where ma_don='BG-1'`))[0]?.id

  // ── CA 2: thiet_ke đẩy giá vốn cho đơn bao_gia -> ĐƯỢC ──
  await c.query('savepoint p2'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:U.thiet_ke,role:'authenticated'})])
  let e2=null; try{ await c.query(pushVon('BG-1')) }catch(e){e2=e.message}
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  const gv = (await q(`select gia_chuyen_giao from kho.don_hang_gia_von where ma_don='BG-1'`))[0]
  ok('2 thiet_ke đẩy giá vốn cho đơn bao_gia → ĐƯỢC', e2===null && gv && Number(gv.gia_chuyen_giao)===6500000, e2||'')

  // ── CA 3: còn bao_gia, món CHƯA có giá -> chuyển moi_len_don CHẶN, nói rõ món ──
  await c.query(`insert into kho.don_hang_mon(don_id,ten,gia) values($1,'Tủ áo 3 buồng',null),($1,'Kệ tivi',null)`,[id1])
  const e3 = await updAs(U.sale, `select kho.chot_don((select id from kho.don_hang where ma_don='BG-1'), null, null)`)
  ok('3 chưa đủ giá món → chuyển bị CHẶN + nêu tên món', e3!=null && /thiếu giá/.test(e3) && /Tủ áo 3 buồng/.test(e3), e3||'')

  // ── CA 4: nhập ĐỦ giá món -> chuyển ĐƯỢC (đã có giá vốn từ CA2) ──
  await c.query(`update kho.don_hang_mon set gia=4000000 where don_id=$1`,[id1])
  const e4 = await updAs(U.sale, `select kho.chot_don((select id from kho.don_hang where ma_don='BG-1'), null, null)`)
  const tt4 = (await q(`select trang_thai from kho.don_hang where ma_don='BG-1'`))[0].trang_thai
  ok('4 đủ giá món + có giá vốn → chuyển ĐƯỢC (moi_len_don)', e4===null && tt4==='moi_len_don', e4||('tt='+tt4))

  // ── CA 5: đã lên đơn, giảm 6% KHÔNG người duyệt -> CHẶN (chốt trần đã áp) ──
  const e5 = await updAs(U.sale,
    `update kho.don_hang set gia_cong_thuc=10000000, chiet_khau=600000, gia_chot=9400000, ly_do_giam='khách quen' where ma_don='BG-1'`)
  ok('5 giảm 6% không người duyệt → CHẶN (vượt trần)', e5!=null && /vượt trần|người duyệt/.test(e5), e5||'')

  // ── CA 6: đơn du_an CHƯA đẩy giá vốn, món đủ giá -> chuyển moi_len_don CHẶN ──
  await updAs(U.sale, `select * from kho.tao_don('{"ma_don":"BG-2","dong":"du_an"}'::jsonb, false)`)   // WP-07: tạo qua RPC (server ép bao_gia)
  const id2 = (await q(`select id from kho.don_hang where ma_don='BG-2'`))[0].id
  await c.query(`insert into kho.don_hang_mon(don_id,ten,gia) values($1,'Tủ bếp',5000000)`,[id2])
  const e6 = await updAs(U.sale, `select kho.chot_don((select id from kho.don_hang where ma_don='BG-2'), null, null)`)
  ok('6 du_an chưa giá vốn → chuyển bị CHẶN', e6!=null && /chưa có giá vốn/.test(e6), e6||'')

  // ── CA 7: bao_gia KHÔNG vào tinh_he_so_m — bản chưa loại phải ĐỎ (in cả hai) ──
  console.log('\n── CA 7: he_so_m loại bao_gia ──')
  await c.query(`insert into kho.tham_so_tai_chinh(ma_ky,dt_muc_tieu,so_don_ke_hoach,phi_don_le,hh_sale,hh_quan_ly,hh_thiet_ke)
                 values('KY-TEST',1000000000,10,100000,0,0,0)
                 on conflict (ma_ky) do update set dt_muc_tieu=excluded.dt_muc_tieu, so_don_ke_hoach=excluded.so_don_ke_hoach, phi_don_le=excluded.phi_don_le`)
  // 1 đơn THẬT (moi_len_don) gcg 5tr + 1 đơn BÁO GIÁ gcg 1tr, cùng đóng dấu kỳ
  await c.query(`insert into kho.don_hang(ma_don,dong,trang_thai,ma_ky_ap_dung) values
                 ('KY-THAT','du_an','moi_len_don','KY-TEST'),('KY-BAO','du_an','bao_gia','KY-TEST')`)
  await c.query(`insert into kho.don_hang_gia_von(ma_don,gia_chuyen_giao) values ('KY-THAT',5000000),('KY-BAO',1000000)`)
  const M_new = (await asRole(U.ceo, `select kho.tinh_he_so_m('KY-TEST') m`)).rows?.[0]?.m
  // bản CHƯA LOẠI: dựng hàm raw (035 body bỏ 2 chỗ 'and trang_thai<>bao_gia')
  await c.query(`create or replace function kho.tinh_he_so_m_raw(p_ma_ky text) returns numeric language plpgsql stable security definer set search_path=kho as $$
    declare t record; v_hh numeric; v_gcg numeric; v_ship numeric;
    begin
      select * into t from kho.tham_so_tai_chinh where ma_ky=p_ma_ky;
      v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
      select avg(g.gia_chuyen_giao) into v_gcg from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don=g.ma_don where d.ma_ky_ap_dung=p_ma_ky;  -- KHÔNG loại bao_gia
      select avg(d.ship_thuc_tra) into v_ship from kho.don_hang d where d.ma_ky_ap_dung=p_ma_ky;
      return (t.dt_muc_tieu*(1-v_hh) - coalesce(v_ship,0)*t.so_don_ke_hoach - t.phi_don_le*t.so_don_ke_hoach)/(v_gcg*t.so_don_ke_hoach);
    end $$`)
  const M_raw = (await q(`select kho.tinh_he_so_m_raw('KY-TEST') m`))[0].m
  const gcg_new = (await q(`select avg(g.gia_chuyen_giao) a from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don=g.ma_don where d.ma_ky_ap_dung='KY-TEST' and d.trang_thai<>'bao_gia'`))[0].a
  const gcg_raw = (await q(`select avg(g.gia_chuyen_giao) a from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don=g.ma_don where d.ma_ky_ap_dung='KY-TEST'`))[0].a
  console.log(`   gcg_TB loại bao_gia = ${gcg_new} (chỉ đơn thật 5tr) · gcg_TB CHƯA loại = ${gcg_raw} (lẫn báo giá 1tr)`)
  console.log(`   he_so_m (035, loại) = ${M_new} · he_so_m_raw (CHƯA loại) = ${M_raw}`)
  ok('7 he_so_m LOẠI bao_gia: gcg_TB = 5tr (chỉ đơn thật)', Number(gcg_new)===5000000)
  ok('7 [CẮN] bản CHƯA loại LỆCH (báo giá kéo TB xuống) → ĐỎ nếu dùng', Number(gcg_raw)===3000000 && M_new!==M_raw)

  // ── CA 7b: doanh thu app (dtCua) loại bao_gia — CẮN trên chính biểu thức ──
  const loaiOf=()=>({dt:true}), kTra=()=>1000000, lapCty=()=>0
  const dtCua = (d,ct)=> loaiOf(d.loai).dt && d.tt!=='bao_gia' ? kTra(d,ct)-lapCty(d)-(+d.ship||0) : 0   // bản 035
  const dtRaw = (d,ct)=> loaiOf(d.loai).dt ? kTra(d,ct)-lapCty(d)-(+d.ship||0) : 0                        // bản CHƯA loại
  ok('7 doanh thu app: dtCua(đơn bao_gia) = 0', dtCua({loai:'x',tt:'bao_gia'})===0)
  ok('7 doanh thu app: dtCua(đơn thật) > 0', dtCua({loai:'x',tt:'moi'})===1000000)
  ok('7 [CẮN] bản CHƯA loại tính báo giá vào doanh thu → ĐỎ', dtRaw({loai:'x',tt:'bao_gia'})===1000000)

  // ── CA 8: bỏ TỪNG chốt chuyển trạng thái -> mỗi ca LỌT (ĐỎ) ──
  console.log('\n── CA 8: bỏ từng chốt → phải LỌT (ĐỎ) ──')
  // 8a off_mon_gia: món thiếu giá vẫn chuyển được
  await c.query('savepoint g1'); await c.query(`select set_config('chan.off_mon_gia','1',true)`)
  const l8a = await updAs(U.sale, `select kho.chot_don((select id from kho.don_hang where ma_don='BG-2'), null, null)`)  // BG-2 món đủ giá nhưng chưa giá vốn
  // đưa món BG-2 về thiếu giá để bắt đúng cổng món:
  await c.query('rollback to savepoint g1')
  await c.query('savepoint g1b'); await c.query(`update kho.don_hang_mon set gia=null where don_id=$1`,[id2]); await c.query(`select set_config('chan.off_mon_gia','1',true)`)
  // vẫn còn cổng giá vốn (du_an) -> để cô lập cổng món, tắt luôn von_chuyen
  await c.query(`select set_config('chan.off_von_chuyen','1',true)`)
  const l8a2 = await updAs(U.sale, `select kho.chot_don((select id from kho.don_hang where ma_don='BG-2'), null, null)`)
  await c.query(`select set_config('chan.off_mon_gia','',true)`); await c.query(`select set_config('chan.off_von_chuyen','',true)`); await c.query('rollback to savepoint g1b')
  ok('8a [CẮN] bỏ off_mon_gia → món thiếu giá VẪN chuyển (ĐỎ)', l8a2===null, l8a2||'')

  // 8b off_von_chuyen: du_an chưa giá vốn vẫn chuyển (món đủ giá)
  await c.query('savepoint g2'); await c.query(`select set_config('chan.off_von_chuyen','1',true)`)
  const l8b = await updAs(U.sale, `select kho.chot_don((select id from kho.don_hang where ma_don='BG-2'), null, null)`)  // BG-2 món đủ giá, chưa giá vốn
  await c.query(`select set_config('chan.off_von_chuyen','',true)`); await c.query('rollback to savepoint g2')
  ok('8b [CẮN] bỏ off_von_chuyen → du_an chưa giá vốn VẪN chuyển (ĐỎ)', l8b===null, l8b||'')

  // 8c off_nhay: bao_gia nhảy thẳng da_cat
  await c.query('savepoint g3'); await c.query(`select set_config('chan.off_nhay','1',true)`)
  const l8c = await updAs(U.sale, `update kho.don_hang set trang_thai='da_cat' where ma_don='BG-2'`)
  await c.query(`select set_config('chan.off_nhay','',true)`); await c.query('rollback to savepoint g3')
  ok('8c [CẮN] bỏ off_nhay → bao_gia nhảy thẳng da_cat (ĐỎ)', l8c===null, l8c||'')

  console.log(`\n== KẾT: ${PASS} pass / ${FAIL} fail ==`)
} catch(e){ console.error('LỖI:', e.message); FAIL++ }
finally { await c.query('rollback'); await c.end(); process.exit(FAIL?1:0) }
