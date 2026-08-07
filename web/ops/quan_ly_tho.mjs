// Quản lý tài khoản THỢ. Kết nối DB qua docConfig() (DB_HOST/DB_USER/DB_PASS trong môi trường, KHÔNG ghi file).
// Ba lệnh:
//   node quan_ly_tho.mjs tao   <ten> "<họ tên đầy đủ>"   -> tạo auth + nguoi_dung(tho), IN MÃ ĐẦY ĐỦ 1 lần
//   node quan_ly_tho.mjs ngung <ten>                     -> dang_hoat_dong=false (KHÔNG xoá)
//   node quan_ly_tho.mjs liet_ke                         -> tên · họ tên · trạng thái (KHÔNG in mã)
//
// Mã cá nhân = <ten>-<4 ký tự>. Tên = email tho<ten>@kho.local; 4 ký tự = MẬT KHẨU (khác tên đăng nhập).
// Idempotent theo hướng AN TOÀN: tên đã tồn tại -> BÁO LỖI & DỪNG (không ghi đè mật khẩu người đang làm).
import pg from 'pg'
import crypto from 'crypto'
import { docConfig } from './conn.mjs'

const [, , lenh, ten, hoTen] = process.argv
const KY_TU = 'abcdefghijkmnpqrstuvwxyz23456789'   // bỏ ký tự dễ nhầm (l,o,0,1)
const genDuoi = () => Array.from(crypto.randomBytes(4)).map(b => KY_TU[b % KY_TU.length]).join('')
const emailCua = t => `tho${t}@kho.local`
const tenTuEmail = e => e.replace(/^tho/, '').replace(/@kho\.local$/, '')
const che = s => s.length <= 2 ? '****' : s.slice(0, 2) + '*'.repeat(Math.max(2, s.length - 2))

async function main() {
  const c = new pg.Client(await docConfig()); await c.connect()
  try {
    if (lenh === 'tao') {
      if (!/^[a-z]{2,12}$/.test(ten || '')) throw new Error('Tên phải 2-12 chữ thường không dấu. VD: thu')
      if (!hoTen || !hoTen.trim()) throw new Error('Thiếu họ tên đầy đủ (đối số thứ 2, trong ngoặc kép).')
      const email = emailCua(ten)
      const da = await c.query('select id from auth.users where email=$1', [email])
      if (da.rows.length) throw new Error(`Tên "${ten}" (${email}) ĐÃ tồn tại — KHÔNG ghi đè. Dừng.`)
      const duoi = genDuoi()
      await c.query('begin')
      const uid = (await c.query(
        `insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
           created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
         values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',$1,
           crypt($2,gen_salt('bf')),now(),now(),now(),
           '{"provider":"email","providers":["email"]}','{}') returning id`, [email, duoi])).rows[0].id
      // GoTrue cần các cột token = '' (KHÔNG NULL), nếu không signIn báo "Database error querying schema".
      const tokCols = ['confirmation_token', 'recovery_token', 'email_change', 'email_change_token_new',
        'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token']
      const co = (await c.query(`select column_name from information_schema.columns
        where table_schema='auth' and table_name='users' and data_type in ('character varying','text') and column_name = any($1)`, [tokCols])).rows.map(r => r.column_name)
      if (co.length) await c.query(`update auth.users set ${co.map(x => `${x}=coalesce(${x},'')`).join(', ')} where id=$1`, [uid])
      await c.query(
        `insert into auth.identities (id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
         values (gen_random_uuid(),$1::text,$2::uuid,jsonb_build_object('sub',$2::text,'email',$1::text),'email',now(),now(),now())
         on conflict (provider_id,provider) do update set identity_data=excluded.identity_data, updated_at=now()`,
        [email, String(uid)])
      await c.query(
        `insert into kho.nguoi_dung (auth_uid,ho_ten,vai_tro,dang_hoat_dong) values ($1,$2,'tho',true)
         on conflict (auth_uid) do update set ho_ten=excluded.ho_ten, vai_tro='tho', dang_hoat_dong=true`,
        [uid, hoTen.trim()])
      await c.query('commit')
      console.log('\n═══ ĐÃ TẠO THỢ — CHÉP MÃ NGAY (in 1 lần, KHÔNG xem lại được) ═══')
      console.log(`  Họ tên : ${hoTen.trim()}`)
      console.log(`  MÃ     : ${ten}-${duoi}`)
      console.log('  Đưa mã này cho thợ. Mất mã -> phải tạo lại (không tra lại được).\n')
    } else if (lenh === 'ngung') {
      if (!ten) throw new Error('Thiếu tên. VD: node quan_ly_tho.mjs ngung thu')
      const email = emailCua(ten)
      const r = await c.query(
        `update kho.nguoi_dung nd set dang_hoat_dong=false, sua_luc=now()
         from auth.users u where u.email=$1 and nd.auth_uid=u.id and nd.vai_tro='tho'
         returning nd.ho_ten`, [email])
      if (!r.rowCount) throw new Error(`Không thấy thợ tên "${ten}" (${email}).`)
      console.log(`✅ Đã NGỪNG thợ "${ten}" (${r.rows[0].ho_ten}). Tài khoản GIỮ nguyên, chỉ dang_hoat_dong=false.`)
    } else if (lenh === 'liet_ke') {
      const r = await c.query(
        `select u.email, nd.ho_ten, nd.dang_hoat_dong
         from kho.nguoi_dung nd join auth.users u on u.id=nd.auth_uid
         where nd.vai_tro='tho' order by nd.dang_hoat_dong desc, u.email`)
      console.log(`\n═══ THỢ (${r.rows.length}) ═══`)
      r.rows.forEach(x => console.log(`  ${tenTuEmail(x.email).padEnd(14)} ${x.dang_hoat_dong ? '● hoạt động' : '○ đã ngừng '}  ${x.ho_ten}`))
      console.log('  (mã cá nhân KHÔNG in — chỉ có lúc tạo)\n')
    } else {
      throw new Error('Lệnh phải là: tao | ngung | liet_ke')
    }
  } catch (e) {
    try { await c.query('rollback') } catch {}
    console.error('❌', e.message); process.exitCode = 2
  } finally { await c.end() }
}
main()
