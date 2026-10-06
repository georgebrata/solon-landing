#!/usr/bin/env node

/**
 * apply-feature-flags.js
 *
 * Controls visibility of SOLON homepage sections based on feature-flags.json.
 * Disables sections by safely commenting them out in index.html (escapes nested
 * comment tokens to preserve valid HTML) and restores them when enabled.
 *
 * Usage:
 *   node scripts/apply-feature-flags.js [options]
 *
 * Options:
 *   --dry-run       Preview changes without writing to index.html
 *   --status        Show current status of all flags and sections in HTML
 *   --config <path> Path to feature flags JSON (default: feature-flags.json)
 *   --input <path>  Path to HTML file to read (default: index.html)
 *   --output <path> Path to HTML file to write (default: same as --input)
 *   --sync-nav      Also comment/uncomment navbar links pointing to #section-id
 *   --help          Show help message
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, 'feature-flags.json');
const DEFAULT_HTML_PATH = path.join(ROOT_DIR, 'index.html');

const ESCAPED_HYPHEN_TOKEN = '__FF_DOUBLE_HYPHEN__';

/** Print a JSON error object for CI logs. */
const logScriptError = (payload, error) => {
  const body = Object.assign(
    {
      ok: false,
      script: "apply-feature-flags.js",
    },
    payload
  );
  if (error) {
    body.message = error.message || String(error);
    if (error.stack) body.stack = error.stack;
  }
  console.error(JSON.stringify(body));
  if (error?.stack) console.error(error.stack);
};

/** Log a feature-flag failure and throw so the CLI can set an exit code. */
const fail = (message, extra, error) => {
  logScriptError(Object.assign({ message }, extra || {}), error);
  const wrapped = error instanceof Error ? error : new Error(message);
  wrapped.solonLogged = true;
  throw wrapped;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    statusOnly: false,
    syncNav: null, // null means use config file setting if present
    configPath: DEFAULT_CONFIG_PATH,
    inputPath: DEFAULT_HTML_PATH,
    outputPath: DEFAULT_HTML_PATH,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--status') {
      options.statusOnly = true;
    } else if (arg === '--sync-nav') {
      options.syncNav = true;
    } else if (arg === '--no-sync-nav') {
      options.syncNav = false;
    } else if (arg === '--config' && i + 1 < args.length) {
      options.configPath = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--input' && i + 1 < args.length) {
      options.inputPath = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--output' && i + 1 < args.length) {
      options.outputPath = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.warn(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
SOLON Feature Flags Manager

Applies homepage section visibility rules from a JSON config file to index.html.

Usage:
  node scripts/apply-feature-flags.js [options]

Options:
  --dry-run          Simulate execution without modifying files
  --status           Display status of all feature flags and sections
  --config <path>    Specify config file (default: feature-flags.json)
  --input <path>     Specify input HTML (default: index.html)
  --output <path>    Specify output HTML (default: index.html)
  --sync-nav         Toggle matching navigation links (#section-id) in header
  --no-sync-nav      Do not touch navigation links
  --help, -h         Show this message
`);
}

/**
 * Finds an active (uncommented) section with id="sectionId".
 * Supports both <section id="..."> and <div id="..."> (e.g. newsletter).
 * Ignores any occurrences inside normal HTML comments.
 */
function findActiveSection(html, sectionId) {
  let idx = 0;
  while (idx < html.length) {
    // Skip HTML comments
    if (html.startsWith('<!--', idx)) {
      const endComment = html.indexOf('-->', idx + 4);
      if (endComment === -1) break;
      idx = endComment + 3;
      continue;
    }

    // Check for <section or <div tag
    let matchedTag = null;
    if (html.startsWith('<section', idx)) {
      matchedTag = 'section';
    } else if (html.startsWith('<div', idx)) {
      matchedTag = 'div';
    }

    if (matchedTag) {
      const openTagEnd = html.indexOf('>', idx + matchedTag.length + 1);
      if (openTagEnd === -1) break;
      const openTag = html.slice(idx, openTagEnd + 1);

      // Check if id matches exact sectionId or special case for newsletter
      const idMatch = openTag.match(/\bid=[\"\x27]([^\s\"\x27]+)[\"\x27]/i);
      const isTarget =
        (idMatch && idMatch[1] === sectionId) ||
        (sectionId === 'newsletter' &&
          (idMatch
            ? idMatch[1] === 'newsletter'
            : /\bclass=[\"\x27][^\"\x27]*\bfooter-newsletter\b/i.test(openTag)));

      if (isTarget) {
        // Track tag nesting to locate matching closing tag
        let depth = 1;
        let scanIdx = openTagEnd + 1;
        const openTagPrefix = `<${matchedTag}`;
        const closeTagStr = `</${matchedTag}>`;

        while (scanIdx < html.length && depth > 0) {
          if (html.startsWith('<!--', scanIdx)) {
            const endC = html.indexOf('-->', scanIdx + 4);
            if (endC === -1) break;
            scanIdx = endC + 3;
            continue;
          }

          if (html.startsWith(openTagPrefix, scanIdx)) {
            const nextChar = html[scanIdx + openTagPrefix.length];
            if (/[\s>\/]/.test(nextChar)) {
              depth++;
            }
          } else if (html.startsWith(closeTagStr, scanIdx)) {
            depth--;
            if (depth === 0) {
              const closeTagEnd = scanIdx + closeTagStr.length;
              return {
                start: idx,
                end: closeTagEnd,
                content: html.slice(idx, closeTagEnd),
              };
            }
          }
          scanIdx++;
        }
      }
    }
    idx++;
  }
  return null;
}

/**
 * Finds a section previously disabled via feature flag comment wrapper:
 * <!-- [FEATURE_FLAG_DISABLED:sectionId] ... [/FEATURE_FLAG_DISABLED:sectionId] -->
 */
function findDisabledSection(html, sectionId) {
  const pattern = new RegExp(
    `<!--\\s*\\[FEATURE_FLAG_DISABLED:${sectionId}\\]\\r?\\n([\\s\\S]*?)\\r?\\n?\\[\\/FEATURE_FLAG_DISABLED:${sectionId}\\]\\s*-->`,
    'g'
  );
  const match = pattern.exec(html);
  if (!match) return null;

  return {
    start: match.index,
    end: match.index + match[0].length,
    fullMatch: match[0],
    innerContent: match[1],
  };
}

/**
 * Finds legacy commented echipa section if not yet converted to feature flag wrapper.
 */
function findLegacyEchipaSection(html) {
  const pattern = /<!--\s*START_COMMENT\s*======= Team Section =======\s*END_COMMENT\r?\n(\s*<section id="echipa"[\s\S]*?<\/section>)\r?\n\s*START_COMMENT\s*End Team Section\s*END_COMMENT\s*-->/;
  const match = html.match(pattern);
  if (!match) return null;

  return {
    start: match.index,
    end: match.index + match[0].length,
    fullMatch: match[0],
    rawSection: match[1],
  };
}

/**
 * Safely wraps section content inside an HTML comment without comment-nesting issues.
 */
function wrapDisabledSection(sectionId, rawContent) {
  const safeContent = rawContent.replace(/--/g, ESCAPED_HYPHEN_TOKEN);
  return `<!-- [FEATURE_FLAG_DISABLED:${sectionId}]\n${safeContent}\n[/FEATURE_FLAG_DISABLED:${sectionId}] -->`;
}

/**
 * Restores section content from the disabled comment wrapper.
 */
function unwrapDisabledSection(innerContent) {
  let restored = innerContent.replace(new RegExp(ESCAPED_HYPHEN_TOKEN, 'g'), '--');
  // Handle any legacy START_COMMENT / END_COMMENT tokens if present
  restored = restored
    .replace(/START_COMMENT/g, '<!--')
    .replace(/END_COMMENT/g, '-->');
  return restored;
}

/**
 * Toggles navbar links corresponding to #sectionId.
 * Ignores nav links that are already inside standard HTML comments.
 */
function toggleNavLink(html, sectionId, enabled) {
  if (enabled) {
    // Restore disabled nav link
    const navDisabledPattern = new RegExp(
      `<!--\\s*\\[FEATURE_FLAG_NAV_DISABLED:${sectionId}\\]\\r?\\n?([\\s\\S]*?)\\r?\\n?\\[\\/FEATURE_FLAG_NAV_DISABLED:${sectionId}\\]\\s*-->`,
      'g'
    );
    return html.replace(navDisabledPattern, (match, inner) => {
      return inner.replace(new RegExp(ESCAPED_HYPHEN_TOKEN, 'g'), '--');
    });
  } else {
    // Disable only active (uncommented) nav items pointing to `#sectionId`
    let result = '';
    let idx = 0;
    while (idx < html.length) {
      if (html.startsWith('<!--', idx)) {
        const endComment = html.indexOf('-->', idx + 4);
        if (endComment === -1) {
          result += html.slice(idx);
          break;
        }
        result += html.slice(idx, endComment + 3);
        idx = endComment + 3;
        continue;
      }

      if (html.startsWith('<li', idx)) {
        const closeLi = html.indexOf('</li>', idx + 3);
        if (closeLi !== -1) {
          const liChunk = html.slice(idx, closeLi + 5);
          const hrefRegex = new RegExp(`href=["']#${sectionId}["']`, 'i');
          if (hrefRegex.test(liChunk) && !liChunk.includes('FEATURE_FLAG_NAV_DISABLED')) {
            const safeItem = liChunk.replace(/--/g, ESCAPED_HYPHEN_TOKEN);
            result += `<!-- [FEATURE_FLAG_NAV_DISABLED:${sectionId}]\n${safeItem}\n[/FEATURE_FLAG_NAV_DISABLED:${sectionId}] -->`;
            idx = closeLi + 5;
            continue;
          }
        }
      }

      result += html[idx];
      idx++;
    }
    return result;
  }
}

function run() {
  const options = parseArgs();

  if (!fs.existsSync(options.configPath)) {
    fail(`Config file not found: ${options.configPath}`, { file: options.configPath });
  }

  if (!fs.existsSync(options.inputPath)) {
    fail(`HTML file not found: ${options.inputPath}`, { file: options.inputPath });
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(options.configPath, 'utf8'));
  } catch (err) {
    fail(`Failed to parse config file ${options.configPath}: ${err.message}`, {
      file: options.configPath,
    }, err);
  }

  const sectionsConfig = (config.homepage && config.homepage.sections) || {};
  const settings = config.settings || {};
  const shouldSyncNav = options.syncNav !== null ? options.syncNav : Boolean(settings.syncNav);

  let html = fs.readFileSync(options.inputPath, 'utf8');
  const originalHtml = html;

  // Handle status display
  if (options.statusOnly) {
    console.log(`\nSOLON Homepage Feature Flags Status:`);
    console.log(`Config file: ${options.configPath}`);
    console.log(`HTML file:   ${options.inputPath}\n`);
    console.log(
      `${'Section ID'.padEnd(16)} | ${'Config Flag'.padEnd(12)} | ${'HTML State'.padEnd(14)} | Label`
    );
    console.log('-'.repeat(75));

    for (const [id, meta] of Object.entries(sectionsConfig)) {
      const active = findActiveSection(html, id);
      const disabled = findDisabledSection(html, id);
      const legacy = id === 'echipa' ? findLegacyEchipaSection(html) : null;

      let htmlState = 'UNKNOWN';
      if (active) htmlState = 'ACTIVE';
      else if (disabled) htmlState = 'DISABLED (FF)';
      else if (legacy) htmlState = 'DISABLED (leg)';
      else htmlState = 'NOT FOUND';

      const configFlag = meta.enabled ? 'ENABLED' : 'DISABLED';
      console.log(
        `${id.padEnd(16)} | ${configFlag.padEnd(12)} | ${htmlState.padEnd(14)} | ${meta.label || ''}`
      );
    }
    console.log();
    return;
  }

  // Pre-process legacy echipa if present so it adheres to standard disabled format
  const legacyEchipa = findLegacyEchipaSection(html);
  if (legacyEchipa) {
    let cleanEchipa = legacyEchipa.rawSection
      .replace(/START_COMMENT/g, '<!--')
      .replace(/END_COMMENT/g, '-->');

    if (sectionsConfig.echipa && sectionsConfig.echipa.enabled) {
      // Restore directly
      html =
        html.slice(0, legacyEchipa.start) +
        `<!-- ======= Team Section ======= -->\n    ${cleanEchipa}\n    <!-- End Team Section -->` +
        html.slice(legacyEchipa.end);
    } else {
      // Standardize disabled format
      const wrapped = wrapDisabledSection('echipa', cleanEchipa);
      html =
        html.slice(0, legacyEchipa.start) +
        `<!-- ======= Team Section ======= -->\n    ${wrapped}\n    <!-- End Team Section -->` +
        html.slice(legacyEchipa.end);
    }
  }

  let changesCount = 0;
  console.log(`\nApplying feature flags from ${path.basename(options.configPath)}...`);

  for (const [id, meta] of Object.entries(sectionsConfig)) {
    const isEnabled = Boolean(meta.enabled);
    const label = meta.label || id;

    const active = findActiveSection(html, id);
    const disabled = findDisabledSection(html, id);

    if (isEnabled) {
      if (active) {
        console.log(`  ✓ [${id}] ENABLED - Already active (${label})`);
      } else if (disabled) {
        const restoredContent = unwrapDisabledSection(disabled.innerContent);
        html =
          html.slice(0, disabled.start) +
          restoredContent +
          html.slice(disabled.end);
        changesCount++;
        console.log(`  ▲ [${id}] ENABLED - Section restored (${label})`);
      } else {
        const htmlPath = path.relative(ROOT_DIR, options.inputPath) || options.inputPath;
        console.warn(
          `  ! [${id}] ENABLED - Warning: section <section id="${id}"> (or matching <div>) not found in ${htmlPath} (${label}). The flag is enabled in ${path.basename(options.configPath)} but there is no uncommented target element to restore.`
        );
      }

      if (shouldSyncNav) {
        const updated = toggleNavLink(html, id, true);
        if (updated !== html) {
          html = updated;
          changesCount++;
          console.log(`    ↳ Nav link restored for #${id}`);
        }
      }
    } else {
      // Section should be DISABLED
      if (disabled) {
        console.log(`  ✓ [${id}] DISABLED - Already disabled (${label})`);
      } else if (active) {
        const wrapped = wrapDisabledSection(id, active.content);
        html =
          html.slice(0, active.start) +
          wrapped +
          html.slice(active.end);
        changesCount++;
        console.log(`  ▼ [${id}] DISABLED - Section commented out (${label})`);
      } else {
        const htmlPath = path.relative(ROOT_DIR, options.inputPath) || options.inputPath;
        console.warn(
          `  ! [${id}] DISABLED - Warning: section <section id="${id}"> (or matching <div>) not found in ${htmlPath} (${label}). The flag is disabled in ${path.basename(options.configPath)} but there is no active or previously wrapped section to hide.`
        );
      }

      if (shouldSyncNav) {
        const updated = toggleNavLink(html, id, false);
        if (updated !== html) {
          html = updated;
          changesCount++;
          console.log(`    ↳ Nav link commented out for #${id}`);
        }
      }
    }
  }

  // Safety checks
  if (!html.includes('<!DOCTYPE html>') || !html.includes('</html>')) {
    fail(
      `Generated HTML is malformed after applying feature flags to ${options.inputPath}: missing <!DOCTYPE html> or </html>.`,
      { file: options.inputPath, code: "malformed_html" }
    );
  }
  if (html.includes(ESCAPED_HYPHEN_TOKEN)) {
    const withoutWrappers = html
      .replace(/<!--\s*\[FEATURE_FLAG_DISABLED:[^\]]+\][\s\S]*?\[\/FEATURE_FLAG_DISABLED:[^\]]+\]\s*-->/g, "")
      .replace(/<!--\s*\[FEATURE_FLAG_NAV_DISABLED:[^\]]+\][\s\S]*?\[\/FEATURE_FLAG_NAV_DISABLED:[^\]]+\]\s*-->/g, "");
    if (withoutWrappers.includes(ESCAPED_HYPHEN_TOKEN)) {
      fail(
        `Generated HTML leaked the internal hyphen escape token outside feature-flag wrappers in ${options.inputPath}.`,
        { file: options.inputPath, code: "leaked_escape_token" }
      );
    }
  }
  const openedFlags = (html.match(/\[FEATURE_FLAG_DISABLED:/g) || []).length;
  const closedFlags = (html.match(/\[\/FEATURE_FLAG_DISABLED:/g) || []).length;
  if (openedFlags !== closedFlags) {
    fail(
      `Generated HTML has unbalanced FEATURE_FLAG_DISABLED markers in ${options.inputPath} (open=${openedFlags}, close=${closedFlags}).`,
      { file: options.inputPath, code: "unbalanced_feature_flag_markers", openedFlags, closedFlags }
    );
  }

  if (changesCount === 0 && html === originalHtml) {
    console.log('\nNo changes needed. HTML is up to date with feature-flags.json.\n');
    return;
  }

  if (options.dryRun) {
    console.log(`\n[DRY RUN] ${changesCount} modification(s) simulated. File NOT written.\n`);
    return;
  }

  fs.writeFileSync(options.outputPath, html, 'utf8');
  console.log(`\nSuccess! Updated ${options.outputPath} (${changesCount} changes applied).\n`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    if (!error?.solonLogged) {
      logScriptError({ message: error?.message || String(error), code: "uncaught" }, error);
    }
    process.exitCode = 1;
  }
}

module.exports = {
  findActiveSection,
  findDisabledSection,
  wrapDisabledSection,
  unwrapDisabledSection,
  toggleNavLink,
};
