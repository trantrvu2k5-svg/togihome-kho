// SEED L-06 (prod, dọn sau bằng clean_l6.mjs) — baseline TU-BEP + dựng TMP-L6VIEW có bản cũ (cho ảnh ④).
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { writeFileSync } from 'fs'
const c = new pg.Client(await docConfig()); await c.connect()
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
const TH = (await one(`select ma from kho.thuong_hieu limit 1`)).ma
const jwt = async (fn) => { await c.query('begin'); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: CEO, role: 'authenticated' })]); const r = await fn(); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); await c.query('commit'); return r }
// baseline TU-BEP bước đầu + ten
const bd = await one(`select b.thu_tu, round((coalesce(b.gio_moi_don_vi,0)*60)::numeric,1) phut, b.hoat_dong, b.nhanh from kho.quy_trinh_buoc b where b.ma_quy_trinh='TU-BEP-MELAMINE' and b.phien_ban=(select phien_ban from kho.quy_trinh_phien_ban where ma_quy_trinh='TU-BEP-MELAMINE' and trang_thai='hien_hanh') order by thu_tu limit 1`)
const ten = (await one(`select ten from kho.quy_trinh where ma_quy_trinh='TU-BEP-MELAMINE'`)).ten
writeFileSync('/private/tmp/claude-501/-Users-vuquanghai-Documents-togihome-plugin/8bb3d8f3-a1d5-4208-9dd5-c9024898b694/scratchpad/l6base.json', JSON.stringify({ bd, ten }))
console.log('baseline TU-BEP: bước', bd.thu_tu, bd.phut + 'phút · ten="' + ten + '"')
// TMP-L6VIEW: chép TU-BEP → món neo v1 (đơn cho_cat) → copy-on-write ra v2 (có bản cũ)
await c.query(`delete from kho.quy_trinh_phien_ban where ma_quy_trinh='TMP-L6VIEW'`).catch(()=>{})
await c.query(`begin`); await c.query(`set local session_replication_role='replica'`)
await c.query(`delete from kho.don_hang where ma_don='TMP-L6-DON'`)
await c.query(`delete from kho.quy_trinh_buoc where ma_quy_trinh='TMP-L6VIEW'`); await c.query(`delete from kho.quy_trinh_phien_ban where ma_quy_trinh='TMP-L6VIEW'`); await c.query(`delete from kho.quy_trinh where ma_quy_trinh='TMP-L6VIEW'`)
await c.query(`set local session_replication_role='origin'`); await c.query('commit')
await jwt(async () => { await c.query(`select kho.qt_chep('TMP-L6VIEW','[TẠM] xem bản cũ','TU-BEP-MELAMINE')`) })
await c.query('begin'); await c.query(`set local session_replication_role='replica'`)
const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach) values('TMP-L6-DON','x',true,'le','cho_cat',$1,'gioi_thieu') returning id`, [TH])).id
await c.query(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh,quy_trinh_phien_ban,dung_moi,so_luong) values($1,'m',$2,1,false,1)`, [did, 'TMP-L6VIEW'])
await c.query(`set local session_replication_role='origin'`); await c.query('commit')
// copy-on-write: sửa bước đầu (so_mon_dang_chay=1) → phát hành v2
const r = await jwt(async () => (await one(`select kho.qt_luu_buoc('TMP-L6VIEW',$1,$2,'{}','chung',5,'demo phát hành bản mới') j`, [bd.thu_tu, bd.hoat_dong])).j)
console.log('TMP-L6VIEW copy-on-write:', r.che_do, 'v', r.phien_ban_moi)
await c.end()
