import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
await c.query('begin'); await c.query(`set local session_replication_role='replica'`)
await c.query(`delete from kho.don_hang_mon where don_id in (select id from kho.don_hang where ma_don='TMP-L6-DON')`)
await c.query(`delete from kho.don_hang where ma_don='TMP-L6-DON'`)
await c.query(`delete from kho.quy_trinh_buoc where ma_quy_trinh='TMP-L6VIEW'`)
await c.query(`delete from kho.quy_trinh_phien_ban where ma_quy_trinh='TMP-L6VIEW'`)
await c.query(`delete from kho.quy_trinh where ma_quy_trinh='TMP-L6VIEW'`)
await c.query(`set local session_replication_role='origin'`); await c.query('commit')
const n = await (await c.query(`select (select count(*)::int from kho.quy_trinh where ma_quy_trinh='TMP-L6VIEW') tmp, (select count(*)::int from kho.quy_trinh_buoc where phien_ban<>1) v`)).rows[0]
console.log('✔ CLEAN L6 · TMP còn=' + n.tmp + ' · bước phien_ban≠1=' + n.v)
await c.end()
