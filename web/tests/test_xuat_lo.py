# -*- coding: utf-8 -*-
# Cổng cho XUẤT KHO TRỪ THEO LÔ (FIFO). Toàn bộ chạy trong MỘT transaction rồi ROLLBACK — KHÔNG để lại dữ liệu.
#   a. tạo mã thử THU-NGHIEM-* riêng (không đụng 199 mã thật)
#   b. nhập lô1 10@1000 -> tồn 10, giá vốn 1000
#   c. nhập lô2 10@2000 -> tồn 20, giá vốn 1500
#   d. xuất 5 -> tồn 15
#   f. sau xuất 5: lô1 con_lai=5, lô2 con_lai=10
#   g. xuất 8: lô1=0, lô2=7 · đúng 2 dòng giao_dich (1 trỏ lô1, 1 trỏ lô2)
#   h. xuất 100 (vượt): ghi được, tồn âm, có dòng giao_dich cờ ton_am
#   i. sau mỗi lần: Σ con_lai = tồn (trừ khi tồn âm)
# Trên HÀM CŨ: a-d PASS; f,g,i FAIL (cũ không trừ con_lai). Trên HÀM MỚI: tất cả PASS.
# Chạy: cd web && DB_HOST=... DB_USER=... DB_PASS=... python3 tests/test_xuat_lo.py
import os
import subprocess
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NODE = r"""
import pg from 'pg'; import { docConfig } from './ops/conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const out = []            // [id, ok, detail]
const chk = (id, ok, d='') => out.push([id, !!ok, d])
const q = async (s, a=[]) => (await c.query(s, a)).rows
const one = async (s, a=[]) => (await q(s, a))[0]
try {
  const ceo = (await one(`select auth_uid from kho.nguoi_dung where vai_tro='ceo' and dang_hoat_dong limit 1`)).auth_uid
  const kid = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  // Chụp mốc THẬT trước begin (đọc trạng thái đã commit) -> sau rollback phải bằng đúng mốc này. KHÔNG số cứng.
  const base = await one(`select (select count(*)::int from kho.vat_tu) vt,(select count(*)::int from kho.phieu) ph,(select round(sum(so_luong*gia_von_bq)) from kho.ton) gt`)
  await c.query('begin')
  await c.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`, [ceo])
  // (a) mã thử riêng
  const tid = (await one(`insert into kho.vat_tu(ma,ten,loai) values('THU-NGHIEM-XL-'||floor(extract(epoch from clock_timestamp()))::text,'Thử xuất lô','pk') returning id`)).id
  await c.query(`insert into kho.ton(vat_tu_id,kho_id,so_luong) values($1,$2,0)`, [tid, kid])
  chk('a', true, 'tạo mã thử')
  const gs = async (loai, dong) => (await one(`select kho.ghi_so_phieu($1,null,$2,null,$3::jsonb) r`, [loai, loai==='xuat'?'Thử':null, JSON.stringify(dong)])).r
  const ton = async () => Number((await one(`select so_luong from kho.ton where vat_tu_id=$1 and kho_id=$2`, [tid, kid])).so_luong)
  const gv  = async () => { const r = await one(`select gia_von_bq from kho.ton where vat_tu_id=$1 and kho_id=$2`, [tid, kid]); return r.gia_von_bq==null?null:Number(r.gia_von_bq) }
  const conlai = async () => (await q(`select id, con_lai from kho.lo_nhap where vat_tu_id=$1 and kho_id=$2 order by tao_luc, id`, [tid, kid])).map(x=>({id:x.id, c:Number(x.con_lai)}))
  const sumcon = async () => Number((await one(`select coalesce(sum(con_lai),0) s from kho.lo_nhap where vat_tu_id=$1 and kho_id=$2`, [tid, kid])).s)
  const gdOf = async (sp) => q(`select gd.lo_nhap_id, gd.so_luong, gd.canh_bao from kho.giao_dich gd join kho.phieu ph on ph.id=gd.phieu_id where ph.so_phieu=$1 order by gd.tao_luc, gd.id`, [sp])

  // (b) nhập lô1 10@1000
  await gs('nhap', [{vat_tu_id: tid, so_luong: 10, don_gia: 1000}])
  const lo1 = (await one(`select id from kho.lo_nhap where vat_tu_id=$1`, [tid])).id
  await c.query(`update kho.lo_nhap set tao_luc='2020-01-01 00:00:01+00' where id=$1`, [lo1])   // ép thứ tự lô rõ ràng (cùng txn now() bằng nhau)
  chk('b', (await ton())===10 && (await gv())===1000, `tồn=${await ton()} giá=${await gv()}`)
  // (c) nhập lô2 10@2000
  await gs('nhap', [{vat_tu_id: tid, so_luong: 10, don_gia: 2000}])
  const lo2 = (await one(`select id from kho.lo_nhap where vat_tu_id=$1 and id<>$2`, [tid, lo1])).id
  await c.query(`update kho.lo_nhap set tao_luc='2020-01-01 00:00:02+00' where id=$1`, [lo2])
  chk('c', (await ton())===20 && (await gv())===1500, `tồn=${await ton()} giá=${await gv()}`)
  // (d) xuất 5 -> tồn 15
  await gs('xuat', [{vat_tu_id: tid, so_luong: 5}])
  chk('d', (await ton())===15, `tồn=${await ton()}`)
  // (f) lô1=5, lô2=10
  { const cl = await conlai(); const c1 = cl.find(x=>x.id===lo1)?.c, c2 = cl.find(x=>x.id===lo2)?.c
    chk('f', c1===5 && c2===10, `lô1=${c1} lô2=${c2}`) }
  // (i sau d) Σcon_lai=tồn
  chk('i-d', (await sumcon())===(await ton()), `Σcon=${await sumcon()} tồn=${await ton()}`)
  // (g) xuất 8 -> lô1=0 lô2=7, 2 dòng giao_dich (lô1+lô2)
  const spg = (await gs('xuat', [{vat_tu_id: tid, so_luong: 8}])).so_phieu
  { const cl = await conlai(); const c1 = cl.find(x=>x.id===lo1)?.c, c2 = cl.find(x=>x.id===lo2)?.c
    const gd = await gdOf(spg); const los = gd.map(g=>g.lo_nhap_id).sort()
    const ok = c1===0 && c2===7 && gd.length===2 && gd.some(g=>g.lo_nhap_id===lo1) && gd.some(g=>g.lo_nhap_id===lo2)
    chk('g', ok, `lô1=${c1} lô2=${c2} · ${gd.length} dòng gd · lô=[${gd.map(g=>g.lo_nhap_id? (g.lo_nhap_id===lo1?'L1':'L2'):'∅').join(',')}]`) }
  chk('i-g', (await sumcon())===(await ton()), `Σcon=${await sumcon()} tồn=${await ton()}`)
  // (h) xuất 100 vượt -> tồn âm + cờ ton_am
  const sph = (await gs('xuat', [{vat_tu_id: tid, so_luong: 100}])).so_phieu
  { const t = await ton(); const gd = await gdOf(sph); const co_canhbao = gd.some(g=>g.canh_bao==='ton_am')
    chk('h', t < 0 && co_canhbao, `tồn=${t} · có cờ ton_am=${co_canhbao}`) }

  await c.query('rollback')
  // sau rollback: dữ liệu thật không đổi
  const nvt = Number((await one(`select count(*)::int n from kho.vat_tu`)).n)
  const nph = Number((await one(`select count(*)::int n from kho.phieu`)).n)
  const ngt = String((await one(`select round(sum(so_luong*gia_von_bq)) g from kho.ton`)).g)
  chk('sạch', nvt===Number(base.vt) && nph===Number(base.ph) && ngt===String(base.gt), `vat_tu=${nvt}/${base.vt} phiếu=${nph}/${base.ph} tồn=${ngt}/${base.gt}`)
} catch (e) {
  try { await c.query('rollback') } catch {}
  chk('LỖI', false, e.message)
} finally { await c.end() }

for (const [id, ok, d] of out) console.log(`CHECK ${id} ${ok?'PASS':'FAIL'}${d?' '+d:''}`)
process.exit(out.every(x=>x[1]) ? 0 : 1)
"""


def main():
    r = subprocess.run(["node", "--input-type=module"], input=NODE, capture_output=True, text=True, cwd=WEB)
    print(r.stdout.strip())
    if r.stderr.strip():
        print("stderr:", r.stderr.strip()[:400])
    fails = [ln for ln in r.stdout.splitlines() if " FAIL" in ln]
    if r.returncode == 0:
        print("\n✅ TẤT CẢ CHECK PASS (xuất trừ theo lô FIFO đúng)")
    else:
        print(f"\n❌ CÓ CHECK FAIL ({len(fails)}): " + ", ".join(x.split()[1] for x in fails))
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
