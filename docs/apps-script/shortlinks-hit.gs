// Public, increment-only click counter for ShortLinks. No API key; no other writes.
var HIT_MAX_PER_MIN = 60;
function handleHit_(body) {
  var id = String((body && body.id) || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return hitOut_(false, 'BAD_REQUEST');
  var cache = CacheService.getScriptCache();
  var key = 'hit:' + id + ':' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0);
  if (n >= HIT_MAX_PER_MIN) return hitOut_(false, 'RATE_LIMITED');
  cache.put(key, String(n + 1), 120);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return hitOut_(false, 'BUSY');
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ShortLinks');
    if (!sh) return hitOut_(false, 'NOT_FOUND');
    var v = sh.getDataRange().getValues();
    var h = v[0].map(function (x) { return String(x).trim(); });
    var idC = h.map(function (x) { return x.toLowerCase(); }).indexOf('id');
    var cC = h.indexOf('Total clicks'), aC = h.indexOf('Activ');
    if (idC < 0 || cC < 0) return hitOut_(false, 'SCHEMA_ERROR');
    for (var r = 1; r < v.length; r++) {
      if (String(v[r][idC]).trim() !== id) continue;
      if (aC >= 0 && v[r][aC] === false) return hitOut_(false, 'NOT_FOUND');
      sh.getRange(r + 1, cC + 1).setValue((Number(v[r][cC]) || 0) + 1);
      return hitOut_(true);
    }
    return hitOut_(false, 'NOT_FOUND');
  } finally { lock.releaseLock(); }
}
function hitOut_(ok, code) {
  return ContentService.createTextOutput(JSON.stringify(ok ? { success: true } : { success: false, error: { code: code } }))
    .setMimeType(ContentService.MimeType.JSON);
}
// First lines of the existing doPost(e), BEFORE the API-key check:
//   var hb; try { hb = JSON.parse(e.postData.contents); } catch (_) { hb = null; }
//   if (hb && hb.action === 'hit') return handleHit_(hb);
