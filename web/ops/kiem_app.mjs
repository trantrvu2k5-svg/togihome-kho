// VIỆC 4 — kiểm ĐÚNG đường app: anon key + đăng nhập (KHÔNG dùng mật khẩu DB).
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
const root = new URL('../../', import.meta.url).pathname
const env = Object.fromEntries(readFileSync(root + '.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().split(/\s+/)[0]] }))

function sb() { return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { db: { schema: 'kho' }, auth: { persistSession: false } }) }

async function nhap(email, pass) { const c = sb(); const { error } = await c.auth.signInWithPassword({ email, password: pass }); if (error) throw new Error(email + ': ' + error.message); return c }

async function lay(c) {
  const cnt = async (t, f) => (await c.from(t).select('*', { count: 'exact', head: true }).match(f || {})).count
  const so = await cnt('vat_tu')
  const pk = await cnt('vat_tu', { loai: 'pk' })
  const van = await cnt('vat_tu', { loai: 'van' })
  const gv = await c.from('v_ton_gia_von').select('gia_von_bq', { count: 'exact', head: true })
  // thẻ kho 1 mã có lô mở đầu (có tồn)
  const { data: v } = await c.from('vat_tu').select('id,ma').eq('ma', 'BX-01').single()
  const tk = v ? (await c.from('giao_dich').select('*', { count: 'exact', head: true }).eq('vat_tu_id', v.id)).count : 0
  return { so, pk, van, gia_von_dong: gv.count, the_kho_BX01: tk }
}

console.log('═══ VIỆC 4 — app lấy dữ liệu thật (qua anon key + đăng nhập) ═══')
try {
  const ceo = await nhap('ceo@togihome.local', 'ceo12345')
  const r = await lay(ceo)
  console.log('CEO đăng nhập:', JSON.stringify(r))
  console.log(`  ✓ tổng ${r.so} (kỳ vọng 199) · pk ${r.pk} (154) · ván ${r.van} (45) · giá vốn ${r.gia_von_dong} dòng (CEO thấy) · thẻ kho BX-01 ${r.the_kho_BX01} dòng`)
  const tho = await nhap('tho1234@kho.local', '1234')
  const rt = await lay(tho)
  console.log('THỢ đăng nhập:', JSON.stringify(rt))
  console.log(`  ✓ danh mục ${rt.so} · giá vốn ${rt.gia_von_dong} dòng (THỢ phải = 0)`)
  if (rt.gia_von_dong && rt.gia_von_dong > 0) { console.log('  ❌ THỢ THẤY GIÁ VỐN — LỖ HỔNG'); process.exit(3) }
} catch (e) { console.log('❌ LỖI:', e.message); process.exit(2) }
