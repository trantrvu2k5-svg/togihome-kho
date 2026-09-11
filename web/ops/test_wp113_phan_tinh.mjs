// TEST WP-113 L-113-3 — ads_bang_ky (tách loại + số web/nhắn-tin) · ads_viec_phai_lam (dòng mới) ·
//   ads_suc_khoe_mau (ket_luan_ma). Owner tx + giả vai ceo, ROLLBACK. Mốc 2099 để cô lập số thật.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 170) : '')); v ? P++ : F++ }
const CEO = (await c.query(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).rows[0].a
const asCeo = async () => { await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:CEO,role:'authenticated'})]) }
const owner = async () => { await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`) }
const rpc = async (fn,a,b) => (await c.query(`select kho.${fn}($1::date,$2::date) j`,[a,b])).rows[0].j
// chèn 1 dòng CDN
const cd = async (o) => c.query(`insert into kho.chi_chien_dich_ngay(act_id,campaign_id,campaign_name,objective,ngay,chi_tieu,hien_thi,luot_bam,luot_bam_link,tien_te,nguon,nhan_vat,keo_luc,luot_vao_trang,bam_ra_web,cuoc_tro_chuyen,lien_he_pixel,mua_pixel,kiem_dang)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,'VND','meta_insights','chua_ro_vat',now(),$10,$11,$12,$13,$14,$15)`,
  [o.act,o.cid,o.ten,o.obj,o.ngay,o.chi,o.ht??0,o.lb??0,o.lbl??0,o.vt??null,o.rw??null,o.cuoc??null,o.lh??null,o.mua??null,o.kd??null])
try {
  await c.query('begin')
  await c.query(`select set_config('kho.meta_he_thong','1',true)`)
  const TU='2099-09-04', DEN='2099-09-10'
  // W-LOIWEB (web): Σht=1500 vt=50 rw=250 → tới trang 20 <70 → loi_web
  for (let i=4;i<=8;i++) await cd({act:'T1',cid:'W-LOIWEB',ten:'Web Lỗi',obj:'OUTCOME_SALES',ngay:`2099-09-0${i}`,chi:100000,ht:300,vt:10,rw:50,cuoc:0,lh:0,mua:0,kd:'du'})
  // W-RW0 (web): rw=0 → toi_trang NULL, không loi_web
  await cd({act:'T1',cid:'W-RW0',ten:'Web RW0',obj:'LINK_CLICKS',ngay:'2099-09-05',chi:200000,ht:1500,vt:5,rw:0,cuoc:0,lh:0,mua:0,kd:'du'})
  // M-GIACUOC (nhắn tin): kỳ chi 3tr cuoc 10 → giá 300k; nền brand 'chưa rõ' có thêm baseline
  await cd({act:'T1',cid:'M-GIACUOC',ten:'Msg Đắt',obj:'MESSAGES',ngay:'2099-09-06',chi:3000000,ht:2000,vt:0,rw:0,cuoc:10,lh:0,mua:0,kd:'du'})
  await cd({act:'T1',cid:'M-BASE',ten:'Msg Nền',obj:'MESSAGES',ngay:'2099-08-20',chi:1000000,ht:2000,vt:0,rw:0,cuoc:100,lh:0,mua:0,kd:'du'})
  // ADSET trái loại: web campaign nhưng adset optimization_goal='CONVERSATIONS' → chua_xep
  await cd({act:'T1',cid:'C-CONFLICT',ten:'Xung đột',obj:'OUTCOME_SALES',ngay:'2099-09-07',chi:50000,ht:400,vt:1,rw:2,cuoc:0,lh:0,mua:0,kd:'du'})
  await c.query(`insert into kho.ads_nhom_quang_cao(adset_id,campaign_id,tai_khoan_id,optimization_goal) values('AS-X','C-CONFLICT','T1','CONVERSATIONS')`)
  // NULL6: 6 cột NULL
  await cd({act:'T1',cid:'C-NULL',ten:'Chưa kéo',obj:'OUTCOME_SALES',ngay:'2099-09-08',chi:70000,ht:500})

  // ── ads_bang_ky ──
  await asCeo()
  const bk = await rpc('ads_bang_ky',TU,DEN)
  const row = (id) => (bk.dong||[]).find(x=>x.campaign_id===id)
  ok('1. loai_chien_dich: web→dan_vao_web · nhắn tin→nhan_tin · adset trái→chua_xep',
     row('W-LOIWEB').loai_chien_dich==='dan_vao_web' && row('M-GIACUOC').loai_chien_dich==='nhan_tin' && row('C-CONFLICT').loai_chien_dich==='chua_xep',
     JSON.stringify([row('W-LOIWEB').loai_chien_dich,row('M-GIACUOC').loai_chien_dich,row('C-CONFLICT').loai_chien_dich]))
  ok('2. chua_xep trả kèm tên', row('C-CONFLICT').campaign_name==='Xung đột', row('C-CONFLICT').campaign_name)
  ok('3. toi_trang_100_bam W-LOIWEB = 20 (50/250×100)', Number(row('W-LOIWEB').toi_trang_100_bam)===20, String(row('W-LOIWEB').toi_trang_100_bam))
  ok('4. mẫu số bấm ra web = 0 → toi_trang NULL', row('W-RW0').toi_trang_100_bam===null, String(row('W-RW0').toi_trang_100_bam))
  ok('5. cột NULL (chưa kéo) → cuoc_tro_chuyen NULL (không 0)', row('C-NULL').cuoc_tro_chuyen===null && row('C-NULL').toi_trang_100_bam===null, JSON.stringify({cuoc:row('C-NULL').cuoc_tro_chuyen,tt:row('C-NULL').toi_trang_100_bam}))
  const tl = bk.tong.chi_theo_loai
  ok('6. Σ ba loại = Σchi kỳ', Number(tl.dan_vao_web)+Number(tl.nhan_tin)+Number(tl.chua_xep) === Number(bk.tong.chi),
     JSON.stringify({...tl,tong:bk.tong.chi}))
  ok('7. gia_1_cuoc M-GIACUOC = 300000 (3tr/10)', Number(row('M-GIACUOC').gia_1_cuoc)===300000, String(row('M-GIACUOC').gia_1_cuoc))

  // ── ads_viec_phai_lam ──
  const vi = await rpc('ads_viec_phai_lam',TU,DEN)
  const has = (loai) => (vi.viec||[]).some(x=>x.loai===loai)
  ok('8. dòng loi_web nổ (W-LOIWEB tới trang 20<70)', has('loi_web'), JSON.stringify((vi.viec||[]).map(x=>x.loai)))
  ok('9. dòng gia_cuoc_tro_chuyen_cao nổ (M-GIACUOC)', has('gia_cuoc_tro_chuyen_cao'), '')
  ok('10. dòng mới có ten_chien_dich[]', (vi.viec||[]).filter(x=>x.loai==='loi_web').every(x=>Array.isArray(x.ten_chien_dich)), '')

  // ── mốc 'loi' → keo_do đầu ──
  await owner()
  await c.query(`insert into kho.ads_moc_keo(nguon,bat_dau_luc,ket_thuc_luc,trang_thai,loi_van_ban,khoang_tu,khoang_den,so_dong_ghi)
    values('meta_chi_chien_dich', now(), now(), 'loi', 'ok 6/12 · ...5507:(#200)...', $1,$2, 6)`,[TU,DEN])
  await asCeo()
  const vi2 = await rpc('ads_viec_phai_lam',TU,DEN)
  ok('11. mốc loi → dòng keo_do ĐỨNG ĐẦU · câu "thiếu 6/12"', vi2.viec[0].loai==='keo_do' && /thiếu 6\/12/.test(vi2.viec[0].cau), JSON.stringify(vi2.viec[0]))

  // ── chặn chung: tuổi < 3 → không kết luận loi_web ──
  await owner()
  await cd({act:'T2',cid:'W-TRE',ten:'Web Trẻ',obj:'OUTCOME_SALES',ngay:DEN,chi:100000,ht:2000,vt:1,rw:100,cuoc:0,lh:0,mua:0,kd:'du'})
  await asCeo()
  const vi3 = await rpc('ads_viec_phai_lam',TU,DEN)
  ok('12. chặn chung: campaign tuổi 1 ngày → KHÔNG có loi_web cho W-TRE', !(vi3.viec||[]).some(x=>x.loai==='loi_web' && (x.ten_chien_dich||[]).includes('Web Trẻ')), '')

  // ── ngưỡng vắng → RAISE (gọi kỳ tháng 8, ty_le_toi_trang hiệu lực 2026-09-01) ──
  let err=null; await c.query('savepoint sr')
  try { await rpc('ads_viec_phai_lam','2026-08-01','2026-08-07') } catch(e){ err=e.message }
  await c.query('rollback to savepoint sr')
  ok('13. ngưỡng mới vắng (kỳ T8) → RAISE', !!err && /thiếu ngưỡng/.test(err||''), err||'(không raise)')

  // ── [3] lien_he flag: W-LOIWEB brand 'chưa rõ' 30d Σlien_he_pixel=0 → cờ true → gia_1_lien_he NULL, luot_lien_he=cuoc ──
  const w = row('W-LOIWEB')
  ok('15. lien_he_chi_tu_quang_cao=true → gia_1_lien_he NULL · luot_lien_he=Σcuoc(0)',
     w.lien_he_chi_tu_quang_cao===true && w.gia_1_lien_he===null && Number(w.luot_lien_he)===0,
     JSON.stringify({f:w.lien_he_chi_tu_quang_cao,g:w.gia_1_lien_he,l:w.luot_lien_he}))
  // ── [2] p_brand lọc: openliving (khác 'chưa rõ' của mọi dòng test) → 0 dòng; chi_theo_loai=0 ──
  const bkOL = (await c.query(`select kho.ads_bang_ky($1::date,$2::date,'openliving') j`,[TU,DEN])).rows[0].j
  ok('16. ads_bang_ky p_brand=openliving → 0 dòng test (không lẫn brand khác) · Σchi 3 loại=0',
     (bkOL.dong||[]).length===0 && Number(bkOL.tong.chi)===0, JSON.stringify({n:(bkOL.dong||[]).length,chi:bkOL.tong.chi}))
  // p_brand='chưa rõ' → chi_theo_loai tổng = Σchi (mọi dòng test là 'chưa rõ')
  const bkCR = (await c.query(`select kho.ads_bang_ky($1::date,$2::date,'chưa rõ') j`,[TU,DEN])).rows[0].j
  const tlCR = bkCR.tong.chi_theo_loai
  ok('17. ads_bang_ky p_brand="chưa rõ": Σ3 loại = Σchi brand', Number(tlCR.dan_vao_web)+Number(tlCR.nhan_tin)+Number(tlCR.chua_xep)===Number(bkCR.tong.chi), JSON.stringify(tlCR))
  const viOL = (await c.query(`select kho.ads_viec_phai_lam($1::date,$2::date,'openliving') j`,[TU,DEN])).rows[0].j
  ok('18. ads_viec_phai_lam p_brand=openliving → không dòng loi_web của "Web Lỗi" (brand chưa rõ)',
     !(viOL.viec||[]).some(x=>x.loai==='loi_web' && (x.ten_chien_dich||[]).includes('Web Lỗi')), '')

  // ── [1] ket_luan_ma 7 mã 1-1 + [1d] mau_can_doi == số mẫu ≠ dang_tot (kỳ THẬT) ──
  const ma7 = ['dang_tot','ctr_duoi_nen','tan_suat_cao','luot_phat_giam','chua_du_so','xep_hang_duoi_tb','chua_ro_thuong_hieu']
  const sk = await rpc('ads_suc_khoe_mau','2026-09-04','2026-09-10')
  const mau = sk.mau||[]
  ok('19. ket_luan_ma mọi mẫu ∈ 7 mã', mau.length>0 && mau.every(m=>ma7.includes(m.ket_luan_ma)), JSON.stringify([...new Set(mau.map(m=>m.ket_luan_ma))]))
  const ma4 = ['ctr_duoi_nen','xep_hang_duoi_tb','tan_suat_cao','luot_phat_giam']
  const loiCount = mau.filter(m=>ma4.includes(m.ket_luan_ma)).length
  const nChuaDu = mau.filter(m=>['chua_du_so','chua_ro_thuong_hieu'].includes(m.ket_luan_ma)).length
  const vireal = await rpc('ads_viec_phai_lam','2026-09-04','2026-09-10')
  const mcd = (vireal.viec||[]).find(x=>x.loai==='mau_can_doi')
  ok('20. [2] mau_can_doi.so_mau == số mẫu 4 mã LỖI (không gồm chua_du_so/chua_ro)', (mcd?Number(mcd.so_mau):0)===loiCount, JSON.stringify({mcd:mcd&&mcd.so_mau,loiCount,nChuaDu}))

  // ── [3] MỐC PIXEL: chèn mốc cho 'chưa rõ' (mọi CD test) → kỳ toàn trước mốc ──
  await c.query('savepoint p3')
  await owner()
  await c.query(`insert into kho.ads_moc_tin_pixel(thuong_hieu,moc_ngay,ly_do,nguoi) values('chưa rõ','2099-09-15','test','ceo')
    on conflict (thuong_hieu) do update set moc_ngay=excluded.moc_ngay`)
  await asCeo()
  const bkM = (await c.query(`select kho.ads_bang_ky($1::date,$2::date) j`,[TU,DEN])).rows[0].j
  const rM = (bkM.dong||[]).find(x=>x.campaign_id==='W-LOIWEB')
  ok('21. [3c] mốc tương lai → so_pixel_chua_tin=true · [3d] web_chua_co_su_kien_lien_he="chua_tin"',
     rM.so_pixel_chua_tin===true && rM.web_chua_co_su_kien_lien_he==='chua_tin', JSON.stringify({s:rM.so_pixel_chua_tin,st:rM.web_chua_co_su_kien_lien_he}))
  ok('22. [3d] "chua_tin" KHÔNG null giá (chỉ "khong" mới null) → gia_1_lien_he có số', rM.gia_1_lien_he!==null || (rM.luot_lien_he===0),
     JSON.stringify({g:rM.gia_1_lien_he,l:rM.luot_lien_he}))
  const viM = (await c.query(`select kho.ads_viec_phai_lam($1::date,$2::date) j`,[TU,DEN])).rows[0].j
  const lwM = (viM.viec||[]).filter(x=>x.loai==='loi_web')
  ok('23. [3e] kỳ toàn trước mốc → loi_web IM (keu=false) + câu "kêu lại từ 12/09" · không dòng keu=true',
     lwM.length>0 && lwM.every(x=>x.keu===false) && lwM.some(x=>/kêu lại từ 12\/09/.test(x.cau)), JSON.stringify(lwM.map(x=>[x.keu,(x.cau||'').slice(0,30)])))
  await c.query('rollback to savepoint p3')

  await c.query('rollback')
} catch(e){ ok('LỖI', false, e.message); await c.query('rollback').catch(()=>{}) }
console.log(`\n═══ test_wp113_phan_tinh: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
