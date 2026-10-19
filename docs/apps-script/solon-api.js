
/**
 * Google Sheets REST-style CRUD API.
 *
 * Script Properties required:
 *   API_KEY        - Secret API key required by every request.
 *
 * Each sheet must have a header row and a unique "id" column.
 * Deploy as a Web App executing as the script owner.
 */

const CONFIG = Object.freeze({
  API_KEY_PROPERTY: 'API_KEY',
  DEFAULT_ID_COLUMN: 'id',
  DEFAULT_LIMIT: 100,
  MAX_LIMIT: 500,
  LOCK_TIMEOUT_MS: 10000
});

/**
 * Handles GET requests: list sheets, list records, or get a record.
 *
 * Examples:
 *   ?apiKey=KEY
 *   ?apiKey=KEY&sheet=Users
 *   ?apiKey=KEY&sheet=Users&id=UUID
 *   ?apiKey=KEY&sheet=Users&limit=20&offset=0
 *
 * @param {GoogleAppsScript.Events.DoGet} e Request event.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON response.
 */
function doGet(e) {
  try {
    authorize_(e && e.parameter && e.parameter.apiKey);

    const params = (e && e.parameter) || {};
    const spreadsheet = getSpreadsheet_();

    // Without a sheet parameter, return available sheet names.
    if (!params.sheet) {
      return jsonResponse_({
        success: true,
        sheets: spreadsheet.getSheets().map(sheet => sheet.getName())
      });
    }

    const sheet = getSheet_(spreadsheet, params.sheet);
    const schema = getSchema_(sheet);

    if (params.id !== undefined && params.id !== '') {
      const record = findRecord_(sheet, schema, params.id);

      if (!record) {
        throw apiError_('NOT_FOUND', 'Record not found.');
      }

      return jsonResponse_({ success: true, data: record.data });
    }

    const allRecords = readRecords_(sheet, schema);
    const offset = parseInteger_(
      params.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset'
    );
    const limit = parseInteger_(
      params.limit,
      CONFIG.DEFAULT_LIMIT,
      1,
      CONFIG.MAX_LIMIT,
      'limit'
    );

    return jsonResponse_({
      success: true,
      sheet: sheet.getName(),
      data: allRecords.slice(offset, offset + limit),
      pagination: {
        total: allRecords.length,
        offset: offset,
        limit: limit,
        hasMore: offset + limit < allRecords.length
      }
    });
  } catch (error) {
    return errorResponse_(error);
  }
}

/**
 * Handles POST requests for create, update, and delete.
 *
 * Request body examples:
 *   {"apiKey":"KEY","action":"create","sheet":"Users",
 *    "data":{"name":"John","email":"john@example.com"}}
 *
 *   {"apiKey":"KEY","action":"update","sheet":"Users",
 *    "id":"UUID","data":{"name":"Jane"}}
 *
 *   {"apiKey":"KEY","action":"delete","sheet":"Users","id":"UUID"}
 *
 * @param {GoogleAppsScript.Events.DoPost} e Request event.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON response.
 */
function doPost(e) {
  var hb; try { hb = JSON.parse(e.postData.contents); } catch (_) { hb = null; }
  if (hb && hb.action === 'hit') return handleHit_(hb);
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw apiError_('BAD_REQUEST', 'A JSON request body is required.');
    }

    let body;

    try {
      body = JSON.parse(e.postData.contents);
    } catch (_) {
      throw apiError_('BAD_REQUEST', 'Invalid JSON request body.');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw apiError_('BAD_REQUEST', 'The request body must be an object.');
    }

    authorize_(body.apiKey);

    const action = String(body.action || '').toLowerCase();
    const spreadsheet = getSpreadsheet_();
    const sheet = getSheet_(spreadsheet, body.sheet);
    const schema = getSchema_(sheet);

    let result;

    // Serialize writes to avoid concurrent modifications colliding.
    const lock = LockService.getScriptLock();

    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      throw apiError_('BUSY', 'The API is busy. Retry the request.');
    }

    try {
      switch (action) {
        case 'create':
          result = createRecord_(sheet, schema, body.data);
          break;

        case 'update':
          result = updateRecord_(sheet, schema, body.id, body.data);
          break;

        case 'delete':
          result = deleteRecord_(sheet, schema, body.id);
          break;

        default:
          throw apiError_(
            'BAD_REQUEST',
            'Unsupported action. Use create, update, or delete.'
          );
      }

      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    return jsonResponse_({
      success: true,
      action: action,
      sheet: sheet.getName(),
      data: result
    });
  } catch (error) {
    return errorResponse_(error);
  }
}

/**
 * Returns the spreadsheet containing this bound script.
 * No SPREADSHEET_ID Script Property is required.
 *
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw apiError_(
      'CONFIGURATION_ERROR',
      'This script must be bound to a Google Spreadsheet.'
    );
  }

  return spreadsheet;
}

/** Retrieves a sheet by name, rejecting invalid names. */
function getSheet_(spreadsheet, name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw apiError_('BAD_REQUEST', 'A sheet name is required.');
  }

  const sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    throw apiError_('NOT_FOUND', 'Sheet not found: ' + name);
  }

  return sheet;
}

/**
 * Reads and validates the header row.
 * Header names must be non-empty and unique.
 */
function getSchema_(sheet) {
  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1 || sheet.getLastRow() < 1) {
    throw apiError_('SCHEMA_ERROR', 'The sheet needs a header row.');
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(header => header.trim());

  if (headers.some(header => !header)) {
    throw apiError_('SCHEMA_ERROR', 'Headers cannot be empty.');
  }

  const normalized = headers.map(header => header.toLowerCase());

  if (new Set(normalized).size !== headers.length) {
    throw apiError_('SCHEMA_ERROR', 'Headers must be unique.');
  }

  const idColumn = PropertiesService.getScriptProperties()
    .getProperty('ID_COLUMN') || CONFIG.DEFAULT_ID_COLUMN;

  const idIndex = headers.findIndex(
    header => header.toLowerCase() === idColumn.toLowerCase()
  );

  if (idIndex < 0) {
    throw apiError_(
      'SCHEMA_ERROR',
      'Missing ID column "' + idColumn + '".'
    );
  }

  return { headers: headers, idIndex: idIndex };
}

/** Reads non-empty data rows as objects keyed by header. */
function readRecords_(sheet, schema) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  const values = sheet.getRange(
    2, 1, lastRow - 1, schema.headers.length
  ).getValues();

  return values
    .map((row, index) => ({
      rowNumber: index + 2,
      data: rowToObject_(row, schema.headers)
    }))
    .filter(item => item.data[schema.headers[schema.idIndex]] !== '')
    .map(item => item.data);
}

/** Converts a spreadsheet row into a JSON-friendly object. */
function rowToObject_(row, headers) {
  const record = {};

  headers.forEach((header, index) => {
    const value = row[index];

    record[header] = value instanceof Date
      ? value.toISOString()
      : value;
  });

  return record;
}

/** Finds a record by its ID; returns its row number and data. */
function findRecord_(sheet, schema, id) {
  if (id === undefined || id === null || String(id) === '') {
    throw apiError_('BAD_REQUEST', 'A record ID is required.');
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return null;

  const idValues = sheet.getRange(
    2, schema.idIndex + 1, lastRow - 1, 1
  ).getDisplayValues();

  const matches = [];

  idValues.forEach((row, index) => {
    if (row[0] === String(id)) matches.push(index + 2);
  });

  if (matches.length > 1) {
    throw apiError_('DATA_INTEGRITY_ERROR', 'Duplicate record IDs found.');
  }

  if (!matches.length) return null;

  const rowNumber = matches[0];
  const row = sheet.getRange(
    rowNumber, 1, 1, schema.headers.length
  ).getValues()[0];

  return {
    rowNumber: rowNumber,
    data: rowToObject_(row, schema.headers)
  };
}

/** Creates a record and generates an ID when omitted. */
function createRecord_(sheet, schema, data) {
  validateData_(data, schema);

  const record = Object.assign({}, data);
  const idHeader = schema.headers[schema.idIndex];

  if (record[idHeader] === undefined || record[idHeader] === '') {
    record[idHeader] = Utilities.getUuid().split("-")[0];
  }

  if (findRecord_(sheet, schema, record[idHeader])) {
    throw apiError_('CONFLICT', 'A record with this ID already exists.');
  }

  const row = schema.headers.map(header =>
    sanitizeValue_(record[header] === undefined ? '' : record[header])
  );

  const rowNumber = Math.max(sheet.getLastRow() + 1, 2);

  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);

  return rowToObject_(row, schema.headers);
}

/** Updates only the supplied fields, leaving other values unchanged. */
function updateRecord_(sheet, schema, id, data) {
  if (id === undefined || id === null || String(id) === '') {
    throw apiError_('BAD_REQUEST', 'A record ID is required.');
  }

  validateData_(data, schema);

  const record = findRecord_(sheet, schema, id);

  if (!record) {
    throw apiError_('NOT_FOUND', 'Record not found.');
  }

  const idHeader = schema.headers[schema.idIndex];

  if (
    Object.prototype.hasOwnProperty.call(data, idHeader) &&
    String(data[idHeader]) !== String(id)
  ) {
    throw apiError_('BAD_REQUEST', 'Record IDs cannot be changed.');
  }

  const updated = Object.assign({}, record.data);

  Object.keys(data).forEach(key => {
    updated[key] = data[key];
  });

  const row = schema.headers.map(header =>
    sanitizeValue_(updated[header] === undefined ? '' : updated[header])
  );

  sheet.getRange(
    record.rowNumber, 1, 1, row.length
  ).setValues([row]);

  return rowToObject_(row, schema.headers);
}

/** Deletes a record by ID. */
function deleteRecord_(sheet, schema, id) {
  const record = findRecord_(sheet, schema, id);

  if (!record) {
    throw apiError_('NOT_FOUND', 'Record not found.');
  }

  sheet.deleteRow(record.rowNumber);

  return { id: id, deleted: true };
}

/** Validates the request's data object and column names. */
function validateData_(data, schema) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw apiError_('BAD_REQUEST', 'A data object is required.');
  }

  const unknown = Object.keys(data).filter(
    key => !schema.headers.includes(key)
  );

  if (unknown.length) {
    throw apiError_(
      'BAD_REQUEST',
      'Unknown columns: ' + unknown.join(', ')
    );
  }

  Object.keys(data).forEach(key => {
    const value = data[key];

    if (
      value !== null &&
      typeof value === 'object'
    ) {
      throw apiError_(
        'BAD_REQUEST',
        'Column values must be primitive JSON values: ' + key
      );
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw apiError_('BAD_REQUEST', 'Invalid number: ' + key);
    }
  });
}

/**
 * Prevents untrusted strings from being interpreted as formulas.
 * This is a basic mitigation; apply additional domain validation.
 */
function sanitizeValue_(value) {
  if (typeof value !== 'string') return value;

  return /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
}

/** Validates API-key authentication using Script Properties. */
function authorize_(providedKey) {
  const expectedKey = PropertiesService.getScriptProperties()
    .getProperty(CONFIG.API_KEY_PROPERTY);

  if (!expectedKey) {
    throw apiError_(
      'CONFIGURATION_ERROR',
      'Set API_KEY in Script Properties.'
    );
  }

  if (
    typeof providedKey !== 'string' ||
    providedKey.length !== expectedKey.length ||
    providedKey !== expectedKey
  ) {
    throw apiError_('UNAUTHORIZED', 'Invalid or missing API key.');
  }
}

/** Parses and bounds an integer query parameter. */
function parseInteger_(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw apiError_(
      'BAD_REQUEST',
      name + ' must be an integer between ' + min + ' and ' + max + '.'
    );
  }

  return number;
}

/** Creates a consistent API error. */
function apiError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Serializes JSON responses. */
function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Apps Script ContentService does not expose arbitrary HTTP status codes.
 * The error code is therefore included in the JSON response.
 */
function errorResponse_(error) {
  return jsonResponse_({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'An unexpected error occurred.'
    }
  });
}


// Public, increment-only click counter for ShortLinks. No API key; no other writes.
// Increments Clicks. The header match is trimmed and case-insensitive.
// Falls back to Total clicks only when no Clicks column exists.
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
    var h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
    var idC = h.indexOf('id');
    var cC = h.indexOf('clicks');
    if (cC < 0) cC = h.indexOf('total clicks');
    var aC = h.indexOf('activ');
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
