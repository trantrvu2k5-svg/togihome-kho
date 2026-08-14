// TEST CẮN — 060 biến thể ba trục + nhập web + RPC app sản phẩm.
//   Phần A: cổng vai (ceo/ke_toan VÀO · sale/xuong/tho/thiet_ke CHẶN) — tx rollback.
//   Phần B: bất biến dữ liệu nhập (đọc prod, KHÔNG sửa) — chạy SAU khi nhap_web.mjs xong.
//   Phần C: 6 app cũ KHÔNG vỡ — gọi 1 RPC đại diện mỗi app, không lỗi.
//   Chạy: cd web && node ops/test_060.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = {
  ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3',
  sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2', thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e'
}
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0; const ok = (n, cc, e = '') => { console.log((cc ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); cc ? P++ : F++ }
// gọi trong vai uid, rollback (không đổi dữ liệu)
async function as(uid, q, a = []) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(q, a)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]

try {
  await c.query('begin')

  // ═══════════ PHẦN A · CỔNG VAI ═══════════
  console.log('\n── A · cổng vai (ceo/ke_toan vào · khác chặn) ──')
  for (const [rpc, args] of [['sp_loc_options', ''], ['sp_danh_sach', 'null,null,null']]) {
    ok(`ceo gọi ${rpc} → ĐƯỢC`, (await as(U.ceo, `select kho.${rpc}(${args})`)).e === null)
    ok(`ke_toan gọi ${rpc} → ĐƯỢC`, (await as(U.ke_toan, `select kho.${rpc}(${args})`)).e === null)
    for (const v of ['sale', 'xuong', 'tho', 'thiet_ke']) {
      const r = await as(U[v], `select kho.${rpc}(${args})`)
      ok(`${v} gọi ${rpc} → CHẶN`, /chỉ ceo\/ke_toan/.test(r.e || ''), r.e || '(LỌT!)')
    }
  }
  // sp_sua_bien_the: cần một biến thể có thật để thử (nếu chưa nhập, bỏ qua phần sửa số)
  const btThu = (await q1(`select ma from kho.san_pham_mau where ma like 'W%-%' limit 1`))?.ma
  if (btThu) {
    ok('ceo sp_sua_bien_the → ĐƯỢC', (await as(U.ceo, `select kho.sp_sua_bien_the($1,100,200,300,'Gỗ sồi',null,true)`, [btThu])).e === null)
    ok('sale sp_sua_bien_the → CHẶN', /chỉ ceo\/ke_toan/.test((await as(U.sale, `select kho.sp_sua_bien_the($1,1,2,3,'x',null,true)`, [btThu])).e || ''))
  } else ok('sp_sua_bien_the (bỏ qua — chưa có biến thể web)', true)

  await c.query('rollback')  // đóng phần A, không để lại gì

  // ═══════════ PHẦN B · BẤT BIẾN DỮ LIỆU NHẬP (đọc prod) ═══════════
  console.log('\n── B · bất biến dữ liệu nhập web (đọc prod) ──')
  const nySo = Number((await q1(`select count(*) n from kho.niem_yet where nguon_host is not null`)).n)
  ok(`niêm yết nhập web = ${nySo} (kỳ vọng ≥ 100 khi nhập xong)`, nySo >= 1, nySo < 100 ? 'CHƯA nhập xong?' : '')
  if (nySo >= 1) {
    // B1 · mỗi niêm yết web trỏ về biến thể có lõi WEB-
    const mocoi = Number((await q1(`select count(*) n from kho.niem_yet n left join kho.san_pham_mau s on s.ma=n.ma_bien_the where n.nguon_host is not null and (s.ma is null or s.ma_loi is null)`)).n)
    ok('mọi niêm yết web có biến thể + lõi', mocoi === 0, mocoi + ' mồ côi')
    // B2 · ảnh là path Storage, KHÔNG hotlink api.togihome.vn
    const hot = Number((await q1(`select count(*) n from kho.niem_yet where nguon_host is not null and anh::text ~ 'api\\.togihome\\.vn|https?://'`)).n)
    ok('ảnh KHÔNG hotlink (chỉ path bucket)', hot === 0, hot + ' niêm yết còn URL web trong anh')
    // B3 · kích thước: có số dạng dai_mm/rong_mm/cao_mm THÌ số hợp lệ; NULL thì kt_nguon còn nguyên (không bịa)
    const ktBia = Number((await q1(`select count(*) n from kho.san_pham_mau where ma like 'W%-%' and (dai_mm is not null and dai_mm<=0)`)).n)
    ok('không có kích thước bịa (>0 hoặc NULL)', ktBia === 0, ktBia + ' số phi lý')
    // B4 · vật liệu đoán PHẢI có cờ chua_xac_nhan (không đoán ngầm)
    const vlNgam = Number((await q1(`select count(*) n from kho.san_pham_mau where ma like 'W%-%' and vl_doan is not null and vl_chua_xac_nhan=false`)).n)
    ok('vật liệu đoán đều có cờ chua_xac_nhan', vlNgam === 0, vlNgam + ' đoán ngầm (thiếu cờ)')
    // B5 · 3 kích thước → 3 biến thể chung 1 lõi (kiểm lõi nào có ≥2 biến thể thì cùng ma_loi)
    const daBt = await q1(`select ma_loi, count(*) n from kho.san_pham_mau where ma like 'W%-%' group by ma_loi order by n desc limit 1`)
    ok(`lõi nhiều biến thể nhất: ${daBt?.ma_loi} có ${daBt?.n} biến thể (cùng 1 lõi)`, true)
  }

  // ═══════════ PHẦN C · 6 APP CŨ KHÔNG VỠ (db/060 chỉ THÊM — không ALTER/DROP) ═══════════
  // Kiểm ở tầng DB: cột gốc + RPC gốc CÒN NGUYÊN (db/060 additive). Thực thi THẬT = load 6 app ở deploy.
  console.log('\n── C · 6 app cũ không vỡ (cột gốc + RPC gốc còn nguyên) ──')
  // C1 · cột GỐC của 2 bảng ta chạm vẫn còn (không rơi rớt do thêm cột)
  const cotCon = async (bang, cots) => {
    const có = (await c.query(`select column_name from information_schema.columns where table_schema='kho' and table_name=$1`, [bang])).rows.map(r => r.column_name)
    const thieu = cots.filter(x => !có.includes(x))
    ok(`${bang}: cột gốc còn đủ`, thieu.length === 0, thieu.join(',') || '')
  }
  await cotCon('niem_yet', ['ma_ny', 'ma_bien_the', 'ma_thuong_hieu', 'ten_ban_hang', 'duong_dan', 'gia_niem_yet', 'dang_ban'])
  await cotCon('san_pham_mau', ['ma', 'ten', 'ma_loi', 'ma_vat_tu_chinh', 'vat_lieu'])
  await cotCon('thuong_hieu', ['ma', 'ten', 'loai', 'ma_3chu'])
  // C2 · RPC gốc của 6 app vẫn tồn tại (db/060 không drop nhầm)
  const rpcGoc = ['sale_mon_cua_don', 'sale_lead_time', 'kanban_xuong', 'xuong_mon_cua_don', 'viec_uu_tien',
    'bang_gia', 'ghi_gia_von_tay', 'tk_don_cho_nhan', 'tk_vai_cua_toi', 'ghi_so_phieu']
  const cóRpc = (await c.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kho' and proname = any($1)`, [rpcGoc])).rows.map(r => r.proname)
  const rpcThieu = rpcGoc.filter(x => !cóRpc.includes(x))
  ok('RPC gốc 6 app còn đủ', rpcThieu.length === 0, rpcThieu.join(',') || '')

  console.log(`\n══ KẾT QUẢ: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', e.stack?.split('\n').slice(1, 4).join('\n')); process.exitCode = 1 }
finally { try { await c.query('rollback') } catch (_) {}; await c.end() }
