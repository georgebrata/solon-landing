"use strict";

/** Guards blog humanize from rewriting EU/legal citations and defined terms. */

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

/** @param {string} value */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {string} phrase */
const boundedPhrase = (phrase) => {
  const escaped = escapeRegExp(phrase).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
};

const PROTECTED_LEGAL_TERM_PATTERNS = [...PROTECTED_LEGAL_TERMS]
  .sort((a, b) => b.length - a.length)
  .map((term) => boundedPhrase(term));

const REGULAMENT_UE_CITATION_PATTERN = /Regulamentul\s*\(UE\)\s*\d{4}\/\d+/giu;

/**
 * @param {string} segment
 * @returns {boolean}
 */
const endsWithLegalCitationAbbreviation = (segment) => {
  const trimmed = segment.trimEnd();
  return (
    /\b(art|alin|lit|pct|cap|par|nr|Anexa)\.\s*$/iu.test(trimmed) ||
    /\bRegulamentul\s*\(UE\)\s*\d{4}\/\d+\s*$/iu.test(trimmed)
  );
};

/**
 * @param {string[]} raw
 * @returns {string[]}
 */
const mergeLegalSentenceFragments = (raw) => {
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
};

/**
 * @param {string} text
 * @returns {boolean}
 */
const containsLegalCitations = (text) =>
  /\bart\.\s*\d/u.test(text) ||
  /\balin\.\s*\(/u.test(text) ||
  /\blit\.\s*[a-zăîâșț]/iu.test(text) ||
  /\bpct\.\s*\d/u.test(text) ||
  /Regulamentul\s*\(UE\)\s*\d{4}\/\d+/iu.test(text);

/**
 * @param {string} text
 * @returns {{ text: string, restore: (value: string) => string }}
 */
const protectLegalContent = (text) => {
  const protectedChunks = [];
  /** @param {string} match */
  const protectChunk = (match) => {
    const token = `${LEGAL_PROTECTED_TOKEN}${protectedChunks.length}__`;
    protectedChunks.push(match);
    return token;
  };

  const withRegulament = text.replace(REGULAMENT_UE_CITATION_PATTERN, protectChunk);
  const working = PROTECTED_LEGAL_TERM_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, protectChunk),
    withRegulament
  );

  return {
    text: working,
    restore: (value) =>
      protectedChunks.reduce(
        (restored, chunk, index) => restored.replaceAll(`${LEGAL_PROTECTED_TOKEN}${index}__`, chunk),
        value
      ),
  };
};

module.exports = {
  LEGAL_PROTECTED_TOKEN,
  containsLegalCitations,
  mergeLegalSentenceFragments,
  protectLegalContent,
};
