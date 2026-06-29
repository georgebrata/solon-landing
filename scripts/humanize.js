const fs = require("fs");
const path = require("path");

const DEFAULT_POSTS_DIR = path.join(__dirname, "../blog/posts");
const PROTECTED_TOKEN = "__HUMANIZE_PROTECTED_";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetFile = getArgValue("--file");
const postsDir = path.resolve(getArgValue("--posts-dir") || DEFAULT_POSTS_DIR);

const rules = [
  {
    name: "Normalizeaza liniile de pauza",
    pattern: /[ \t]*[—–][ \t]*/g,
    replacement: " - ",
  },
  {
    name: "Repara ghilimelele romanesti incomplete",
    pattern: /„([^”"\n]{1,140})"/g,
    replacement: "„$1”",
  },
  {
    name: "Inlocuieste exprimari de tip concluzie",
    pattern: boundedPhrase("în concluzie"),
    replacement: "pe scurt",
    preserveCase: true,
  },
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
    name: "Elimina adverbul de umplutura",
    pattern: boundedPhrase("în mod eficient"),
    replacement: "eficient",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura",
    pattern: boundedPhrase("în mod automat"),
    replacement: "automat",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura",
    pattern: boundedPhrase("în mod implicit"),
    replacement: "implicit",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura",
    pattern: boundedPhrase("în mod clar"),
    replacement: "clar",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura",
    pattern: boundedPhrase("în mod constant"),
    replacement: "constant",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura",
    pattern: boundedPhrase("în mod direct"),
    replacement: "direct",
    preserveCase: true,
  },
  {
    name: "Elimina adverbul de umplutura",
    pattern: boundedPhrase("în mod natural"),
    replacement: "firesc",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «utiliza»",
    pattern: boundedPhrase("utilizezi"),
    replacement: "folosești",
    preserveCase: true,
  },
  {
    name: "Inlocuieste jargonul «utiliza»",
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
    name: "Inlocuieste jargonul «facilita»",
    pattern: boundedPhrase("facilita"),
    replacement: "ușura",
    preserveCase: true,
  },
  {
    name: "Inlocuieste substantivul impersonal",
    pattern: boundedPhrase("facilitarea"),
    replacement: "ușurarea",
    preserveCase: true,
  },
  {
    name: "Tempereaza superlativele",
    pattern: boundedPhrase("extrem de"),
    replacement: "foarte",
    preserveCase: true,
  },
  {
    name: "Tempereaza vagul analitic",
    pattern: boundedPhrase("în mod semnificativ"),
    replacement: "vizibil",
    preserveCase: true,
  },
  {
    name: "Tempereaza vagul analitic",
    pattern: boundedPhrase("semnificativă"),
    replacement: "vizibilă",
    preserveCase: true,
  },
  {
    name: "Tempereaza vagul analitic",
    pattern: boundedPhrase("semnificativ"),
    replacement: "vizibil",
    preserveCase: true,
  },
  {
    name: "Scurteaza CTA-ul",
    pattern: boundedPhrase("contactează-ne astăzi"),
    replacement: "contactează-ne",
    preserveCase: true,
  },
  {
    name: "Scurteaza CTA-ul",
    pattern: boundedPhrase("pentru a descoperi cum"),
    replacement: "ca să vezi cum",
    preserveCase: true,
  },
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

  const paragraphResult = splitLongParagraphs(updatedBody);
  updatedBody = paragraphResult.text;
  if (paragraphResult.count > 0) {
    counts.set("Imparte paragrafele prea lungi", paragraphResult.count);
  }

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

function splitLongParagraphs(text) {
  let count = 0;
  const blocks = text.split(/(\n{2,})/);

  const updatedBlocks = blocks.map((block) => {
    if (/^\n+$/.test(block) || !shouldSplitParagraph(block)) {
      return block;
    }

    const sentences = block.match(/[^.!?]+[.!?]+(?:["”»])?|[^.!?]+$/g);
    if (!sentences || sentences.length < 4) return block;

    const words = block.trim().split(/\s+/).length;
    if (words < 90) return block;

    let runningWords = 0;
    let splitIndex = -1;

    for (let index = 0; index < sentences.length - 1; index += 1) {
      runningWords += sentences[index].trim().split(/\s+/).length;
      if (runningWords >= words / 2) {
        splitIndex = index + 1;
        break;
      }
    }

    if (splitIndex <= 0 || splitIndex >= sentences.length) return block;

    count += 1;

    return `${sentences.slice(0, splitIndex).join("").trim()}\n\n${sentences
      .slice(splitIndex)
      .join("")
      .trim()}`;
  });

  return { text: updatedBlocks.join(""), count };
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
