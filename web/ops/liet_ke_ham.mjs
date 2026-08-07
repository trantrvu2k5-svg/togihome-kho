import pg from 'pg'
import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const r = await c.query(`
  select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef definer,
    has_function_privilege('public', p.oid, 'EXECUTE') pub,
    has_function_privilege('anon', p.oid, 'EXECUTE') anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='kho' order by p.proname`)
console.log('HÀM trong schema kho:')
for (const x of r.rows) console.log(`  ${x.proname}(${x.args}) · definer=${x.definer} · PUBLIC=${x.pub} anon=${x.anon} auth=${x.auth}`)
await c.end()
