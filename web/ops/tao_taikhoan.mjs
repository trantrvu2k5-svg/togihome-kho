// Tạo 3 tài khoản thử qua DATABASE_URL (+DB_PASS): auth.users + auth.identities + kho.nguoi_dung.
// Câu lệnh tham số hoá (không dùng DO block vì DO không nhận $1). Idempotent.
import pg from 'pg'
import { docConfig } from './conn.mjs'
const client = new pg.Client(await docConfig())

const users = [
  { email: 'ceo@togihome.local', pass: 'ceo12345', ten: 'CEO Thử', vai: 'ceo' },
  { email: 'kho@togihome.local', pass: 'kho12345', ten: 'Thủ kho Thử', vai: 'kho' },
  { email: 'tho1234@kho.local', pass: '1234', ten: 'Thợ Thử', vai: 'tho' },
]

async function taoUser(u) {
  const { rows } = await client.query('select id from auth.users where email=$1', [u.email])
  let uid
  if (!rows.length) {
    uid = (await client.query(
      `insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
         created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
       values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',$1,
         crypt($2,gen_salt('bf')),now(),now(),now(),
         '{"provider":"email","providers":["email"]}','{}') returning id`, [u.email, u.pass])).rows[0].id
  } else {
    uid = rows[0].id
    await client.query(`update auth.users set encrypted_password=crypt($2,gen_salt('bf')),
      email_confirmed_at=now(), updated_at=now() where id=$1`, [uid, u.pass])
  }
  await client.query(
    `insert into auth.identities (id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
     values (gen_random_uuid(),$1::text,$2::uuid,jsonb_build_object('sub',$2::text,'email',$1::text),'email',now(),now(),now())
     on conflict (provider_id,provider) do update set identity_data=excluded.identity_data, updated_at=now()`,
    [u.email, String(uid)])
  await client.query(
    `insert into kho.nguoi_dung (auth_uid,ho_ten,vai_tro) values ($1,$2,$3)
     on conflict (auth_uid) do update set ho_ten=excluded.ho_ten, vai_tro=excluded.vai_tro`,
    [uid, u.ten, u.vai])
  return uid
}

try {
  await client.connect()
  for (const u of users) {
    try { const id = await taoUser(u); console.log(`  ✅ ${u.vai.padEnd(3)} ${u.email}  (${id.slice(0, 8)}…)`) }
    catch (e) { console.log(`  ❌ ${u.vai} ${u.email}: ${e.message}`) }
  }
  const { rows } = await client.query('select vai_tro, count(*) c from kho.nguoi_dung group by 1 order by 1')
  console.log('nguoi_dung:', rows.map(r => `${r.vai_tro}=${r.c}`).join(' · '))
} catch (e) { console.error('❌ LỖI:', e.message); process.exit(2) } finally { await client.end() }
