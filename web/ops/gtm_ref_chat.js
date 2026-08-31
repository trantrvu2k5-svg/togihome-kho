// WP-79 L-79f - Ma GTM gan ref vao nut chat sconcept.vn. Dan vao GTM GTM-MK3D4V68, Custom HTML tag,
//   trigger All Pages. File .txt ban dan (wp79_gtm_dan.txt) da boc san the SCRIPT o ngoai; file .js nay
//   de chay `node --check` (khong bundler soi) - noi dung ben trong y het phan trong the do.
//   Luu y: chu thich TRANH viet chuoi the script dang goc de HTML parser cua GTM khong dong som.
//
// Nguyen tac: ma chay tren WEB DANG BAN HANG - hong ma KHONG duoc hong nut. Moi thu trong try/catch;
//   loi thi de nut chay y nhu cu (khong preventDefault).
(function () {
  try {
    var WORKER = 'https://togihome-chat.togihome-keo-lead.workers.dev/chat';

    // kenh suy TU HREF (khong theo class - class do ben thue web dat, doi khong bao).
    function kenhTuHref(h) {
      if (!h) return null;
      // Zalo: CHI nhan dung so OA 0908386258. Moi href zalo.me khac (banner KM 0966773095) tra null, BO QUA
      //   hoan toan: khach di dung cho cu, khong log. Diem mu CO CHU Y - chuoi so nay TRUNG ZALO_URL cua
      //   Worker (dich zalo Worker gui toi); lech mot trong hai cho = ca 6 muc D bat duoc ngay.
      if (h.indexOf('zalo.me/0908386258') >= 0) return 'zalo';
      if (h.indexOf('m.me') >= 0 || h.indexOf('messenger.com') >= 0) return 'messenger';
      if (h.indexOf('ig.me') >= 0) return 'instagram';
      return null;                          // tel:, zalo.me khac, link san pham, moi thu khac -> KHONG dung
    }

    function idWebTuPath(path) {
      var m = (path || '').match(/\.(\d+)$/);   // so CUOI duong dan dang `.<so>`
      return m ? m[1] : '0';                     // khong co thi 0
    }

    function nonce6() {
      var s = '';
      var abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
      // 6 ky tu a-z0-9, moi cu click mot ma khac (khop CHINH XAC hoi thoai-click sau nay)
      for (var i = 0; i < 6; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
      return s;
    }

    // Bat o cap document, CAPTURE phase: SPA dung nut sau khi tai + doi trang khong tai lai ->
    //   gan thang vao nut se hut; doc location LUC CLICK moi dung trang khach dang dung.
    document.addEventListener('click', function (e) {
      try {
        var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (href.indexOf('tel:') === 0) return;      // nut goi: DB chua nhan kenh 'goi' -> de NGUYEN, khong dung
        var kenh = kenhTuHref(href);
        if (!kenh) return;                           // link khac (san pham...) -> KHONG preventDefault, di binh thuong

        var path = location.pathname || '/';
        var ref = 'w-' + idWebTuPath(path) + '-' + nonce6();   // 'w-' (KHONG 'web-'): parser RPC khong khop ->
        //   loai_ma/ma_ny NULL sach, ref_hop_le=false - DUNG y do toi khi co map loai + niem_yet.id_web.
        var dich = WORKER
          + '?kenh=' + encodeURIComponent(kenh)
          + '&ref=' + encodeURIComponent(ref)
          + '&dd=' + encodeURIComponent(path)
          + '&src=gtm';

        e.preventDefault();                          // chan href goc...
        location.href = dich;                        // ...roi di CUNG TAB (khong tab moi - dien thoai mo tab moi se lac)
      } catch (err) {
        // nuot: loi trong handler KHONG duoc chan nut - khong preventDefault thi href goc van chay
      }
    }, true);
  } catch (e) {
    // nuot toan cuc: ma hong thi trang + nut chay y nhu cu
  }
})();
