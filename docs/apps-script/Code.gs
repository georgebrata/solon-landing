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
var BREVO_QUEUE_SHEET = 'BrevoQueue';
var BREVO_QUEUE_MAX_ATTEMPTS = 3;
var BREVO_QUEUE_HEADERS = ['QueuedAt', 'Payload', 'Attempts', 'Status', 'LastError'];
var BREVO_EMAIL_RE = /^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i;
var BREVO_LOG_DETAIL_MAX = 80;
var BREVO_RETENTION_MONTHS = 24;
var BREVO_LEAD_NAME_ATTR = 'NUME';
var BREVO_INQUIRY_DATE_ATTR = 'LAST_INQUIRY';
var BREVO_CHANNEL_ATTR = 'CHANNEL';
var BREVO_SMS_ONLY_SKIP_CODE = 'sms_only_skipped';

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

function getSpreadsheet_() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('spreadsheet');
  return ss;
}

function getSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
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

function isValidEmailForBrevo_(email) {
  if (!email) return false;
  var trimmed = String(email).trim();
  if (!trimmed || trimmed.length > 254) return false;
  return BREVO_EMAIL_RE.test(trimmed);
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
  if (digits.charAt(0) === '0' && digits.length === 10) {
    digits = '40' + digits.slice(1);
  }
  if (digits.length !== 11 || digits.indexOf('40') !== 0 || digits.charAt(2) === '0') {
    return null;
  }
  var i;
  for (i = 0; i < digits.length; i++) {
    var ch = digits.charAt(i);
    if (ch < '0' || ch > '9') return null;
  }
  return '+' + digits;
}

function truncateBrevoErrorDetail_(responseCode, responseText) {
  var code = 'http_error';
  try {
    var parsed = JSON.parse(responseText || '{}');
    if (parsed && parsed.code) code = String(parsed.code);
  } catch (ignore) {
    code = 'http_error';
  }
  code = code.replace(/\s+/g, ' ').trim();
  if (code.length > BREVO_LOG_DETAIL_MAX) {
    code = code.slice(0, BREVO_LOG_DETAIL_MAX);
  }
  return 'HTTP ' + responseCode + ' ' + code;
}

function inquiryDateIso_(data) {
  var raw = data && data.Data != null ? String(data.Data).trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return Utilities.formatDate(new Date(), 'Europe/Bucharest', 'yyyy-MM-dd');
}

function buildLeadBrevoAttributes_(data, channel) {
  var attrs = {};
  attrs[BREVO_INQUIRY_DATE_ATTR] = inquiryDateIso_(data);
  attrs[BREVO_CHANNEL_ATTR] = channel;
  var name = data && data.Nume != null ? String(data.Nume).trim() : '';
  if (name) attrs[BREVO_LEAD_NAME_ATTR] = name;
  return attrs;
}

function serializeBrevoApiPayload_(payload) {
  var clone = JSON.parse(JSON.stringify(payload));
  delete clone._smsOnly;
  return clone;
}

function isBrevoEmailRequiredError_(responseCode, responseText) {
  if (responseCode === 400 || responseCode === 422) {
    try {
      var parsed = JSON.parse(responseText || '{}');
      var code = parsed && parsed.code ? String(parsed.code) : '';
      if (code === 'missing_parameter' || code === 'invalid_parameter') return true;
    } catch (ignore) {
      return false;
    }
  }
  return false;
}

function cutoffInquiryDateIso_() {
  var cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - BREVO_RETENTION_MONTHS);
  return Utilities.formatDate(cutoff, 'Europe/Bucharest', 'yyyy-MM-dd');
}

function parseSheetDateIso_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Europe/Bucharest', 'yyyy-MM-dd');
  }
  var raw = value != null ? String(value).trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return '';
}

function pruneLeadSheetRows_(sheetName, cutoffIso) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var removed = 0;
  var rowIndex;
  for (rowIndex = lastRow; rowIndex >= 2; rowIndex--) {
    var dateCell = sheet.getRange(rowIndex, 1).getValue();
    var rowDate = parseSheetDateIso_(dateCell);
    if (rowDate && rowDate < cutoffIso) {
      sheet.deleteRow(rowIndex);
      removed += 1;
    }
  }
  return removed;
}

function getBrevoNewsletterListId_() {
  var raw = PropertiesService.getScriptProperties().getProperty('BREVO_NEWSLETTER_LIST_ID');
  if (!raw) return null;
  var id = Number(raw);
  return isFinite(id) && id > 0 ? id : null;
}

function fetchBrevoListContacts_(apiKey, listId, offset, limit) {
  var url = BREVO_CONTACTS_URL + '/lists/' + listId + '/contacts?limit=' + limit + '&offset=' + offset;
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'api-key': apiKey,
      accept: 'application/json'
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    brevoWarn_(truncateBrevoErrorDetail_(code, res.getContentText()));
    return null;
  }
  return JSON.parse(res.getContentText() || '{}');
}

function deleteBrevoContact_(apiKey, contactId) {
  var id = Number(contactId);
  if (!id) return false;
  var res = UrlFetchApp.fetch(BREVO_CONTACTS_URL + '/' + id + '?identifierType=contact_id', {
    method: 'delete',
    headers: {
      'api-key': apiKey,
      accept: 'application/json'
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return true;
  brevoWarn_(truncateBrevoErrorDetail_(code, res.getContentText()));
  return false;
}

function normalizeContactListIds_(contact) {
  var ids = contact && contact.listIds ? contact.listIds : [];
  var out = [];
  var i;
  for (i = 0; i < ids.length; i++) out.push(Number(ids[i]));
  return out;
}

function contactIsOnNewsletterList_(listIds, newsletterListId) {
  var i;
  for (i = 0; i < listIds.length; i++) {
    if (listIds[i] === newsletterListId) return true;
  }
  return false;
}

function contactIsOnlyOnLeadList_(listIds) {
  return listIds.length === 1 && listIds[0] === BREVO_CONTACT_LIST_ID;
}

function contactHasNonLeadList_(listIds) {
  var i;
  for (i = 0; i < listIds.length; i++) {
    if (listIds[i] !== BREVO_CONTACT_LIST_ID) return true;
  }
  return false;
}

function removeBrevoContactFromList_(apiKey, listId, contact) {
  var id = contact && contact.id != null ? Number(contact.id) : NaN;
  if (!id) return false;
  var body = { ids: [id] };
  var res = UrlFetchApp.fetch(BREVO_CONTACTS_URL + '/lists/' + listId + '/contacts/remove', {
    method: 'post',
    headers: {
      'api-key': apiKey,
      accept: 'application/json',
      'content-type': 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return true;
  brevoWarn_(truncateBrevoErrorDetail_(code, res.getContentText()));
  return false;
}

function collectStaleLeadListContacts_(apiKey, cutoffIso) {
  var stale = [];
  var offset = 0;
  var limit = 50;
  while (true) {
    var page = fetchBrevoListContacts_(apiKey, BREVO_CONTACT_LIST_ID, offset, limit);
    if (!page || !page.contacts || !page.contacts.length) break;
    var i;
    for (i = 0; i < page.contacts.length; i++) {
      var contact = page.contacts[i];
      var attrs = contact.attributes || {};
      var lastInquiry = attrs[BREVO_INQUIRY_DATE_ATTR] || attrs.last_inquiry || '';
      var lastIso = parseSheetDateIso_(lastInquiry);
      if (!lastIso || lastIso >= cutoffIso) continue;
      stale.push(contact);
    }
    if (page.contacts.length < limit) break;
    offset += limit;
  }
  return stale;
}

function purgeStaleBrevoLeads() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
  if (!apiKey) {
    brevoWarn_('Brevo retention: skipped (BREVO_API_KEY missing)');
    return;
  }
  var newsletterListId = getBrevoNewsletterListId_();
  if (!newsletterListId) {
    brevoWarn_('Brevo retention: aborted (BREVO_NEWSLETTER_LIST_ID missing)');
    return;
  }
  var cutoff = cutoffInquiryDateIso_();
  var staleContacts = collectStaleLeadListContacts_(apiKey, cutoff);
  var deleted = 0;
  var unlinked = 0;
  var skippedNewsletter = 0;
  var i;
  for (i = 0; i < staleContacts.length; i++) {
    var contact = staleContacts[i];
    var listIds = normalizeContactListIds_(contact);
    if (contactIsOnNewsletterList_(listIds, newsletterListId)) {
      skippedNewsletter += 1;
      continue;
    }
    var contactId = contact && contact.id != null ? Number(contact.id) : NaN;
    if (!contactId) continue;
    if (contactIsOnlyOnLeadList_(listIds)) {
      if (deleteBrevoContact_(apiKey, contactId)) deleted += 1;
      continue;
    }
    if (contactHasNonLeadList_(listIds)) {
      if (removeBrevoContactFromList_(apiKey, BREVO_CONTACT_LIST_ID, contact)) unlinked += 1;
    }
  }
  var prunedContact = pruneLeadSheetRows_('Contact', cutoff);
  var prunedTelefon = pruneLeadSheetRows_('Telefon', cutoff);
  Logger.log(
    'Brevo retention: deleted=' + deleted +
    ' unlinked=' + unlinked +
    ' skipped_newsletter=' + skippedNewsletter +
    ' sheets Contact=' + prunedContact +
    ' Telefon=' + prunedTelefon
  );
}

function brevoWarn_(message) {
  Logger.log(message);
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(message);
  }
}

function getOrCreateBrevoQueueSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(BREVO_QUEUE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(BREVO_QUEUE_SHEET);
    sheet.appendRow(BREVO_QUEUE_HEADERS);
    sheet.hideSheet();
  }
  return sheet;
}

function appendBrevoQueueRow_(payload) {
  var sheet = getOrCreateBrevoQueueSheet_();
  sheet.appendRow([
    new Date().toISOString(),
    JSON.stringify(payload),
    0,
    'pending',
    ''
  ]);
}

function enqueueBrevoPayload_(payload) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000);
    locked = true;
  } catch (lockErr) {
    brevoWarn_('Brevo enqueue: lock wait timed out; appending without lock');
  }
  try {
    appendBrevoQueueRow_(payload);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function postBrevoContactPayload_(apiKey, payload) {
  var smsOnly = payload && payload._smsOnly === true;
  var body = serializeBrevoApiPayload_(payload);
  var res = UrlFetchApp.fetch(BREVO_CONTACTS_URL, {
    method: 'post',
    headers: {
      'api-key': apiKey,
      accept: 'application/json',
      'content-type': 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var responseText = res.getContentText();
  if (code >= 200 && code < 300) {
    return { ok: true, code: code, errorDetail: '' };
  }
  if (smsOnly && isBrevoEmailRequiredError_(code, responseText)) {
    brevoWarn_('Brevo: phone sync skipped (SMS-only not accepted)');
    return { ok: true, code: code, errorDetail: BREVO_SMS_ONLY_SKIP_CODE, skipped: true };
  }
  return {
    ok: false,
    code: code,
    errorDetail: truncateBrevoErrorDetail_(code, responseText)
  };
}

function processBrevoQueue() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
  if (!apiKey) {
    brevoWarn_('Brevo queue: skipped (BREVO_API_KEY missing)');
    return;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    brevoWarn_('Brevo queue: lock busy');
    return;
  }
  try {
    var sheet = getOrCreateBrevoQueueSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var rowIndex;
    for (rowIndex = lastRow; rowIndex >= 2; rowIndex--) {
      var row = sheet.getRange(rowIndex, 1, 1, 5).getValues()[0];
      var status = String(row[3] || '');
      var attempts = Number(row[2]) || 0;
      if (status === 'failed') continue;
      if (attempts >= BREVO_QUEUE_MAX_ATTEMPTS) {
        sheet.getRange(rowIndex, 4).setValue('failed');
        continue;
      }
      var payload;
      try {
        payload = JSON.parse(row[1]);
      } catch (parseErr) {
        sheet.getRange(rowIndex, 3, 1, 3).setValues([
          [BREVO_QUEUE_MAX_ATTEMPTS, 'failed', 'invalid_payload']
        ]);
        continue;
      }
      var result;
      try {
        result = postBrevoContactPayload_(apiKey, payload);
      } catch (fetchErr) {
        result = {
          ok: false,
          code: 0,
          errorDetail: 'exception'
        };
      }
      if (result.ok) {
        sheet.deleteRow(rowIndex);
        continue;
      }
      attempts += 1;
      var nextStatus = attempts >= BREVO_QUEUE_MAX_ATTEMPTS ? 'failed' : 'pending';
      brevoWarn_(result.errorDetail);
      sheet.getRange(rowIndex, 3, 1, 3).setValues([[attempts, nextStatus, result.errorDetail]]);
    }
  } finally {
    lock.releaseLock();
  }
}

function installBrevoTrigger() {
  var handler = 'processBrevoQueue';
  var triggers = ScriptApp.getProjectTriggers();
  var i;
  for (i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handler) {
      return;
    }
  }
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
}

function installBrevoRetentionTrigger() {
  var handler = 'purgeStaleBrevoLeads';
  var triggers = ScriptApp.getProjectTriggers();
  var i;
  for (i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handler) {
      return;
    }
  }
  ScriptApp.newTrigger(handler).timeBased().onMonthDay(1).atHour(3).create();
}

function buildBrevoContactPayload_(data) {
  var email = data && data.Email != null ? String(data.Email).trim() : '';
  if (!email || !isValidEmailForBrevo_(email)) return null;
  var payload = {
    email: email,
    attributes: buildLeadBrevoAttributes_(data, 'contact'),
    listIds: [BREVO_CONTACT_LIST_ID],
    updateEnabled: true
  };
  return payload;
}

function buildBrevoPhonePayload_(data) {
  var phone = normalizeRomanianPhoneE164_(data && data.Telefon);
  if (!phone) return null;
  var payload = {
    attributes: buildLeadBrevoAttributes_(data, 'telefon'),
    listIds: [BREVO_CONTACT_LIST_ID],
    updateEnabled: true,
    _smsOnly: true
  };
  payload.attributes.SMS = phone;
  return payload;
}

function enqueueBrevoContactList_(sheetName, data) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
    if (!apiKey) {
      brevoWarn_('Brevo: skipped enqueue (BREVO_API_KEY missing)');
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
      brevoWarn_('Brevo: skipped enqueue (no payload for ' + sheetName + ')');
      return;
    }
    enqueueBrevoPayload_(payload);
  } catch (err) {
    brevoWarn_('Brevo enqueue: exception');
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
    enqueueBrevoContactList_(sheet, data);
    return jsonOutput_({ ok: true });
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'server' });
  }
}
