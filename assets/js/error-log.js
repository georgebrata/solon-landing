"use strict";

/**
 * Lightweight SOLON client logger. Console always; webhook/Sentry are optional.
 */
(function (root) {
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, critical: 50 };
  const DEFAULT_ENDPOINT = "";
  const DEFAULT_SENTRY_DSN = "";
  const MAX_EVENTS = 20;
  const MAX_MESSAGE = 500;
  const REPORT_TIMEOUT_MS = 4000;
  const RETRY_DELAYS_MS = [0, 400, 1200];

  /** Redact emails, IPs, and phone numbers from a log string. */
  const sanitize = (value) => {
    if (value == null) return "";
    return String(value)
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
      .replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/gi, "[redacted-ip]")
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]")
      .slice(0, MAX_MESSAGE);
  };

  /** Copy context keys while dropping PII field names. */
  const sanitizeContext = (context) => {
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
  };

  /** Parse a Sentry DSN into a Store API URL and public key. */
  const parseSentryDsn = (dsn) => {
    if (!dsn || typeof dsn !== "string") return null;
    try {
      const url = new URL(dsn.trim());
      const key = url.username;
      const projectId = url.pathname.replace(/^\//, "").replace(/\/$/, "");
      if (!key || !projectId) return null;
      return {
        storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/`,
        key,
      };
    } catch {
      return null;
    }
  };

  /** Delay using the injected sleep function. */
  const wait = (ms, sleep) => sleep(ms);

  /** Default sleep used when the logger is not under test. */
  const defaultSleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

  /** ISO timestamp for structured log events. */
  const defaultNow = () => new Date().toISOString();

  /**
   * Create a logger with optional fetch, endpoint, DSN, and console overrides.
   * @param {object} [options]
   * @returns {object}
   */
  const createLogger = (options) => {
    const settings = options || {};
    const fetchImpl = settings.fetch || (typeof fetch === "function" ? fetch : null);
    const sleep = settings.sleep || defaultSleep;
    const now = settings.now || defaultNow;
    let sentCount = 0;
    const pending = [];
    const consoleImpl = settings.console || (typeof console !== "undefined" ? console : null);

    /** Resolve the optional JSON webhook URL. */
    const endpoint = () => {
      if (typeof settings.endpoint === "string") return settings.endpoint.trim();
      if (typeof root?.SOLON_ERROR_ENDPOINT === "string") {
        return root.SOLON_ERROR_ENDPOINT.trim();
      }
      return DEFAULT_ENDPOINT;
    };

    /** Resolve the optional Sentry DSN. */
    const sentryDsn = () => {
      if (typeof settings.sentryDsn === "string") return settings.sentryDsn.trim();
      if (typeof root?.SOLON_SENTRY_DSN === "string") {
        return root.SOLON_SENTRY_DSN.trim();
      }
      return DEFAULT_SENTRY_DSN;
    };

    /** Build a sanitized log payload. */
    const toPayload = (level, event) => {
      const source = event && typeof event === "object" ? event : { message: event };
      const href = typeof root?.location?.href === "string"
        ? sanitize(root.location.href.split("?")[0])
        : "";
      return {
        ts: now(),
        level,
        type: sanitize(source.type) || "client",
        message: sanitize(source.message || source.msg || ""),
        context: sanitizeContext(source.context || source),
        href,
      };
    };

    /** Write one structured line to the console. */
    const writeConsole = (level, payload) => {
      if (!consoleImpl) return;
      const method =
        level === "error" || level === "critical"
          ? "error"
          : level === "warn"
            ? "warn"
            : "info";
      if (typeof consoleImpl[method] === "function") {
        consoleImpl[method](`[solon ${level}]`, payload);
      }
    };

    /** POST once with a timeout; never throw. */
    const postOnce = async (url, init) => {
      if (!fetchImpl) return false;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => {
            controller.abort();
          }, REPORT_TIMEOUT_MS)
        : null;
      try {
        const response = await fetchImpl(
          url,
          Object.assign({ credentials: "omit" }, init, {
            signal: controller?.signal,
          })
        );
        return Boolean(response?.ok);
      } catch {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    /** Deliver an event to the webhook and/or Sentry with backoff. */
    const deliver = async (payload) => {
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
                "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=solon-landing/1.0, sentry_key=${sentry.key}`,
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
    };

    /** Ignore a rejected reporting promise. */
    const swallow = () => undefined;

    /** Record a console event and optionally report it. */
    const record = (level, event) => {
      try {
        const payload = toPayload(level, event);
        writeConsole(level, payload);
        const job = deliver(payload);
        pending.push(job);
        if (typeof job?.catch === "function") {
          job.catch(swallow);
        }
        return payload;
      } catch {
        return null;
      }
    };

    /** Attach window error and unhandledrejection listeners. */
    const install = (target) => {
      const host = target || root;
      if (typeof host?.addEventListener !== "function") return;

      host.addEventListener("error", (event) => {
        record("error", {
          type: "window_error",
          message: event?.message || event?.error?.message,
          context: {
            source: event?.filename,
            line: event?.lineno,
            column: event?.colno,
          },
        });
      });

      host.addEventListener("unhandledrejection", (event) => {
        const reason = event?.reason;
        record("error", {
          type: "unhandled_rejection",
          message: reason?.message || reason,
          context: { name: reason?.name },
        });
      });
    };

    return {
      debug: (event) => record("debug", event),
      info: (event) => record("info", event),
      warn: (event) => record("warn", event),
      error: (event) => record("error", event),
      critical: (event) => record("critical", event),
      sanitize,
      parseSentryDsn,
      install,
      flush: () => Promise.all(pending),
    };
  };

  const defaultLogger = createLogger();
  root.SolonLog = defaultLogger;
  defaultLogger.install(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      createLogger,
      sanitize,
      parseSentryDsn,
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
