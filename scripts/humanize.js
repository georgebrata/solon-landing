/**
 * humanize.js — post-procesare statică pentru articole de blog SOLON
 *
 * Aplică reguli de rescriere bazate pe literatura 2024–2026 despre detectarea
 * textului generat de LLM și despre ce îl face să sune „asistent util” în loc
 * de autor uman. Abordarea urmează cele nouă pârghii documentate în cercetare:
 *
 * 1. Perplexity injection (vocabular) — înlocuiește cuvinte previzibile din
 *    lexiconul RLHF (Gehrmann et al. 2019; Mitchell et al. 2023 DetectGPT).
 * 2. Burstiness (propoziții) — sparge paragrafe metronomice; variația lungimii
 *    propozițiilor distinge textul uman de cel LLM (Tarım & Onan 2025, arXiv
 *    2507.10475; diffusion LLMs imită burstiness, dar paragrafele uniforme
 *    rămân un semnal).
 * 3. Hedge surgery — elimină formulări de atenuare („este important de…",
 *    „merită menționat") când certitudinea e justificată (Sadasivan et al.
 *    2023 paraphrase attacks; Pangram 2025 analysis).
 * 4. Structural flattening — împarte paragrafe prea lungi, evită restate-uri.
 * 5. Specificity — nu automatizabil static; rămâne responsabilitatea autorului.
 * 6. Voice & register — preferă „tu", contracții, verb direct (HyPerAlign 2025).
 * 7. Discourse coherence — taie tranziții de tip eseu („de asemenea", „totodată",
 *    „în consecință"); AI le supra-utilizează (HC3 / RoBERTa detectors).
 * 8. Punctuation normalization — liniuțe em/en → cratimă; punct și virgulă
 *    în loc de punct și virgulă stil academic; două liniuțe em = semnal puternic
 *    (stilometrie LLM, Tandfonline 2025).
 * 9. RLHF / instruction-tuning strip — detectoarele actuale (GPTZero 2025,
 *    Pangram 4, arXiv 2605.19516 „Base Models Look Human") reacționează la
 *    politețe, enumerări rigide și formulări de concluzie, nu doar la statistici.
 *
 * Limite: rescrierea statică nu elimină amprenta RLHF din ponderile modelului;
 * pentru mize ridicate, literatura recomandă parafrazare iterativă (PADBen
 * arXiv 2511.00416) sau best-of-N cu detector (arXiv 2506.07001).
 *
 * Referințe: Hans et al. Binoculars ICML 2024; Gu et al. MASH ACL 2026 Findings;
 * Liu et al. 2024 PMC10760418; Yadagiri et al. 2024 HC3; NEULIF arXiv 2511.21744.
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_POSTS_DIR = path.join(__dirname, "../blog/posts");
const PROTECTED_TOKEN = "__HUMANIZE_PROTECTED_";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetFile = getArgValue("--file");
const postsDir = path.resolve(getArgValue("--posts-dir") || DEFAULT_POSTS_DIR);

const rules = [
  // --- Lever 8: punctuation normalization ---
  {
    name: "Normalizeaza liniile de pauza",
    pattern: /[ \t]*[—–][ \t]*/g,
    replacement: " - ",
  },
  {
    name: "Inlocuieste punct si virgula stil academic",
    pattern: /;(?=\s*\p{Ll})/gu,
    replacement: ".",
  },
  {
    name: "Repara ghilimelele romanesti incomplete",
    pattern: /„([^”"\n]{1,140})"/g,
    replacement: "„$1”",
  },

  // --- Lever 9: RLHF / instruction-tuning voice (Romanian) ---
  {
    name: "Elimina formula «este clar ca»",
    pattern: boundedPhrase("este clar că"),
    replacement: "",
  },
  {
    name: "Elimina formula «este evident ca»",
    pattern: boundedPhrase("este evident că"),
    replacement: "",
  },
  {
    name: "Elimina formula «nu trebuie neglijat»",
    pattern: boundedPhrase("nu trebuie neglijat faptul că"),
    replacement: "",
  },
  {
    name: "Elimina formula «nu trebuie uitat»",
    pattern: boundedPhrase("nu trebuie uitat faptul că"),
    replacement: "",
  },
  {
    name: "Elimina formula «general vorbind»",
    pattern: boundedPhrase("general vorbind"),
    replacement: "",
  },
  {
    name: "Elimina formula «trebuie subliniat ca»",
    pattern: boundedPhrase("trebuie subliniat că"),
    replacement: "",
  },
  {
    name: "Elimina formula «merita subliniat ca»",
    pattern: boundedPhrase("merită subliniat că"),
    replacement: "",
  },
  {
    name: "Elimina formula «este demn de mentionat»",
    pattern: boundedPhrase("este demn de menționat că"),
    replacement: "merită spus că",
    preserveCase: true,
  },
  {
    name: "Elimina formula «este demn de remarcat»",
    pattern: boundedPhrase("este demn de remarcat că"),
    replacement: "merită spus că",
    preserveCase: true,
  },
  {
    name: "Transforma «acest lucru subliniaza»",
    pattern: boundedPhrase("acest lucru subliniază"),
    replacement: "asta arată",
    preserveCase: true,
  },
  {
    name: "Transforma «acest aspect evidentiaza»",
    pattern: boundedPhrase("acest aspect evidențiază"),
    replacement: "asta arată",
    preserveCase: true,
  },
  {
    name: "Transforma «acesta evidentiaza»",
    pattern: boundedPhrase("acesta evidențiază"),
    replacement: "asta arată",
    preserveCase: true,
  },
  {
    name: "Inlocuieste exprimari de tip concluzie",
    pattern: boundedPhrase("în concluzie"),
    replacement: "pe scurt",
    preserveCase: true,
  },
  {
    name: "Inlocuieste «in final» rigid",
    pattern: boundedPhrase("în final,"),
    replacement: "pe scurt,",
    preserveCase: true,
  },
  {
    name: "Inlocuieste «la final» rigid",
    pattern: boundedPhrase("la final,"),
    replacement: "pe scurt,",
    preserveCase: true,
  },

  // --- Lever 3: hedge surgery ---
  {
    name: "Evita formula «este important de mentionat»",
    pattern: boundedPhrase("este important de menționat că"),
    replacement: "merită spus că",
    preserveCase: true,
  },
  {
    name: "Evita formula «este important de retinut»",
    pattern: boundedPhrase("este important de reținut că"),
    replacement: "merită reținut că",
    preserveCase: true,
  },
  {
    name: "Evita formula «merita mentionat ca»",
    pattern: boundedPhrase("merită menționat că"),
    replacement: "merită spus că",
    preserveCase: true,
  },
  {
    name: "Evita formula «este util de retinut»",
    pattern: boundedPhrase("este util de reținut că"),
    replacement: "de reținut:",
    preserveCase: true,
  },
  {
    name: "Evita formula «este esential de retinut»",
    pattern: boundedPhrase("este esențial de reținut că"),
    replacement: "merită reținut că",
    preserveCase: true,
  },
  {
    name: "Scurteaza «este important sa»",
    pattern: boundedPhrase("este important să"),
    replacement: "e important să",
    preserveCase: true,
  },
  {
    name: "Scurteaza «este esential sa»",
    pattern: boundedPhrase("este esențial să"),
    replacement: "e esențial să",
    preserveCase: true,
  },
  {
    name: "Scurteaza «este recomandat sa»",
    pattern: boundedPhrase("este recomandat să"),
    replacement: "merită să",
    preserveCase: true,
  },
  {
    name: "Scurteaza «este necesar sa»",
    pattern: boundedPhrase("este necesar să"),
    replacement: "trebuie să",
    preserveCase: true,
  },
  {
    name: "Scurteaza «este crucial sa»",
    pattern: boundedPhrase("este crucial să"),
    replacement: "contă să",
    preserveCase: true,
  },
  {
    name: "Tempereaza «in multe cazuri»",
    pattern: boundedPhrase("în multe cazuri"),
    replacement: "des",
    preserveCase: true,
  },
  {
    name: "Tempereaza «de regula generala»",
    pattern: boundedPhrase("de regulă generală"),
    replacement: "de obicei",
    preserveCase: true,
  },

  // --- Lever 7: discourse / AI transitions ---
  {
    name: "Scurteaza tranzitii rigide",
    pattern: boundedPhrase("cu toate acestea"),
    replacement: "totuși",
    preserveCase: true,
  },
  {
    name: "Scurteaza tranzitii cauzale",
    pattern: boundedPhrase("prin urmare"),
    replacement: "așa că",
    preserveCase: true,
  },
  {
    name: "Scurteaza tranzitii cauzale «in consecinta»",
    pattern: boundedPhrase("în consecință"),
    replacement: "așa că",
    preserveCase: true,
  },
  {
    name: "Scurteaza tranzitii cauzale «de aceea»",
    pattern: boundedPhrase("de aceea,"),
    replacement: "așa că,",
    preserveCase: true,
  },
  {
    name: "Umanizeaza contextul",
    pattern: boundedPhrase("în acest context"),
    replacement: "în practică",
    preserveCase: true,
  },
  {
    name: "Umanizeaza schimbarea de perspectiva",
    pattern: boundedPhrase("pe de altă parte"),
    replacement: "în schimb",
    preserveCase: true,
  },
  {
    name: "Scurteaza «de asemenea»",
    pattern: boundedPhrase("de asemenea,"),
    replacement: "și",
    preserveCase: true,
  },
  {
    name: "Scurteaza «totodata»",
    pattern: boundedPhrase("totodată,"),
    replacement: "și",
    preserveCase: true,
  },
  {
    name: "Scurteaza «pe langa aceasta»",
    pattern: boundedPhrase("pe lângă aceasta"),
    replacement: "pe lângă asta",
    preserveCase: true,
  },
  {
    name: "Scurteaza «in plus» la inceput de propozitie",
    pattern: boundedPhrase("în plus,"),
    replacement: "apoi,",
    preserveCase: true,
  },
  {
    name: "Scurteaza «mai mult decat atat»",
    pattern: boundedPhrase("mai mult decât atât,"),
    replacement: "apoi,",
    preserveCase: true,
  },
  {
    name: "Scurteaza «cu alte cuvinte»",
    pattern: boundedPhrase("cu alte cuvinte,"),
    replacement: "adică,",
    preserveCase: true,
  },
  {
    name: "Scurteaza «in acest sens»",
    pattern: boundedPhrase("în acest sens,"),
    replacement: "deci,",
    preserveCase: true,
  },
  {
    name: "Scurteaza «in ceea ce priveste»",
    pattern: boundedPhrase("în ceea ce privește"),
    replacement: "pentru",
    preserveCase: true,
  },
  {
    name: "Scurteaza «in mod particular»",
    pattern: boundedPhrase("în mod particular"),
    replacement: "mai ales",
    preserveCase: true,
  },

  // --- Lever 1: predictable vocabulary (Romanian AI lexicon) ---
  {
    name: "Simplifica ipotezele lungi",
    pattern: boundedPhrase("în cazul în care"),
    replacement: "dacă",
    preserveCase: true,
  },
  {
    name: "Simplifica explicatiile cauzale",
    pattern: boundedPhrase("datorită faptului că"),
    replacement: "pentru că",
    preserveCase: true,
  },
  {
    name: "Simplifica formulele justificative",
    pattern: boundedPhrase("având în vedere faptul că"),
    replacement: "pentru că",
    preserveCase: true,
  },
  {
    name: "Transforma infinitivele rigide",
    pattern: boundedPhrase("cu scopul de a"),
    replacement: "ca să",
    preserveCase: true,
  },
  {
    name: "Transforma «in vederea»",
    pattern: boundedPhrase("în vederea"),
    replacement: "pentru",
    preserveCase: true,
  },
  {
    name: "Transforma «in scopul»",
    pattern: boundedPhrase("în scopul"),
    replacement: "pentru",
    preserveCase: true,
  },
  {
    name: "Transforma «prin intermediul»",
    pattern: boundedPhrase("prin intermediul"),
    replacement: "prin",
    preserveCase: true,
  },
  {
    name: "Transforma «astfel incat»",
    pattern: boundedPhrase("astfel încât"),
    replacement: "ca să",
    preserveCase: true,
  },
  {
    name: "Reduce enumerarile impersonale",
    pattern: boundedPhrase("o serie de"),
    replacement: "mai multe",
    preserveCase: true,
  },
  {
    name: "Reduce formularile cantitative impersonale",
    pattern: boundedPhrase("un număr de"),
    replacement: "mai multe",
    preserveCase: true,
  },
  {
    name: "Reduce «o serie intreaga de»",
    pattern: boundedPhrase("o serie întreagă de"),
    replacement: "mai multe",
    preserveCase: true,
  },
  {
    name: "Simplifica «capacitatea de a»",
    pattern: boundedPhrase("capacitatea de a"),
    replacement: "poate",
    preserveCase: true,
  },
  {
    name: "Simplifica «ofera posibilitatea de a»",
    pattern: boundedPhrase("oferă posibilitatea de a"),
    replacement: "îți permite să",
    preserveCase: true,
  },
  {
    name: "Simplifica «contribuie la»",
    pattern: boundedPhrase("contribuie la"),
    replacement: "ajută la",
    preserveCase: true,
  },
  {
    name: "Simplifica «reprezinta o oportunitate»",
    pattern: boundedPhrase("reprezintă o oportunitate"),
    replacement: "e o ocazie",
    preserveCase: true,
  },
  {
    name: "Tempereaza «joaca un rol crucial»",
    pattern: boundedPhrase("joacă un rol crucial"),
    replacement: "contă mult",
    preserveCase: true,
  },
  {
    name: "Tempereaza «joaca un rol esential»",
    pattern: boundedPhrase("joacă un rol esențial"),
    replacement: "e esențial",
    preserveCase: true,
  },
  {
    name: "Tempereaza «joaca un rol important»",
    pattern: boundedPhrase("joacă un rol important"),
    replacement: "contă",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura",
    pattern: boundedPhrase("în mod eficient"),
    replacement: "eficient",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura «in mod automat»",
    pattern: boundedPhrase("în mod automat"),
    replacement: "automat",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura «in mod implicit»",
    pattern: boundedPhrase("în mod implicit"),
    replacement: "implicit",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura «in mod clar»",
    pattern: boundedPhrase("în mod clar"),
    replacement: "clar",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura «in mod constant»",
    pattern: boundedPhrase("în mod constant"),
    replacement: "constant",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura «in mod direct»",
    pattern: boundedPhrase("în mod direct"),
    replacement: "direct",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura «in mod natural»",
    pattern: boundedPhrase("în mod natural"),
    replacement: "firesc",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura «in mod semnificativ»",
    pattern: boundedPhrase("în mod semnificativ"),
    replacement: "vizibil",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «utiliza»",
    pattern: boundedPhrase("utilizezi"),
    replacement: "folosești",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «utilizeaza»",
    pattern: boundedPhrase("utilizează"),
    replacement: "folosește",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «utiliza»",
    pattern: boundedPhrase("utiliza"),
    replacement: "folosi",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «utilizat»",
    pattern: boundedPhrase("utilizat"),
    replacement: "folosit",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «utilizata»",
    pattern: boundedPhrase("utilizată"),
    replacement: "folosită",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «utilizate»",
    pattern: boundedPhrase("utilizate"),
    replacement: "folosite",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «facilita»",
    pattern: boundedPhrase("facilitează"),
    replacement: "ușurează",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «facilita» infinitiv",
    pattern: boundedPhrase("facilita"),
    replacement: "ușura",
    preserveCase: true,
  },
  {
    name: "Inlocuieste substantivul impersonal «facilitarea»",
    pattern: boundedPhrase("facilitarea"),
    replacement: "ușurarea",
    preserveCase: true,
  },
  {
    name: "Inlocuieste lexiconul «robust»",
    pattern: boundedPhrase("robust"),
    replacement: "solid",
    preserveCase: true,
  },
  {
    name: "Inlocuieste lexiconul «robusta»",
    pattern: boundedPhrase("robustă"),
    replacement: "solidă",
    preserveCase: true,
  },
  {
    name: "Inlocuieste lexiconul «comprehensiv»",
    pattern: boundedPhrase("comprehensiv"),
    replacement: "complet",
    preserveCase: true,
  },
  {
    name: "Inlocuieste lexiconul «comprehensiva»",
    pattern: boundedPhrase("comprehensivă"),
    replacement: "completă",
    preserveCase: true,
  },
  {
    name: "Tempereaza superlativele",
    pattern: boundedPhrase("extrem de"),
    replacement: "foarte",
    preserveCase: true,
  },
  {
    name: "Tempereaza vagul analitic «semnificativ»",
    pattern: boundedPhrase("semnificativă"),
    replacement: "vizibilă",
    preserveCase: true,
  },
  {
    name: "Tempereaza vagul analitic «semnificativ» masc",
    pattern: boundedPhrase("semnificativ"),
    replacement: "vizibil",
    preserveCase: true,
  },
  {
    name: "Tempereaza «substantial»",
    pattern: boundedPhrase("substanțial"),
    replacement: "serios",
    preserveCase: true,
  },
  {
    name: "Tempereaza «considerabil»",
    pattern: boundedPhrase("considerabil"),
    replacement: "vizibil",
    preserveCase: true,
  },
  {
    name: "Tempereaza «crucial»",
    pattern: boundedPhrase("crucial"),
    replacement: "decisiv",
    preserveCase: true,
  },
  {
    name: "Tempereaza «cruciala»",
    pattern: boundedPhrase("crucială"),
    replacement: "decisivă",
    preserveCase: true,
  },
  {
    name: "Scurteaza CTA-ul",
    pattern: boundedPhrase("contactează-ne astăzi"),
    replacement: "contactează-ne",
    preserveCase: true,
  },
  {
    name: "Scurteaza CTA-ul «pentru a descoperi»",
    pattern: boundedPhrase("pentru a descoperi cum"),
    replacement: "ca să vezi cum",
    preserveCase: true,
  },

  // --- Lever 8: typography cleanup ---
  {
    name: "Curata spatiile inainte de punctuatie",
    pattern: /[ \t]+([,.;:!?])/g,
    replacement: "$1",
  },
  {
    name: "Normalizeaza spatiile multiple",
    pattern: /[ \t]{2,}/g,
    replacement: " ",
  },
  {
    name: "Curata spatiile din jurul cratimei de pauza",
    pattern: /[ \t]+-[ \t]+/g,
    replacement: " - ",
  },
  {
    name: "Curata spatiu dublu dupa eliminare fraza",
    pattern: /[ \t]{2,}/g,
    replacement: " ",
  },
];

const files = fs
  .readdirSync(postsDir)
  .filter((file) => file.endsWith(".md"))
  .filter((file) => !targetFile || file === targetFile);

if (targetFile && files.length === 0) {
  console.error(`Nu am gasit fisierul ${targetFile} in ${postsDir}.`);
  process.exitCode = 1;
} else {
  humanizeFiles(files);
}

function humanizeFiles(filesToProcess) {
  let changedFiles = 0;
  let totalChanges = 0;
  const totalsByRule = new Map();

  filesToProcess.forEach((file) => {
    const filePath = path.join(postsDir, file);
    const original = fs.readFileSync(filePath, "utf8");
    const { updated, counts } = humanizeMarkdown(original);
    const fileChanges = sumCounts(counts);

    if (fileChanges === 0) return;

    changedFiles += 1;
    totalChanges += fileChanges;

    counts.forEach((count, ruleName) => {
      totalsByRule.set(ruleName, (totalsByRule.get(ruleName) || 0) + count);
    });

    if (!dryRun) {
      fs.writeFileSync(filePath, updated, "utf8");
    }

    console.log(`${dryRun ? "dry-run" : "updated"} ${file}: ${fileChanges} change(s)`);
  });

  if (totalChanges === 0) {
    console.log("No humanizing changes found. Nothing to update.");
    return;
  }

  console.log(`\n${dryRun ? "Dry run complete" : "Done"}. ${totalChanges} change(s) across ${changedFiles}/${filesToProcess.length} file(s).`);
  printRuleSummary(totalsByRule);
}

function humanizeMarkdown(markdown) {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const protectedBody = protectMarkdown(body);
  const counts = new Map();

  let updatedBody = rules.reduce((text, rule) => {
    const result = applyRule(text, rule);
    if (result.count > 0) {
      counts.set(rule.name, (counts.get(rule.name) || 0) + result.count);
    }
    return result.text;
  }, protectedBody.text);

  const colonResult = normalizeMidClauseColons(updatedBody);
  updatedBody = colonResult.text;
  if (colonResult.count > 0) {
    counts.set("Transforma doua puncte mid-clauza (stil AI)", colonResult.count);
  }

  const burstinessResult = enforceBurstiness(updatedBody);
  updatedBody = burstinessResult.text;
  burstinessResult.counts.forEach((count, name) => {
    if (count > 0) counts.set(name, (counts.get(name) || 0) + count);
  });

  return {
    updated: frontmatter + protectedBody.restore(updatedBody),
    counts,
  };
}

function splitFrontmatter(markdown) {
  const match = markdown.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/);

  if (!match) {
    return { frontmatter: "", body: markdown };
  }

  return { frontmatter: match[1], body: match[2] };
}

function protectMarkdown(markdown) {
  const protectedChunks = [];
  const protect = (match) => {
    const token = `${PROTECTED_TOKEN}${protectedChunks.length}__`;
    protectedChunks.push(match);
    return token;
  };

  const text = markdown
    .replace(/^```[\s\S]*?^```.*$/gm, protect)
    .replace(/^~~~[\s\S]*?^~~~.*$/gm, protect)
    .replace(/(?:^|\n)(?:[ \t]*<[^>\n]+>.*(?:\r?\n|$))+/g, protect)
    .replace(/`[^`\n]+`/g, protect)
    .replace(/\]\([^)]+\)/g, protect)
    .replace(/https?:\/\/[^\s)]+/g, protect);

  return {
    text,
    restore: (value) =>
      protectedChunks.reduce(
        (restored, chunk, index) => restored.replaceAll(`${PROTECTED_TOKEN}${index}__`, chunk),
        value
      ),
  };
}

function applyRule(text, rule) {
  let count = 0;
  const updated = text.replace(rule.pattern, (...args) => {
    const match = args[0];
    const replacement =
      typeof rule.replacement === "function" ? rule.replacement(...args) : expandReplacement(rule.replacement, args);
    const updatedMatch = rule.preserveCase ? preserveFirstLetterCase(match, replacement) : replacement;

    if (updatedMatch !== match) {
      count += 1;
    }

    return updatedMatch;
  });

  return { text: updated, count };
}

/**
 * Lever 8: mid-clause colons after short AI-style labels (Problema:, Soluția:).
 * Colons remain when preceded by a complete sentence ending in punctuation logic.
 */
function normalizeMidClauseColons(text) {
  let count = 0;
  const labelPattern =
    /\b(Problema|Soluția|Răspunsul|Concluzia|Ideea|Rezultatul|Exemplu|Atenție|Important|Notă)\s*:\s+/gu;

  const updated = text.replace(labelPattern, (match, label) => {
    count += 1;
    return `${label}. `;
  });

  return { text: updated, count };
}

/**
 * Lever 2 + 4: burstiness and structural flattening.
 * Splits long paragraphs and metronomic blocks (low sentence-length variance).
 */
function enforceBurstiness(text) {
  const counts = new Map();
  let updated = text;

  const longParagraphResult = splitLongParagraphs(updated, {
    minWords: 70,
    minSentences: 3,
    ruleName: "Imparte paragrafele prea lungi",
  });
  updated = longParagraphResult.text;
  counts.set("Imparte paragrafele prea lungi", longParagraphResult.count);

  const metronomicResult = splitMetronomicParagraphs(updated);
  updated = metronomicResult.text;
  counts.set("Imparte paragrafe metronomice (burstiness)", metronomicResult.count);

  return { text: updated, counts };
}

function splitLongParagraphs(text, options = {}) {
  const minWords = options.minWords ?? 90;
  const minSentences = options.minSentences ?? 4;
  let count = 0;
  const blocks = text.split(/(\n{2,})/);

  const updatedBlocks = blocks.map((block) => {
    if (/^\n+$/.test(block) || !shouldSplitParagraph(block)) {
      return block;
    }

    const sentences = extractSentences(block);
    if (!sentences || sentences.length < minSentences) return block;

    const words = block.trim().split(/\s+/).length;
    if (words < minWords) return block;

    const splitIndex = findBalancedSplitIndex(sentences, words);
    if (splitIndex <= 0 || splitIndex >= sentences.length) return block;

    count += 1;

    return `${sentences.slice(0, splitIndex).join("").trim()}\n\n${sentences
      .slice(splitIndex)
      .join("")
      .trim()}`;
  });

  return { text: updatedBlocks.join(""), count };
}

function splitMetronomicParagraphs(text) {
  let count = 0;
  const blocks = text.split(/(\n{2,})/);

  const updatedBlocks = blocks.map((block) => {
    if (/^\n+$/.test(block) || !shouldSplitParagraph(block)) {
      return block;
    }

    const sentences = extractSentences(block);
    if (!sentences || sentences.length < 3) return block;

    const lengths = sentences.map((sentence) => sentence.trim().split(/\s+/).length);
    const avg = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
    const variance =
      lengths.reduce((sum, len) => sum + (len - avg) ** 2, 0) / lengths.length;
    const stdDev = Math.sqrt(variance);

    // Metronomic AI prose: similar-length sentences (stdDev < 4) averaging 12–28 words.
    if (stdDev >= 4 || avg < 12 || avg > 28) return block;

    const splitIndex = findBalancedSplitIndex(sentences, block.trim().split(/\s+/).length);
    if (splitIndex <= 0 || splitIndex >= sentences.length) return block;

    count += 1;

    return `${sentences.slice(0, splitIndex).join("").trim()}\n\n${sentences
      .slice(splitIndex)
      .join("")
      .trim()}`;
  });

  return { text: updatedBlocks.join(""), count };
}

function extractSentences(block) {
  return block.match(/[^.!?]+[.!?]+(?:["”»])?|[^.!?]+$/g);
}

function findBalancedSplitIndex(sentences, totalWords) {
  let runningWords = 0;

  for (let index = 0; index < sentences.length - 1; index += 1) {
    runningWords += sentences[index].trim().split(/\s+/).length;
    if (runningWords >= totalWords / 2) {
      return index + 1;
    }
  }

  return -1;
}

function shouldSplitParagraph(block) {
  const trimmed = block.trim();
  if (!trimmed) return false;
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/.test(trimmed)) return false;
  if (trimmed.includes(PROTECTED_TOKEN)) return false;
  return !/^\s{4,}/.test(block);
}

function boundedPhrase(phrase) {
  const escaped = escapeRegExp(phrase).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preserveFirstLetterCase(source, replacement) {
  const firstLetter = source.match(/\p{L}/u);
  if (!firstLetter) return replacement;

  const letter = firstLetter[0];
  if (letter === letter.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }

  return replacement;
}

function expandReplacement(replacement, args) {
  return replacement.replace(/\$(\d+)/g, (_, index) => args[Number(index)] || "");
}

function sumCounts(counts) {
  return Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
}

function printRuleSummary(totalsByRule) {
  const ordered = Array.from(totalsByRule.entries()).sort((a, b) => b[1] - a[1]);

  console.log("\nRule summary:");
  ordered.forEach(([ruleName, count]) => {
    console.log(`- ${ruleName}: ${count}`);
  });
}

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return "";
  return args[index + 1] || "";
}
