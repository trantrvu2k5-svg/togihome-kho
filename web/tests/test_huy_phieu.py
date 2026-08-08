# -*- coding: utf-8 -*-
# Cổng cho HUỶ PHIẾU BẰNG PHIẾU NGƯỢC. Toàn bộ chạy trong MỘT transaction rồi ROLLBACK — KHÔNG để lại dữ liệu.
# Mã thử tiền tố THU-NGHIEM-*, KHÔNG đụng 199 mã thật.
#   a. nhập 10@1000 ghi sổ -> tồn 10, giá vốn 1000
#   b. huỷ phiếu nhập, lý do hợp lệ -> tồn 0, gv NULL, lô lo_da_huy=true & con_lai=0, phiếu gốc da_huy, có phiếu ngược HN trỏ đúng gốc
#   c. huỷ lại phiếu đó -> phải raise (else "HUỶ ĐƯỢC HAI LẦN")
#   d. nhập lô1 10@1000 + lô2 10@2000 (gv 1500). huỷ phiếu lô2 -> gv về 1000, tồn 10  (chứng minh tính lại giá vốn)
#   e. nhập 10, xuất 3, huỷ phiếu NHẬP -> raise, nêu mã + số đã xuất (else "HUỶ ĐƯỢC PHIẾU ĐÃ XUẤT MỘT PHẦN")
#   f. cùng tình huống: huỷ phiếu XUẤT trước -> được, con_lai trả đủ, tồn 10; rồi huỷ phiếu nhập -> giờ được
#   g. huỷ lý do rỗng -> raise
#   h. gọi huy_phieu bằng vai trò không phải ceo/kho -> raise
#   i. Σ con_lai lô còn sống = tồn (mỗi mã)
#   j. đếm phieu/phieu_dong/giao_dich/lo_nhap trước & sau: sau >= trước (else "ĐÃ XOÁ DỮ LIỆU")
# Chạy: cd web && DB_HOST=... DB_USER=... DB_PASS=... python3 tests/test_huy_phieu.py
import os
import subprocess
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NODE = r"""
import pg from 'pg'; import { docConfig } from './ops/conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const out = []
const chk = (id, ok, d='') => out.push([id, !!ok, d])
const q = async (s, a=[]) => (await c.query(s, a)).rows
const one = async (s, a=[]) => (await q(s, a))[0]
try {
  const ceo = (await one(`select auth_uid from kho.nguoi_dung where vai_tro='ceo' and dang_hoat_dong limit 1`)).auth_uid
  const nonkho = (await one(`select auth_uid from kho.nguoi_dung where vai_tro not in ('ceo','kho') and dang_hoat_dong limit 1`))?.auth_uid || null
  const kid = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  // Chụp mốc THẬT trước begin (trạng thái đã commit) -> sau rollback phải bằng đúng mốc này. KHÔNG số cứng.
  const base = await one(`select (select count(*)::int from kho.vat_tu) vt,(select count(*)::int from kho.phieu) ph,(select round(sum(so_luong*gia_von_bq)) from kho.ton) gt`)
  await c.query('begin')
  const setRole = (uid) => c.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`, [uid])
  await setRole(ceo)

  // đếm TRƯỚC (cho mục j)
  const counts = async () => {
    const r = await one(`select (select count(*)::int from kho.phieu) p,(select count(*)::int from kho.phieu_dong) pd,
                                (select count(*)::int from kho.giao_dich) gd,(select count(*)::int from kho.lo_nhap) l`)
    return {p:r.p, pd:r.pd, gd:r.gd, l:r.l} }
  const before = await counts()

  const mkma = async (tag) => {
    const id = (await one(`insert into kho.vat_tu(ma,ten,loai) values('THU-NGHIEM-HP-'||$1||'-'||floor(extract(epoch from clock_timestamp())*1000)::text,'Thử huỷ '||$1,'pk') returning id`, [tag])).id
    await c.query(`insert into kho.ton(vat_tu_id,kho_id,so_luong) values($1,$2,0)`, [id, kid]); return id }
  const gs   = async (loai, dong, ly) => (await one(`select kho.ghi_so_phieu($1,null,$2,null,$3::jsonb) r`, [loai, ly||null, JSON.stringify(dong)])).r
  const huy  = async (sp, ly) => await one(`select kho.huy_phieu($1,$2) r`, [sp, ly])
  const ton  = async (vid) => Number((await one(`select so_luong from kho.ton where vat_tu_id=$1 and kho_id=$2`, [vid, kid])).so_luong)
  const gv   = async (vid) => { const r = await one(`select gia_von_bq g from kho.ton where vat_tu_id=$1 and kho_id=$2`, [vid, kid]); return r.g==null?null:Number(r.g) }
  const phTT = async (sp) => (await one(`select trang_thai t from kho.phieu where so_phieu=$1`, [sp])).t
  const loRows = async (vid) => (await q(`select con_lai, lo_da_huy from kho.lo_nhap where vat_tu_id=$1`, [vid])).map(r=>({c:Number(r.con_lai), h:r.lo_da_huy}))
  const sumLive = async (vid) => Number((await one(`select coalesce(sum(con_lai),0) s from kho.lo_nhap where vat_tu_id=$1 and kho_id=$2 and lo_da_huy=false`, [vid, kid])).s)
  let spN = 0   // RAISE trong Postgres huỷ cả transaction -> bọc SAVEPOINT để chạy tiếp sau ca lỗi kỳ vọng
  const raises = async (fn) => {
    const sp = 'sp'+(++spN); await c.query('savepoint '+sp)
    try { await fn(); await c.query('release savepoint '+sp); return null }
    catch(e){ await c.query('rollback to savepoint '+sp); return e.message } }

  // ── a. nhập 10@1000 ──
  const va = await mkma('A')
  const spa = (await gs('nhap', [{vat_tu_id:va, so_luong:10, don_gia:1000}])).so_phieu
  chk('a', (await ton(va))===10 && (await gv(va))===1000, `tồn=${await ton(va)} gv=${await gv(va)}`)
  // ── b. huỷ phiếu nhập ──
  const rev = (await huy(spa, 'Nhập nhầm, huỷ')).r
  { const lo = await loRows(va); const okLo = lo.length===1 && lo[0].c===0 && lo[0].h===true
    const ng = await one(`select so_phieu, phieu_goc_id, (select id from kho.phieu where so_phieu=$1) goc from kho.phieu where so_phieu=$2`, [spa, rev])
    const okNg = /^HN-/.test(rev) && ng.phieu_goc_id===ng.goc
    chk('b', (await ton(va))===0 && (await gv(va))===null && okLo && (await phTT(spa))==='da_huy' && okNg,
        `tồn=${await ton(va)} gv=${await gv(va)} lô=${JSON.stringify(lo)} gốc=${await phTT(spa)} ngược=${rev}`) }
  // ── c. huỷ lần 2 -> raise ──
  { const m = await raises(()=>huy(spa,'huỷ lại')); chk('c', m!==null, m===null?'>>> HUỶ ĐƯỢC HAI LẦN':`raise: ${m.slice(0,60)}`) }

  // ── d. lô1 10@1000 + lô2 10@2000, gv1500; huỷ lô2 -> gv1000 tồn10 ──
  const vd = await mkma('D')
  await gs('nhap', [{vat_tu_id:vd, so_luong:10, don_gia:1000}])
  const spd2 = (await gs('nhap', [{vat_tu_id:vd, so_luong:10, don_gia:2000}])).so_phieu
  const gv1500 = (await gv(vd))===1500
  await huy(spd2, 'Huỷ lô 2')
  chk('d', gv1500 && (await gv(vd))===1000 && (await ton(vd))===10, `gv(trước)=1500?${gv1500} gv(sau)=${await gv(vd)} tồn=${await ton(vd)}`)

  // ── e. nhập 10, xuất 3, huỷ NHẬP -> raise nêu mã + số đã xuất ──
  const ve = await mkma('E')
  const spe_n = (await gs('nhap', [{vat_tu_id:ve, so_luong:10, don_gia:1000}])).so_phieu
  const spe_x = (await gs('xuat', [{vat_tu_id:ve, so_luong:3}], 'xuất thử')).so_phieu
  { const m = await raises(()=>huy(spe_n,'thử huỷ nhập đã xuất'))
    const ma = (await one(`select ma from kho.vat_tu where id=$1`, [ve])).ma
    const ok = m!==null && m.includes(ma) && m.includes('3')
    chk('e', ok, m===null?'>>> HUỶ ĐƯỢC PHIẾU ĐÃ XUẤT MỘT PHẦN':`raise: ${m.slice(0,90)}`) }
  // ── f. huỷ XUẤT trước -> con_lai trả đủ, tồn 10; rồi huỷ NHẬP -> giờ được ──
  await huy(spe_x, 'Huỷ phiếu xuất')
  const f1 = (await ton(ve))===10 && (await sumLive(ve))===10
  const mf = await raises(()=>huy(spe_n,'huỷ nhập sau khi đã huỷ xuất'))
  chk('f', f1 && mf===null && (await ton(ve))===0 && (await gv(ve))===null,
      `sau huỷ xuất tồn=${await ton(ve)}? · huỷ nhập ${mf===null?'OK':'RAISE:'+mf}`)

  // ── g. lý do rỗng -> raise ──
  const vg = await mkma('G'); const spg = (await gs('nhap', [{vat_tu_id:vg, so_luong:5, don_gia:100}])).so_phieu
  { const m = await raises(()=>huy(spg, '   ')); chk('g', m!==null, m===null?'>>> HUỶ ĐƯỢC VỚI LÝ DO RỖNG':`raise: ${m.slice(0,60)}`) }

  // ── h. vai trò không phải ceo/kho -> raise ──
  await setRole(nonkho || '00000000-0000-0000-0000-000000000000')
  { const m = await raises(()=>huy(spg, 'thợ thử huỷ'))
    chk('h', m!==null, m===null?'>>> VAI TRÒ KHÁC HUỶ ĐƯỢC':`vai=${nonkho?'tho':'NULL'} raise: ${m.slice(0,50)}`) }
  await setRole(ceo)

  // ── i. Σ con_lai lô sống = tồn (mọi mã thử) ──
  { const mas = await q(`select id from kho.vat_tu where ma like 'THU-NGHIEM-HP-%'`)
    let bad=null
    for (const {id} of mas){ const s=await sumLive(id), t=await ton(id); if (s!==t){ bad=`${id.slice(0,8)} Σsống=${s} tồn=${t}`; break } }
    chk('i', bad===null, bad||`${mas.length} mã: Σcon_lai(sống)=tồn`) }

  // ── j. không xoá dòng nào ──
  const after = await counts()
  { const ok = after.p>=before.p && after.pd>=before.pd && after.gd>=before.gd && after.l>=before.l
    chk('j', ok, ok?`phieu ${before.p}->${after.p} pd ${before.pd}->${after.pd} gd ${before.gd}->${after.gd} lo ${before.l}->${after.l}`:'>>> ĐÃ XOÁ DỮ LIỆU') }

  await c.query('rollback')
  const nvt = Number((await one(`select count(*)::int n from kho.vat_tu`)).n)
  const nph = Number((await one(`select count(*)::int n from kho.phieu`)).n)
  const gt  = String((await one(`select round(sum(so_luong*gia_von_bq)) g from kho.ton`)).g)
  chk('sạch', nvt===Number(base.vt) && nph===Number(base.ph) && gt===String(base.gt), `vat_tu=${nvt}/${base.vt} phiếu=${nph}/${base.ph} tồn=${gt}/${base.gt}`)
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
        print("stderr:", r.stderr.strip()[:500])
    fails = [ln for ln in r.stdout.splitlines() if " FAIL" in ln]
    if r.returncode == 0:
        print("\n✅ TẤT CẢ CHECK PASS (huỷ phiếu bằng phiếu ngược đúng)")
    else:
        print(f"\n❌ CÓ CHECK FAIL ({len(fails)}): " + ", ".join(x.split()[1] for x in fails))
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
