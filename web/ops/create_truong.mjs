// Tạo 1 tài khoản THẬT vai trò truong_nhom_sale (duyệt giảm 5-8%). Mật khẩu ĐỌC TỪ ENV TRUONG_PASS.
//   KHÔNG viết cứng, KHÔNG giá trị mặc định. auth.users + identities + nguoi_dung + quyen_duyet_giam(truong_nhom).
//   Chạy (từ web/):  TRUONG_PASS='...' DATABASE_URL='...' node ops/create_truong.mjs
import pg from 'pg'
const PASS = process.env.TRUONG_PASS
if (!PASS) { console.error('❌ THIẾU biến môi trường TRUONG_PASS (không có mặc định).'); process.exit(2) }
const EMAIL = process.env.TRUONG_EMAIL || 'truongnhom@togihome.local'
const TEN = 'Trưởng nhóm Sale'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })

try {
  await c.connect()
  const ex = await c.query('select id from auth.users where email=$1', [EMAIL])
  let uid
  if (!ex.rows.length) {
    uid = (await c.query(
      `insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
         created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
         confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,
         phone_change,phone_change_token,reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',$1,
         crypt($2,gen_salt('bf')),now(),now(),now(),
         '{"provider":"email","providers":["email"]}','{}',
         '','','','','','','','') returning id`, [EMAIL, PASS])).rows[0].id
  } else {
    uid = ex.rows[0].id
    await c.query(`update auth.users set encrypted_password=crypt($2,gen_salt('bf')), email_confirmed_at=now(), updated_at=now() where id=$1`, [uid, PASS])
  }
  await c.query(
    `insert into auth.identities (id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
     values (gen_random_uuid(),$1::text,$2::uuid,jsonb_build_object('sub',$2::text,'email',$1::text),'email',now(),now(),now())
     on conflict (provider_id,provider) do update set identity_data=excluded.identity_data, updated_at=now()`, [EMAIL, String(uid)])
  await c.query(
    `insert into kho.nguoi_dung (auth_uid,ho_ten,vai_tro,dang_hoat_dong) values ($1,$2,'truong_nhom_sale',true)
     on conflict (auth_uid) do update set ho_ten=excluded.ho_ten, vai_tro='truong_nhom_sale', dang_hoat_dong=true`, [uid, TEN])
  const nsId = (await c.query('select id from kho.nguoi_dung where auth_uid=$1', [uid])).rows[0].id
  await c.query(`insert into kho.quyen_duyet_giam (ns_id,cap) values ($1,'truong_nhom') on conflict (ns_id) do update set cap='truong_nhom'`, [nsId])
  console.log(`✅ Tạo tài khoản truong_nhom_sale: ${EMAIL} (auth ${String(uid).slice(0,8)}… · ns ${nsId.slice(0,8)}…) · cấp duyệt 5-8%`)
} catch (e) { console.error('❌ LỖI:', e.message); process.exit(2) } finally { await c.end() }
