/*!
 * SOLON hand-written test fixture — not Google gtag.js, no Google copyrighted code.
 * Loaded by Puppeteer interception instead of googletagmanager.com/gtag/js.
 * Defines gtag/dataLayer and emits synthetic /g/collect transports for consent tests.
 */
(function gtagTestStub(global) {
  "use strict";

  const script = global.document && global.document.currentScript;
  let measurementId = "G-TEST000000";
  if (script && script.src) {
    try {
      const idParam = new URL(script.src, global.location.href).searchParams.get("id");
      if (idParam && /^G-[A-Z0-9]+$/u.test(idParam)) {
        measurementId = idParam;
      }
    } catch {
      // keep default test id
    }
  }

  global.dataLayer = global.dataLayer || [];

  /**
   * @returns {void}
   */
  const setGaCookie = () => {
    if (!global.document) {
      return;
    }
    const suffix = `${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`;
    global.document.cookie = `_ga=GA1.1.${suffix}; path=/`;
  };

  /**
   * @param {string} pathQuery
   * @returns {string}
   */
  const collectUrl = (pathQuery) => `https://www.google-analytics.com/g/collect?${pathQuery}`;

  const baseQuery = `v=2&tid=${encodeURIComponent(measurementId)}&_et=1`;

  /**
   * @returns {void}
   */
  const fireCollectTransports = () => {
    const url = collectUrl(baseQuery);
    if (global.navigator && typeof global.navigator.sendBeacon === "function") {
      global.navigator.sendBeacon(url);
    }
    if (typeof global.fetch === "function") {
      global.fetch(url, { mode: "no-cors", keepalive: true }).catch(() => undefined);
    }
    try {
      const xhr = new global.XMLHttpRequest();
      xhr.open("GET", url);
      xhr.send();
    } catch {
      // consent may wrap XHR
    }
    try {
      const img = new global.Image();
      img.src = url;
    } catch {
      // ignore
    }
    const gtmCollect = `https://www.googletagmanager.com/g/collect?${baseQuery}`;
    if (global.navigator && typeof global.navigator.sendBeacon === "function") {
      global.navigator.sendBeacon(gtmCollect);
    }
  };

  /**
   * @returns {void}
   */
  const gtagWithCollect = function gtagWithCollect() {
    // skipcq: JS-0244 -- mirror gtag dataLayer Arguments objects for consent tests
    global.dataLayer.push(arguments);
    const command = arguments[0];
    if (command === "config" || command === "event") {
      setGaCookie();
      if (typeof global.queueMicrotask === "function") {
        global.queueMicrotask(fireCollectTransports);
      } else {
        global.setTimeout(fireCollectTransports, 0);
      }
    }
  };
  global.gtag = gtagWithCollect;
  if (global.document && typeof global.document.addEventListener === "function") {
    global.document.addEventListener("visibilitychange", () => {
      if (typeof global.queueMicrotask === "function") {
        global.queueMicrotask(fireCollectTransports);
      } else {
        global.setTimeout(fireCollectTransports, 0);
      }
    });
  }
  gtagWithCollect("js", new Date());
  gtagWithCollect("config", measurementId, { send_page_view: true });
})(typeof globalThis !== "undefined" ? globalThis : window);
