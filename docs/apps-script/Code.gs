/**
 * Paste-ready Google Apps Script for SOLON lead forms.
 *
 * This file is the server-side counterpart of assets/js/forms.js. The live
 * Apps Script project is NOT deployed from git — copy this into the Apps
 * Script editor (see README.md in this folder) and redeploy the web app.
 *
 * Script Properties (Project Settings → Script properties):
 *   TURNSTILE_SECRET = <Cloudflare Turnstile secret key>
 *   BREVO_API_KEY = <Brevo v3 API key> (SMTP & API → API keys)
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
var BREVO_CONTACT_LIST_ID = 11;
var BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts';

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

function normalizeRomanianPhoneE164_(raw) {
  if (raw == null) return null;
  var compact = String(raw).replace(/[\s.\-]/g, '');
  if (!compact) return null;
  var digits = compact;
  if (digits.charAt(0) === '+') {
    digits = digits.slice(1);
  } else if (digits.indexOf('0040') === 0) {
    digits = digits.slice(2);
  }
  if (digits.charAt(0) === '0' && digits.length === 10 && digits.charAt(1) === '7') {
    digits = '40' + digits.slice(1);
  }
  if (digits.length !== 11 || digits.indexOf('40') !== 0 || digits.charAt(2) !== '7') {
    return null;
  }
  var i;
  for (i = 0; i < digits.length; i++) {
    var ch = digits.charAt(i);
    if (ch < '0' || ch > '9') return null;
  }
  return '+' + digits;
}

function buildBrevoContactPayload_(data) {
  var email = data && data.Email != null ? String(data.Email).trim() : '';
  if (!email) return null;
  var payload = {
    email: email,
    attributes: {},
    listIds: [BREVO_CONTACT_LIST_ID],
    updateEnabled: true
  };
  var name = data.Nume != null ? String(data.Nume).trim() : '';
  if (name) payload.attributes.FIRSTNAME = name;
  return payload;
}

function buildBrevoPhonePayload_(data) {
  var phone = normalizeRomanianPhoneE164_(data && data.Telefon);
  if (!phone) return null;
  var payload = {
    attributes: { SMS: phone },
    listIds: [BREVO_CONTACT_LIST_ID],
    updateEnabled: true
  };
  var name = data.Nume != null ? String(data.Nume).trim() : '';
  if (name) payload.attributes.FIRSTNAME = name;
  return payload;
}

function syncToBrevoContactList_(sheetName, data) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
    if (!apiKey) {
      Logger.log('Brevo: skipped (BREVO_API_KEY missing)');
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Brevo: skipped (BREVO_API_KEY missing)');
      }
      return;
    }
    var payload = null;
    if (sheetName === 'Contact') {
      payload = buildBrevoContactPayload_(data);
    } else if (sheetName === 'Telefon') {
      payload = buildBrevoPhonePayload_(data);
    } else {
      return;
    }
    if (!payload) {
      Logger.log('Brevo: skipped (no payload for ' + sheetName + ')');
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Brevo: skipped (no payload for ' + sheetName + ')');
      }
      return;
    }
    var res = UrlFetchApp.fetch(BREVO_CONTACTS_URL, {
      method: 'post',
      headers: {
        'api-key': apiKey,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      var detail = res.getContentText();
      Logger.log('Brevo: HTTP ' + code + ' ' + detail);
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Brevo: HTTP ' + code + ' ' + detail);
      }
    }
  } catch (err) {
    Logger.log('Brevo: ' + err);
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Brevo: ' + err);
    }
  }
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
    syncToBrevoContactList_(sheet, data);
    return jsonOutput_({ ok: true });
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'server' });
  }
}
