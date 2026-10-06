(function (root) {
  "use strict";

  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, critical: 50 };
  const DEFAULT_ENDPOINT = "";
  const DEFAULT_SENTRY_DSN = "";
  const MAX_EVENTS = 20;
  const MAX_MESSAGE = 500;
  const REPORT_TIMEOUT_MS = 4000;
  const RETRY_DELAYS_MS = [0, 400, 1200];

  function sanitize(value) {
    if (value == null) return "";
    return String(value)
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
      .replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/gi, "[redacted-ip]")
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]")
      .slice(0, MAX_MESSAGE);
  }

  function sanitizeContext(context) {
    const safe = {};
    if (!context || typeof context !== "object") return safe;
    Object.keys(context).forEach((key) => {
      if (/^(email|telefon|phone|mesaj|message|ip|nume|value|payload|body)$/i.test(key)) {
        return;
      }
      const value = context[key];
      if (value == null) return;
      if (typeof value === "number" || typeof value === "boolean") {
        safe[key] = value;
        return;
      }
      safe[key] = sanitize(value);
    });
    return safe;
  }

  function parseSentryDsn(dsn) {
    if (!dsn || typeof dsn !== "string") return null;
    try {
      const url = new URL(dsn.trim());
      const key = url.username;
      const projectId = url.pathname.replace(/^\//, "").replace(/\/$/, "");
      if (!key || !projectId) return null;
      return {
        storeUrl: url.protocol + "//" + url.host + "/api/" + projectId + "/store/",
        key: key,
      };
    } catch (_) {
      return null;
    }
  }

  function wait(ms, sleep) {
    return sleep(ms);
  }

  function createLogger(options) {
    const settings = options || {};
    const fetchImpl = settings.fetch || (typeof fetch === "function" ? fetch : null);
    const sleep =
      settings.sleep ||
      function (ms) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      };
    const now =
      settings.now ||
      function () {
        return new Date().toISOString();
      };
    let sentCount = 0;
    const pending = [];
    const consoleImpl = settings.console || (typeof console !== "undefined" ? console : null);

    function endpoint() {
      if (typeof settings.endpoint === "string") return settings.endpoint.trim();
      if (root && typeof root.SOLON_ERROR_ENDPOINT === "string") {
        return root.SOLON_ERROR_ENDPOINT.trim();
      }
      return DEFAULT_ENDPOINT;
    }

    function sentryDsn() {
      if (typeof settings.sentryDsn === "string") return settings.sentryDsn.trim();
      if (root && typeof root.SOLON_SENTRY_DSN === "string") {
        return root.SOLON_SENTRY_DSN.trim();
      }
      return DEFAULT_SENTRY_DSN;
    }

    function toPayload(level, event) {
      const source = event && typeof event === "object" ? event : { message: event };
      return {
        ts: now(),
        level: level,
        type: sanitize(source.type) || "client",
        message: sanitize(source.message || source.msg || ""),
        context: sanitizeContext(source.context || source),
        href: root && root.location && typeof root.location.href === "string"
          ? sanitize(root.location.href.split("?")[0])
          : "",
      };
    }

    function writeConsole(level, payload) {
      if (!consoleImpl) return;
      const method =
        level === "error" || level === "critical"
          ? "error"
          : level === "warn"
            ? "warn"
            : "info";
      if (typeof consoleImpl[method] === "function") {
        consoleImpl[method]("[solon " + level + "]", payload);
      }
    }

    async function postOnce(url, init) {
      if (!fetchImpl) return false;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller
        ? setTimeout(function () {
            controller.abort();
          }, REPORT_TIMEOUT_MS)
        : null;
      try {
        const response = await fetchImpl(
          url,
          Object.assign({ credentials: "omit" }, init, {
            signal: controller ? controller.signal : undefined,
          })
        );
        return Boolean(response && response.ok);
      } catch (_) {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function deliver(payload) {
      if (sentCount >= MAX_EVENTS) return;

      const webhook = endpoint();
      const sentry = parseSentryDsn(sentryDsn());
      const sendWebhook = Boolean(webhook) && LEVELS[payload.level] >= LEVELS.info;
      const sendSentry = Boolean(sentry) && LEVELS[payload.level] >= LEVELS.warn;
      if (!sendWebhook && !sendSentry) return;

      sentCount += 1;

      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        if (RETRY_DELAYS_MS[attempt]) await wait(RETRY_DELAYS_MS[attempt], sleep);
        let ok = true;
        if (sendWebhook) {
          ok =
            (await postOnce(webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })) && ok;
        }
        if (sendSentry) {
          ok =
            (await postOnce(sentry.storeUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Sentry-Auth":
                  "Sentry sentry_version=7, sentry_client=solon-landing/1.0, sentry_key=" +
                  sentry.key,
              },
              body: JSON.stringify({
                message: payload.message || payload.type,
                level: payload.level === "critical" ? "fatal" : payload.level,
                platform: "javascript",
                timestamp: payload.ts,
                tags: { source: "solon-landing", type: payload.type },
                extra: payload.context,
              }),
            })) && ok;
        }
        if (ok) return;
      }
    }

    function record(level, event) {
      try {
        const payload = toPayload(level, event);
        writeConsole(level, payload);
        const job = deliver(payload);
        pending.push(job);
        if (job && typeof job.catch === "function") {
          job.catch(function () {});
        }
        return payload;
      } catch (_) {
        return null;
      }
    }

    function install(target) {
      const host = target || root;
      if (!host || typeof host.addEventListener !== "function") return;

      host.addEventListener("error", function (event) {
        record("error", {
          type: "window_error",
          message: event && (event.message || (event.error && event.error.message)),
          context: {
            source: event && event.filename,
            line: event && event.lineno,
            column: event && event.colno,
          },
        });
      });

      host.addEventListener("unhandledrejection", function (event) {
        const reason = event && event.reason;
        record("error", {
          type: "unhandled_rejection",
          message: reason && (reason.message || reason),
          context: { name: reason && reason.name },
        });
      });
    }

    return {
      debug: function (event) {
        return record("debug", event);
      },
      info: function (event) {
        return record("info", event);
      },
      warn: function (event) {
        return record("warn", event);
      },
      error: function (event) {
        return record("error", event);
      },
      critical: function (event) {
        return record("critical", event);
      },
      sanitize: sanitize,
      parseSentryDsn: parseSentryDsn,
      install: install,
      flush: function () {
        return Promise.all(pending);
      },
    };
  }

  const defaultLogger = createLogger();
  root.SolonLog = defaultLogger;
  defaultLogger.install(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      createLogger: createLogger,
      sanitize: sanitize,
      parseSentryDsn: parseSentryDsn,
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
