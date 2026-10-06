/**
 * Paste-ready Google Apps Script for SOLON lead forms.
 *
 * This file is the server-side counterpart of assets/js/forms.js. The live
 * Apps Script project is NOT deployed from git — copy this into the Apps
 * Script editor (see README.md in this folder) and redeploy the web app.
 *
 * Script Properties (Project Settings → Script properties):
 *   TURNSTILE_SECRET = <Cloudflare Turnstile secret key>
 *
 * Enforce Turnstile only when BOTH this secret and a client token are present.
 * The live forms.js sends a token only after TURNSTILE_SITE_KEY is replaced.
 * Either side missing → skip CAPTCHA (honeypot + timing + rate limit still
 * apply). Do not fail-open after both exist: siteverify must return success.
 * Keep error codes captcha / too_fast / rate_limited (PR #40 maps them).
 *
 * Bind this script to the Google Sheet that holds Contact / Telefon /
 * Newsletter tabs (or set SPREADSHEET_ID below).
 */

var MIN_SUBMIT_MS = 3000;
var CLOCK_SKEW_MS = 2000;
var RATE_LIMIT_MAX = 5;
var RATE_LIMIT_SECONDS = 600;
var HONEYPOT_FIELDS = ['company_url', 'website'];
var SKIP_SHEET_FIELDS = {
  company_url: true,
  website: true,
  turnstileToken: true,
  formLoadedAt: true,
  'cf-turnstile-response': true
};
var ALLOWED_SHEETS = {
  Contact: ['Data', 'Email', 'Nume', 'Mesaj', 'IP'],
  Telefon: ['Data', 'Telefon', 'IP'],
  Newsletter: ['Data', 'Email', 'IP']
};

// Optional: leave empty when the script is bound to the spreadsheet.
var SPREADSHEET_ID = '';

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody_(e) {
  var raw = e && e.postData && e.postData.contents;
  if (!raw) return {};
  return JSON.parse(raw);
}

function honeypotFilled_(data) {
  if (!data) return false;
  for (var i = 0; i < HONEYPOT_FIELDS.length; i++) {
    var value = data[HONEYPOT_FIELDS[i]];
    if (value && String(value).trim()) return true;
  }
  return false;
}

function timingRejected_(data) {
  var loadedAt = Number(data && data.formLoadedAt);
  if (!loadedAt || !isFinite(loadedAt)) return true;
  var elapsed = Date.now() - loadedAt;
  if (elapsed > 24 * 60 * 60 * 1000) return true;
  return elapsed < MIN_SUBMIT_MS - CLOCK_SKEW_MS;
}

function filled_(value) {
  return Boolean(value && String(value).trim());
}

function turnstileShouldVerify_(secret, token) {
  // Keep in sync with tests/turnstile-gate.js serverTurnstileDecision.
  // Secret without token: site key still placeholder — do not captcha-block.
  // Token without secret: site key already live — do not reject the token.
  return filled_(secret) && filled_(token);
}

function verifyTurnstile_(token, remoteIp) {
  var secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!turnstileShouldVerify_(secret, token)) return true;
  try {
    var payload = {
      secret: secret,
      response: token
    };
    if (remoteIp) payload.remoteip = remoteIp;
    var res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    });
    var body = JSON.parse(res.getContentText() || '{}');
    return body.success === true;
  } catch (err) {
    return false;
  }
}

function enforceRateLimit_(ip, sheet, data) {
  var cache = CacheService.getScriptCache();
  var identity = data && String(data.Email || data.Telefon || '').trim().toLowerCase();
  var keys = ['rl:' + sheet + ':' + (ip || 'unknown')];
  if (identity) keys.push('rl:' + sheet + ':id:' + identity);
  var i;
  for (i = 0; i < keys.length; i++) {
    if (Number(cache.get(keys[i]) || '0') >= RATE_LIMIT_MAX) return false;
  }
  for (i = 0; i < keys.length; i++) {
    var count = Number(cache.get(keys[i]) || '0');
    cache.put(keys[i], String(count + 1), RATE_LIMIT_SECONDS);
  }
  return true;
}

function getSheet_(sheetName) {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('spreadsheet');
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('unknown_sheet');
  return sheet;
}

function appendLead_(sheetName, data) {
  var columns = ALLOWED_SHEETS[sheetName];
  if (!columns) throw new Error('unknown_sheet');
  var sheet = getSheet_(sheetName);
  var headers = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : columns;
  if (!headers || !headers.length) headers = columns;
  var row = headers.map(function (header) {
    var key = String(header || '').trim();
    if (!key || SKIP_SHEET_FIELDS[key]) return '';
    if (data[key] == null) return '';
    return data[key];
  });
  sheet.appendRow(row);
}

function doPost(e) {
  try {
    var parsed = parseBody_(e);
    var data = parsed.data || {};
    var sheet = (e && e.parameter && e.parameter.sheet) || 'Contact';
    if (!ALLOWED_SHEETS[sheet]) {
      return jsonOutput_({ ok: false, error: 'unknown_sheet' });
    }

    // Honeypot: pretend success so bots do not iterate.
    if (honeypotFilled_(data)) {
      return jsonOutput_({ ok: true });
    }

    if (timingRejected_(data)) {
      return jsonOutput_({ ok: false, error: 'too_fast' });
    }

    var token = data.turnstileToken || data['cf-turnstile-response'] || '';
    if (!verifyTurnstile_(token, data.IP)) {
      return jsonOutput_({ ok: false, error: 'captcha' });
    }

    if (!enforceRateLimit_(data.IP, sheet, data)) {
      return jsonOutput_({ ok: false, error: 'rate_limited' });
    }

    if (parsed.action && parsed.action !== 'append') {
      return jsonOutput_({ ok: false, error: 'bad_action' });
    }

    appendLead_(sheet, data);
    return jsonOutput_({ ok: true });
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'server' });
  }
}
