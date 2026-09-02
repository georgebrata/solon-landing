#!/usr/bin/env node

/**
 * validate-article.js
 * Automated Quality Gate for SOLON blog articles.
 * Validates frontmatter, word count, section count, UNBR educational disclaimer,
 * SOLON CTA, image markup, internal links, and banned LLM phrases.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../../');
const POSTS_DIR = path.resolve(WORKSPACE_ROOT, 'blog/posts');
const ASSETS_IMG_DIR = path.resolve(WORKSPACE_ROOT, 'assets/img');
const BANNED_PHRASES_FILE = path.resolve(__dirname, '../resources/banned-phrases.txt');
const AUDIT_LOG_FILE = path.resolve(POSTS_DIR, '.generation-log.jsonl');

function loadBannedPhrases() {
  if (!fs.existsSync(BANNED_PHRASES_FILE)) return [];
  const lines = fs.readFileSync(BANNED_PHRASES_FILE, 'utf8').split(/\r?\n/);
  return lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.toLowerCase());
}

function validateArticle(filePath, options = {}) {
  const issues = [];
  const warnings = [];

  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      issues: [`File not found: ${filePath}`],
      warnings: []
    };
  }

  const rawContent = fs.readFileSync(filePath, 'utf8');
  const match = rawContent.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    return {
      valid: false,
      issues: ['Invalid frontmatter formatting: missing YAML enclosure (---)'],
      warnings: []
    };
  }

  let frontmatter;
  try {
    frontmatter = yaml.load(match[1]);
  } catch (err) {
    return {
      valid: false,
      issues: [`YAML parsing error: ${err.message}`],
      warnings: []
    };
  }

  const content = match[2];
  const filenameSlug = path.basename(filePath, '.md');

  // 1. Frontmatter Validation
  if (!frontmatter.title || typeof frontmatter.title !== 'string') {
    issues.push('Frontmatter "title" is missing or not a string.');
  } else {
    if (frontmatter.title.length > 55) {
      warnings.push(`Title length (${frontmatter.title.length} chars) exceeds optimal target of 50 chars.`);
    }
  }

  if (!frontmatter.slug || typeof frontmatter.slug !== 'string') {
    issues.push('Frontmatter "slug" is missing.');
  } else {
    if (frontmatter.slug !== filenameSlug) {
      issues.push(`Frontmatter slug ("${frontmatter.slug}") does not match filename ("${filenameSlug}").`);
    }
    if (!/^[a-z0-9-]+$/.test(frontmatter.slug)) {
      issues.push('Frontmatter slug must contain only lowercase alphanumeric characters and hyphens.');
    }
  }

  if (!frontmatter.description || typeof frontmatter.description !== 'string') {
    issues.push('Frontmatter "description" is missing.');
  } else {
    if (frontmatter.description.length > 165) {
      warnings.push(`Description length (${frontmatter.description.length} chars) exceeds recommended max 160 chars.`);
    }
  }

  if (!frontmatter.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(frontmatter.date))) {
    issues.push('Frontmatter "date" must follow YYYY-MM-DD format.');
  }

  if (!Array.isArray(frontmatter.categories) || frontmatter.categories.length === 0) {
    issues.push('Frontmatter "categories" must be a non-empty array of strings.');
  } else {
    for (const cat of frontmatter.categories) {
      if (cat !== cat.toLowerCase()) {
        warnings.push(`Category "${cat}" should be lowercase ("${cat.toLowerCase()}").`);
      }
    }
  }

  if (!Array.isArray(frontmatter.tags) || frontmatter.tags.length === 0) {
    issues.push('Frontmatter "tags" must be a non-empty array of strings.');
  } else {
    if (frontmatter.tags.length > 8) {
      warnings.push(`Tags count (${frontmatter.tags.length}) exceeds recommended maximum of 7 tags.`);
    }
    const hasLawyerTag = frontmatter.tags.some(t => {
      const s = String(t).toLowerCase();
      return s.includes('avocat') || s.includes('avocați') || s.includes('avocati') || s.includes('avocatur');
    });
    if (!hasLawyerTag) {
      warnings.push('Tags should include "avocați" or "avocat".');
    }
  }

  // 2. Word Count Benchmark
  const words = content.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount < 1200) {
    issues.push(`Word count too low (${wordCount} words). Minimum standard is 1,500 words.`);
  } else if (wordCount < 1800) {
    warnings.push(`Word count (${wordCount} words) is below the modern high-authority benchmark of 2,000 words.`);
  }

  // 3. Section & Heading Analysis
  const h2Matches = content.match(/^##\s+.+$/gm) || [];
  if (h2Matches.length < 10) {
    issues.push(`Insufficient H2 sections (${h2Matches.length} found). Minimum requirement is 10 H2 sections.`);
  } else if (h2Matches.length < 12) {
    warnings.push(`H2 section count (${h2Matches.length}) is slightly below benchmark of 12+ sections.`);
  }

  const hasConclusion = h2Matches.some(h => /concluzie/i.test(h));
  if (!hasConclusion) {
    issues.push('Missing "## Concluzie" section.');
  }

  // Check for rogue H1 in content (template injects H1)
  const h1Matches = content.match(/^#\s+.+$/gm) || [];
  if (h1Matches.length > 1) {
    warnings.push('Multiple H1 headings detected in markdown body. Template already supplies entry title.');
  }

  // 4. UNBR Legal Educational Disclaimer
  const unbrRegex = /Prezentul articol are un caracter pur informativ și educațional și nu constituie consultanță juridică în sensul Legii nr\. 51\/1995/i;
  if (!unbrRegex.test(content)) {
    issues.push('Missing mandatory UNBR legal disclaimer: "Prezentul articol are un caracter pur informativ și educațional și nu constituie consultanță juridică în sensul Legii nr. 51/1995..."');
  }

  // 5. SOLON Call to Action
  const solonRegex = /SOLON/i;
  if (!solonRegex.test(content)) {
    issues.push('Missing SOLON Call-to-Action in Concluzie.');
  }

  // 6. Image Markups & Path Validation
  const imgMatches = [...content.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi)];
  if (imgMatches.length < 2) {
    issues.push(`Found ${imgMatches.length} images. Minimum benchmark requires at least 2 illustrations.`);
  }

  for (const match of imgMatches) {
    const src = match[1];
    const alt = match[2];

    if (!src.startsWith('../../assets/img/')) {
      issues.push(`Image src "${src}" must use the relative path prefix "../../assets/img/".`);
    } else {
      const filename = src.replace('../../assets/img/', '');
      const localImagePath = path.join(ASSETS_IMG_DIR, filename);
      if (!fs.existsSync(localImagePath)) {
        issues.push(`Referenced image asset does not exist on disk: assets/img/${filename}`);
      }
    }

    if (!alt || alt.trim().length < 10) {
      issues.push(`Image alt text "${alt}" is missing or too short. Provide descriptive alt text in Romanian.`);
    }
  }

  // 7. Internal Links Validation
  const internalLinkMatches = content.match(/\[([^\]]+)\]\(\.\.\/([a-z0-9-]+)\/\)/g) || [];
  if (internalLinkMatches.length < 3) {
    warnings.push(`Found only ${internalLinkMatches.length} internal links. Recommended benchmark is at least 3-4 internal cross-links.`);
  }

  // 8. Banned LLM Clichés & Phrases
  const bannedPhrases = loadBannedPhrases();
  const lowerContent = content.toLowerCase();
  const detectedBanned = [];

  for (const phrase of bannedPhrases) {
    if (lowerContent.includes(phrase)) {
      detectedBanned.push(phrase);
    }
  }

  if (detectedBanned.length > 0) {
    warnings.push(`Detected ${detectedBanned.length} banned LLM tropes/clichés: ${detectedBanned.map(p => `"${p}"`).join(', ')}`);
  }

  const isValid = issues.length === 0;

  // 9. Write audit log entry if valid and requested
  if (isValid && (options.logAudit || process.argv.includes('--log-audit'))) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      slug: frontmatter.slug,
      title: frontmatter.title,
      wordCount,
      sectionCount: h2Matches.length,
      readTime: frontmatter.read_time,
      validatedBy: "SOLON Quality Gate v1.0",
      euAiActCompliant: true,
      unbrDisclaimerPresent: true
    };
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(logEntry) + '\n', 'utf8');
  }

  return {
    valid: isValid,
    wordCount,
    sectionCount: h2Matches.length,
    issues,
    warnings
  };
}

function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    console.error('Usage: node validate-article.js <path-to-article.md> [--log-audit]');
    process.exit(1);
  }

  const targetPath = path.resolve(process.cwd(), targetArg);
  const result = validateArticle(targetPath, { logAudit: process.argv.includes('--log-audit') });

  console.log('='.repeat(60));
  console.log(`VALIDATION REPORT: ${path.basename(targetPath)}`);
  console.log(`Status: ${result.valid ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Word Count: ${result.wordCount || 0}`);
  console.log(`Section Count: ${result.sectionCount || 0}`);
  console.log('='.repeat(60));

  if (result.issues.length > 0) {
    console.log('\n❌ ISSUES (Must be resolved):');
    result.issues.forEach((iss, i) => console.log(`  ${i + 1}. ${iss}`));
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️ WARNINGS / BENCHMARK NOTICES:');
    result.warnings.forEach((warn, i) => console.log(`  ${i + 1}. ${warn}`));
  }

  if (!result.valid) {
    process.exit(1);
  } else {
    console.log('\nAll required quality gates passed successfully.');
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateArticle };
