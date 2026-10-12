"use strict";

const LEGAL_PROTECTED_TOKEN = "__HUMANIZE_LEGAL_";

const PROTECTED_LEGAL_TERMS = [
  "risc ridicat",
  "risc inacceptabil",
  "modificare substanțială",
  "substanțiale",
  "substanțială",
  "substanțiali",
  "substanțial",
  "implementatorului",
  "implementatorilor",
  "implementatori",
  "implementator",
  "furnizorului",
  "furnizorilor",
  "furnizorul",
  "furnizori",
  "furnizor",
  "deployer",
  "provider",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boundedPhrase(phrase) {
  const escaped = escapeRegExp(phrase).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
}

const PROTECTED_LEGAL_TERM_PATTERNS = [...PROTECTED_LEGAL_TERMS]
  .sort((a, b) => b.length - a.length)
  .map((term) => boundedPhrase(term));

const REGULAMENT_UE_CITATION_PATTERN = /Regulamentul\s*\(UE\)\s*\d{4}\/\d+/giu;

/**
 * Period after art./alin./lit./pct. etc. is not a sentence boundary (Romanian legal citations).
 * @param {string} segment
 * @returns {boolean}
 */
function endsWithLegalCitationAbbreviation(segment) {
  const trimmed = segment.trimEnd();
  return (
    /\b(art|alin|lit|pct|cap|par|nr|Anexa)\.\s*$/iu.test(trimmed) ||
    /\bRegulamentul\s*\(UE\)\s*\d{4}\/\d+\s*$/iu.test(trimmed)
  );
}

/**
 * Merge sentence fragments split on legal abbreviations (e.g. art., alin., pct.).
 * @param {string[]} raw
 * @returns {string[]}
 */
function mergeLegalSentenceFragments(raw) {
  const merged = [];
  for (let index = 0; index < raw.length; index += 1) {
    let segment = raw[index];
    while (index < raw.length - 1 && endsWithLegalCitationAbbreviation(segment)) {
      index += 1;
      segment += raw[index];
    }
    merged.push(segment);
  }
  return merged;
}

/**
 * True when a paragraph contains Romanian/EU legal citation markers.
 * @param {string} text
 * @returns {boolean}
 */
function containsLegalCitations(text) {
  return (
    /\bart\.\s*\d/u.test(text) ||
    /\balin\.\s*\(/u.test(text) ||
    /\blit\.\s*[a-zăîâșț]/iu.test(text) ||
    /\bpct\.\s*\d/u.test(text) ||
    /Regulamentul\s*\(UE\)\s*\d{4}\/\d+/iu.test(text)
  );
}

/**
 * Tokenize legal citations and protected terms so rewrite rules and paragraph splitting skip them.
 * @param {string} text
 * @returns {{ text: string, restore: (value: string) => string }}
 */
function protectLegalContent(text) {
  const protectedChunks = [];
  /** @param {string} match */
  const protect = (match) => {
    const token = `${LEGAL_PROTECTED_TOKEN}${protectedChunks.length}__`;
    protectedChunks.push(match);
    return token;
  };

  let working = text.replace(REGULAMENT_UE_CITATION_PATTERN, protect);

  for (const pattern of PROTECTED_LEGAL_TERM_PATTERNS) {
    working = working.replace(pattern, protect);
  }

  return {
    text: working,
    restore: (value) =>
      protectedChunks.reduce(
        (restored, chunk, index) => restored.replaceAll(`${LEGAL_PROTECTED_TOKEN}${index}__`, chunk),
        value
      ),
  };
}

module.exports = {
  LEGAL_PROTECTED_TOKEN,
  containsLegalCitations,
  mergeLegalSentenceFragments,
  protectLegalContent,
};
