// WP-14b L-3 · TEST đóng dấu ma_ky_ap_dung lúc chốt. BEGIN/ROLLBACK — không để rác.
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { readFileSync } from 'fs'
const cfg = await docConfig(); cfg.statement_timeout = 20000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const CEO = '76763d59-6146-472a-89c7-1e8327b77090'
const asCeo = async () => { await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: CEO, role: 'authenticated' })]) }
const reset = async () => { await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)") }
async function taoBaoGia(ma) {
  const r = await c.query("select id from kho.tao_don($1, false, null)", [{ ma_don: ma, dong: 'le', ten_khach: 'DEMO ' + ma, gia_cong_thuc: 5000000, gia_chot: 5000000, nguon_khach: 'khac' }])
  return r.rows[0].id
}
try {
  await c.query('begin'); await asCeo()
  const kyNow = (await c.query('select kho.ky_gia_hien_hanh() k')).rows[0].k
  console.log('  ky_gia_hien_hanh() hiện =', kyNow)

  // 3.1 chốt 1 đơn → ma_ky_ap_dung = kỳ cổng giá đang trả
  await c.query('savepoint s1')
  const id1 = await taoBaoGia('DDK-1')
  const res1 = (await c.query("select kho.chot_don($1,'khac','khanhconcept') r", [id1])).rows[0].r
  const mk1 = (await c.query('select ma_ky_ap_dung from kho.don_hang where id=$1', [id1])).rows[0].ma_ky_ap_dung
  ok('3.1 chốt → ma_ky_ap_dung = ky_gia_hien_hanh (' + mk1 + ') · thieu_tham_so=' + res1.thieu_tham_so, mk1 === kyNow && res1.thieu_tham_so === false, JSON.stringify(res1))
  await c.query('rollback to savepoint s1')

  // 3.2 hai đơn CÙNG NGÀY, hai kỳ khác nhau (thêm kỳ 2026-09 mới nhất giữa hai lần chốt)
  await c.query('savepoint s2')
  const idA = await taoBaoGia('DDK-A'); await c.query("select kho.chot_don($1,'khac','khanhconcept')", [idA])
  const mkA = (await c.query('select ma_ky_ap_dung from kho.don_hang where id=$1', [idA])).rows[0].ma_ky_ap_dung
  await reset()  // owner để INSERT tham_so
  await c.query("insert into kho.tham_so_tai_chinh(ma_ky, ky_tinh, ngay_ap_dung, vat) values('2026-09','ban_hang','2026-09-01',10)")
  await asCeo()
  const idB = await taoBaoGia('DDK-B'); await c.query("select kho.chot_don($1,'khac','khanhconcept')", [idB])
  const mkB = (await c.query('select ma_ky_ap_dung from kho.don_hang where id=$1', [idB])).rows[0].ma_ky_ap_dung
  ok('3.2 cùng ngày · hai kỳ khác nhau: đơn A=' + mkA + ' · đơn B=' + mkB + ' (chứng KHÔNG suy theo ngày)', mkA !== mkB && mkB === '2026-09', 'A=' + mkA + ' B=' + mkB)
  await c.query('rollback to savepoint s2')

  // 3.3 sửa ma_ky_ap_dung đã có → trigger chặn
  await c.query('savepoint s3')
  const id3 = await taoBaoGia('DDK-3'); await c.query("select kho.chot_don($1,'khac','khanhconcept')", [id3])
  await reset()  // UPDATE dưới OWNER để thử TRIGGER (không phải quyền cột — grant client đã revoke db/214)
  let e3 = null
  await c.query('savepoint s3b')
  try { await c.query("update kho.don_hang set ma_ky_ap_dung='9999-99' where id=$1", [id3]) }
  catch (e) { e3 = e.message.split('\n')[0]; await c.query('rollback to savepoint s3b') }
  await asCeo()
  ok('3.3 sửa ma_ky_ap_dung đã đóng dấu → CHẶN', e3 && /đã đóng dấu/.test(e3), e3 || 'KHÔNG chặn!')
  console.log('     ↳ nguyên văn: ' + (e3 || ''))
  await c.query('rollback to savepoint s3')

  // 3.4 PROVE-RED: redefine chot_don KHÔNG stamp → ma_ky_ap_dung NULL
  await c.query('savepoint s4'); await reset()
  await c.query(`create or replace function kho.chot_don(p_don_id uuid, p_nguon_khach text, p_thuong_hieu text)
    returns jsonb language plpgsql security definer set search_path to 'kho','public' as $f$
    begin update kho.don_hang set trang_thai='moi_len_don', thuong_hieu=coalesce(nullif(btrim(p_thuong_hieu),''),thuong_hieu) where id=p_don_id;
      return jsonb_build_object('ok',true); end $f$`)
  await asCeo()
  const id4 = await taoBaoGia('DDK-4'); await c.query("select kho.chot_don($1,'khac','khanhconcept')", [id4])
  const mk4 = (await c.query('select ma_ky_ap_dung from kho.don_hang where id=$1', [id4])).rows[0].ma_ky_ap_dung
  ok('3.4 PROVE-RED: chot_don GỠ dòng stamp → ma_ky_ap_dung = ' + mk4 + ' (NULL = canh biết kêu)', mk4 === null, 'ra ' + mk4)
  await c.query('rollback to savepoint s4')  // trả lại chot_don thật

  await c.query('rollback')

  // 3.5 probe quyền REST (ngoài tx): PATCH ma_ky_ap_dung JWT sale → 403
  const renv = p => Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
  const env = renv(new URL('./.env.robot', import.meta.url)), app = renv(new URL('../.env', import.meta.url))
  const tok = (await fetch(`${app.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: app.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.TEST_SALE_EMAIL, password: env.TEST_SALE_PASS }) }).then(r => r.json())).access_token
  const pr = await fetch(`${app.VITE_SUPABASE_URL}/rest/v1/don_hang?ma_don=eq.__none__`, { method: 'PATCH', headers: { apikey: app.VITE_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'Accept-Profile': 'kho', 'Content-Profile': 'kho', Prefer: 'return=minimal' }, body: JSON.stringify({ ma_ky_ap_dung: 'x' }) })
  const body = (await pr.text()).slice(0, 120)
  ok('3.5 PATCH ma_ky_ap_dung JWT sale → 403 (db/214 chưa hở)', pr.status === 403, pr.status + ' ' + body)
  console.log('     ↳ nguyên văn: HTTP ' + pr.status + ' ' + body)
} catch (e) { console.log('LỖI:', e.message); try { await c.query('rollback') } catch {}; F++ }
console.log(`\n═══ test_dong_dau_ky: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
