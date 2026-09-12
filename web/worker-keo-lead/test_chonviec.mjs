import { chonViecCron, chonViecJob } from '/Users/vuquanghai/Documents/togihome-kho/web/worker-keo-lead/src/chonViec.mjs'
let P=0,F=0; const ok=(n,v)=>{console.log((v?'✅':'❌')+' '+n); v?P++:F++}
ok('cron "* * * * *" → lead', chonViecCron('* * * * *')==='lead')
ok('cron "0 19,23,3,7,11,15 * * *" → ads', chonViecCron('0 19,23,3,7,11,15 * * *')==='ads')
try{ chonViecCron('*/5 * * * *'); ok('*/5 ném',false) }catch(e){ ok('*/5 → NÉM ("'+e.message.slice(0,20)+'")', /cron lạ/.test(e.message)) }
try{ chonViecCron(''); ok('"" ném',false) }catch(e){ ok('"" → NÉM', /cron lạ/.test(e.message)) }
ok('job undefined → lead', chonViecJob(undefined)==='lead')
ok('job "ads" → ads', chonViecJob('ads')==='ads')
ok('job "xyz" → null (400)', chonViecJob('xyz')===null)
console.log(`\n═══ test_chonViec: ${P} pass / ${F} fail ═══`); process.exit(F?1:0)
