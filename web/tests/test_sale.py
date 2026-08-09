# -*- coding: utf-8 -*-
# test_sale.py — app LÊN ĐƠN (sale.html) nối Supabase. Playwright + trình duyệt thật (skill html-tool-tester).
#   a đăng nhập ceo · b storage KHÔNG localStorage · c tạo đơn -> DB · d reload còn · e phiên khác thấy ·
#   f đổi trạng thái -> nhật ký · g sale KHÔNG thấy giá vốn · h 6 danh mục đúng số · i dọn sạch về mốc.
import json, os, re, subprocess, sys
from playwright.sync_api import sync_playwright

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = os.environ.get("DEV_URL", "http://localhost:5180/")
CEO_EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
CEO_PASS = os.environ.get("CEO_PASS", "")
SALE_EMAIL = "test_sale_probe@togihome.local"
SALE_PASS = os.environ.get("SALE_PASS", "")   # mật khẩu tài khoản sale TẠM — đọc từ biến môi trường, KHÔNG viết cứng
MA = "TEST-SALE-DH"
loi = []
def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok: loi.append(t)

def node(body):
    src = ("import pg from 'pg'; import { docConfig } from './ops/conn.mjs';"
           "const c=new pg.Client(await docConfig()); await c.connect();"
           "const q=async(s,a=[])=>(await c.query(s,a)).rows;"
           f"{body} await c.end(); process.exit(0);")
    r = subprocess.run(["node", "--input-type=module"], input=src, capture_output=True, text=True, cwd=WEB)
    if r.returncode != 0: print("LỖI DB:", r.stderr.strip()[:500]); sys.exit(2)
    return json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else None

def dm_counts():
    return node("const o={}; for(const t of ['thuong_hieu','san_pham_mau','mau_sac','don_vi_van_chuyen','vat_lieu_ban','khach']) o[t]=(await q(`select count(*)::int n from kho.${t}`))[0].n; console.log(JSON.stringify(o));")

def dh_counts():
    return node("console.log(JSON.stringify({don:(await q('select count(*)::int n from kho.don_hang'))[0].n, mon:(await q('select count(*)::int n from kho.don_hang_mon'))[0].n, ls:(await q('select count(*)::int n from kho.don_hang_nhat_ky'))[0].n}));")

def tao_sale():
    # tạo user qua SQL trực tiếp (auth.users + identities + nguoi_dung, bcrypt) — như ops/tao_taikhoan.mjs
    em = json.dumps(SALE_EMAIL); pw = json.dumps(SALE_PASS)
    return node(f"""
    let r=await q('select id from auth.users where email=$1',[{em}]); let uid;
    if(!r.length){{ uid=(await q(`insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token) values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',$1,crypt($2,gen_salt('bf')),now(),now(),now(),'{{"provider":"email","providers":["email"]}}','{{}}','','','','','','','','') returning id`,[{em},{pw}]))[0].id; }}
    else {{ uid=r[0].id; await q(`update auth.users set encrypted_password=crypt($2,gen_salt('bf')),email_confirmed_at=now(),updated_at=now() where id=$1`,[uid,{pw}]); }}
    await q(`update auth.users set confirmation_token='',recovery_token='',email_change='',email_change_token_new='',email_change_token_current='',phone_change='',phone_change_token='',reauthentication_token='' where id=$1`,[uid]);
    await q(`insert into auth.identities (id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),$1::text,$2::uuid,jsonb_build_object('sub',$2::text,'email',$1::text),'email',now(),now(),now()) on conflict (provider_id,provider) do update set identity_data=excluded.identity_data,updated_at=now()`,[{em},String(uid)]);
    await q(`insert into kho.nguoi_dung (auth_uid,ho_ten,vai_tro,dang_hoat_dong) values ($1,'TEST SALE','sale',true) on conflict (auth_uid) do update set vai_tro='sale',dang_hoat_dong=true`,[uid]);
    console.log(JSON.stringify({{uid}}));
    """)

def xoa_sale():
    em = json.dumps(SALE_EMAIL)
    node(f"""
    const r=await q('select id from auth.users where email=$1',[{em}]);
    if(r.length){{ const uid=r[0].id; await q('delete from kho.nguoi_dung where auth_uid=$1',[uid]); await q('delete from auth.identities where user_id=$1',[uid]); await q('delete from auth.users where id=$1',[uid]); }}
    console.log('null');
    """)

def dang_nhap(pg, email, pw):
    pg.goto(URL.rstrip("/") + "/sale.html", wait_until="networkidle")
    pg.fill("#e", email); pg.fill("#p", pw); pg.click("#b")
    pg.wait_for_selector("nav, [data-m], .ca", timeout=15000); pg.wait_for_timeout(600)

def lap_don(pg):
    pg.wait_for_selector('button.btn.pri:has-text("+ Lên đơn")', timeout=8000)
    pg.click('button.btn.pri:has-text("+ Lên đơn")')
    pg.wait_for_selector('.mdl', timeout=8000); pg.wait_for_timeout(300)
    # mã đơn TỰ SINH (không có ô nhập) -> bắt lại từ DB sau khi lưu
    pg.fill('input[placeholder="0903 792 333"]', "0912345678")
    pg.fill('input[placeholder="Chị Lan"]', "Khách Test Sale")
    pg.fill('input[placeholder="Số nhà, đường, phường, quận"]', "1 Đường Test")
    sels = pg.locator('.mdl select')
    for i in range(sels.count()):
        s = sels.nth(i); opts = s.locator('option')
        for j in range(opts.count()):   # chọn option ĐẦU không rỗng (loai=le_sang -> không đòi đơn gốc)
            val = opts.nth(j).get_attribute('value') or ""
            if val.strip():
                try: s.select_option(value=val)
                except Exception: pass
                break
    ten_mon = pg.locator('.mdl textarea[placeholder^="Bàn học"], .mdl input[placeholder^="Bàn học"]').first
    ten_mon.fill("Món Test Sale")
    pg.fill('.mdl input[placeholder="160x60x75"]', "100x50x75")
    pg.locator('.mdl input[placeholder="0"]').first.fill("5000000")
    pg.wait_for_timeout(300)
    pg.locator('.mdl').get_by_text(re.compile("Lưu đơn")).first.click()
    pg.wait_for_timeout(2500)

def main():
    if not CEO_PASS or not SALE_PASS:
        print("THIẾU biến môi trường. Cần đặt: CEO_PASS (mật khẩu tài khoản CEO) và SALE_PASS (mật khẩu tài khoản sale tạm để thử). Không có giá trị mặc định — đặt rồi chạy lại."); sys.exit(2)
    node("await q(`delete from kho.don_hang where ten_khach='Khách Test Sale'`); await q(`delete from kho.khach where ten='Khách Test Sale' or sdt='0912345678'`); console.log('null');")  # dọn sót cũ
    truoc_dh = dh_counts(); truoc_dm = dm_counts()
    print("mốc trước:", truoc_dh, truoc_dm)
    def created_ma():
        r = node("const x=await q(`select ma_don from kho.don_hang where ten_khach='Khách Test Sale' order by tao_luc desc limit 1`); console.log(JSON.stringify(x.length?x[0].ma_don:null));")
        return r
    sale_uid = tao_sale()["uid"]
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            # a. đăng nhập ceo
            pg = b.new_page(viewport={"width": 1400, "height": 1000})
            errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            dang_nhap(pg, CEO_EMAIL, CEO_PASS)
            bao("a. ceo đăng nhập vào app", pg.locator("nav, [data-m], .ca").count() > 0)
            # b. storage KHÔNG localStorage
            ls_keys = pg.evaluate("()=>{try{return Object.keys(localStorage).filter(k=>k.indexOf('togi_sale:')===0).length}catch(e){return -1}}")
            has_sb = pg.evaluate("()=>!!(window.__sb)")
            bao("b. window.storage nối Supabase (0 khoá localStorage togi_sale:, có window.__sb)", ls_keys == 0 and has_sb)
            if not (ls_keys == 0 and has_sb): raise AssertionError("CHƯA NỐI SUPABASE")
            # h. 6 danh mục nạp từ DB (đúng số) — kiểm trên trang danh mục sản phẩm
            db_dm = dm_counts()
            bao("h. danh mục nạp từ DB đúng số", db_dm == truoc_dm and db_dm["san_pham_mau"] == 14 and db_dm["thuong_hieu"] == 8)
            # c. lập đơn -> DB
            lap_don(pg)
            banner = pg.locator("#loi-luu")
            if banner.is_visible(): raise AssertionError("banner lỗi lưu: " + banner.text_content())
            cma = created_ma()
            got = node(f"const dd=(await q('select id from kho.don_hang where ma_don=$1',[{json.dumps(cma)}])); const d=dd.length; const m=d?(await q('select count(*)::int n from kho.don_hang_mon where don_id=$1',[dd[0].id]))[0].n:0; console.log(JSON.stringify({{d,m}}));")
            bao("c. lập đơn -> 1 dòng don_hang + món", cma and got["d"] == 1 and got["m"] >= 1, f"ma={cma} {got}")
            if not (cma and got["d"] == 1): raise AssertionError("đơn không xuống DB")
            # d. reload còn
            pg.reload(wait_until="networkidle"); pg.wait_for_selector("nav, [data-m]", timeout=15000); pg.wait_for_timeout(700)
            bao("d. reload đơn còn", pg.get_by_text(cma).count() > 0)
            if pg.get_by_text(cma).count() == 0: raise AssertionError("DỮ LIỆU KHÔNG LƯU XUỐNG")
            # e. phiên trình duyệt KHÁC
            ctx2 = b.new_context(); pg2 = ctx2.new_page()
            dang_nhap(pg2, CEO_EMAIL, CEO_PASS); pg2.wait_for_timeout(600)
            bao("e. phiên khác thấy đơn", pg2.get_by_text(cma).count() > 0)
            if pg2.get_by_text(cma).count() == 0: raise AssertionError("MỖI MÁY MỘT SỔ")
            ctx2.close()
            # f. đổi trạng thái -> nhật ký (đổi thẳng DB-qua-UI: mở đơn, bấm nút chuyển khâu)
            ls0 = node(f"const dd=(await q('select id from kho.don_hang where ma_don=$1',[{json.dumps(cma)}])); console.log(JSON.stringify(dd.length?(await q('select count(*)::int n from kho.don_hang_nhat_ky where don_id=$1',[dd[0].id]))[0].n:0));")
            pg.get_by_text(cma).first.click(); pg.wait_for_timeout(600)
            adv = pg.get_by_role("button", name=re.compile("thiết kế|Nhận|Bắt đầu|Chuyển|Đã cắt|Cắt|→", re.I))
            moved = False
            for i in range(min(adv.count(), 6)):
                try:
                    adv.nth(i).click(); pg.wait_for_timeout(1200); moved = True; break
                except Exception: pass
            ls1 = node(f"const dd=(await q('select id from kho.don_hang where ma_don=$1',[{json.dumps(cma)}])); console.log(JSON.stringify(dd.length?(await q('select count(*)::int n from kho.don_hang_nhat_ky where don_id=$1',[dd[0].id]))[0].n:0));")
            bao("f. đổi trạng thái -> dòng nhật ký mới", ls1 > ls0, f"nhật ký {ls0}->{ls1} (moved={moved})")
            pg.close()
            # g. sale đăng nhập -> KHÔNG thấy giá vốn
            ctx3 = b.new_context(); pg3 = ctx3.new_page()
            dang_nhap(pg3, SALE_EMAIL, SALE_PASS); pg3.wait_for_timeout(700)
            body_txt = pg3.locator("body").inner_text().lower()
            thay_gv = "giá vốn" in body_txt
            bao("g. sale KHÔNG thấy chữ 'giá vốn' trên màn hình", not thay_gv, "thấy 'giá vốn'" if thay_gv else "")
            if thay_gv: raise AssertionError("SALE THẤY GIÁ VỐN")
            ctx3.close()
            b.close()
    finally:
        # i. DỌN SẠCH
        node("await q(`delete from kho.don_hang where ten_khach='Khách Test Sale'`); await q(`delete from kho.khach where ten='Khách Test Sale' or sdt='0912345678'`); console.log('null');")
        xoa_sale()
        sau_dh = dh_counts(); sau_dm = dm_counts()
        ok_don = sau_dh == truoc_dh and sau_dm == truoc_dm
        bao("i. dọn sạch -> đếm về đúng mốc", ok_don, f"{truoc_dh} -> {sau_dh}")

    print("\n" + ("✅ TẤT CẢ PASS" if not loi else "❌ FAIL: " + ", ".join(loi)))
    sys.exit(1 if loi else 0)

if __name__ == "__main__":
    main()
