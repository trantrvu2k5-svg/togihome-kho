// [L-05f/QD-86] Dọn chuỗi demo don_mua.
//   TRƯỚC: tắt gd_chan_sua (session_replication_role='replica') để DELETE giao_dich (SỔ GHI THÊM, QD-44) + cả chuỗi
//     phieu/lo_nhap/hoa_don_ncc/don_mua (FK ràng vào giao_dich). Đây đúng thứ QD-86 cấm: xoá dòng sổ bằng cách vòng.
//   NAY: KHÔNG tắt trigger, KHÔNG xoá giao_dich. Chuỗi mua chưa có đường ĐẢO (huy_phieu chỉ cho xuat_sx, chưa có
//     "đảo phiếu NHẬP") → để NGUYÊN + báo, không dọn. Robot_wp22 nếu ĐỎ vì tồn demo còn lại = tín hiệu robot phụ thuộc
//     việc xoá sổ; thiết kế lại seed (đảo phiếu nhập / seed trong tx-rollback) là VIỆC RIÊNG, KHÔNG quay lại tắt trigger.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const id = process.argv[2]
try {
  if (!id) throw new Error('cần don_mua_id')
  const ph = (await c.query(`select id from kho.phieu where don_mua_id=$1`, [id])).rows.map(r => r.id)
  const gd = ph.length ? (await c.query(`select count(*)::int n from kho.giao_dich where phieu_id = any($1)`, [ph])).rows[0].n : 0
  console.log(`⚠ _wp22_clean KHÔNG dọn: don_mua ${id} có ${ph.length} phiếu · ${gd} dòng giao_dich (SỔ append-only, QD-44/QD-86).`)
  console.log(`  Không tắt trigger để xoá sổ. Cần đường ĐẢO phiếu nhập (dòng-đảo) — việc riêng. Chuỗi demo để nguyên.`)
} catch (e) { console.error('CLEAN_SKIP', e.message) }
finally { await c.end() }
