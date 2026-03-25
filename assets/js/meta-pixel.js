(function () {
  "use strict";

  var PIXEL_ID = "400022442507673";
  var FBE_SRC = "https://connect.facebook.net/en_US/fbevents.js";

  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) {
      return;
    }
    n = f.fbq = function () {
      n.callMethod
        ? n.callMethod.apply(n, arguments)
        : n.queue.push(arguments);
    };
    if (!f._fbq) {
      f._fbq = n;
    }
    n.push = n;
    n.loaded = !0;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    t.onerror = function () {};
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", FBE_SRC);

  if (typeof fbq === "function") {
    fbq("init", PIXEL_ID);
    fbq("track", "PageView");
  }
})();
