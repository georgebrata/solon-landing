#!/usr/bin/env node

/**
 * generate-topic-seed.js
 * Scans existing blog articles, generates a random creative temperature (0.70 - 0.95),
 * selects an unwritten topic about digitalization for Romanian lawyers,
 * verifies deduplication against existing corpus, and suggests contextually relevant assets and internal links.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const POSTS_DIR = path.resolve(__dirname, '../../../../blog/posts');
const ASSETS_IMG_DIR = path.resolve(__dirname, '../../../../assets/img');

function parseMarkdownFrontmatter(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n?/);
    if (!match) return null;
    return yaml.load(match[1]);
  } catch (err) {
    return null;
  }
}

// 1. Scan existing articles
const existingFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
const existingPosts = [];

for (const file of existingFiles) {
  const fm = parseMarkdownFrontmatter(path.join(POSTS_DIR, file));
  if (fm && fm.slug) {
    existingPosts.push({
      file,
      slug: String(fm.slug).trim(),
      title: String(fm.title || '').trim(),
      description: String(fm.description || '').trim(),
      categories: Array.isArray(fm.categories) ? fm.categories : [],
      tags: Array.isArray(fm.tags) ? fm.tags : []
    });
  }
}

const existingSlugs = new Set(existingPosts.map(p => p.slug));
const existingTitles = existingPosts.map(p => p.title.toLowerCase());

// 2. Sample Random Temperature between 0.70 and 0.95 (Phase 1 Ideation)
const randomTemp = Number((Math.random() * (0.95 - 0.70) + 0.70).toFixed(2));

let creativePosture;
if (randomTemp < 0.79) {
  creativePosture = {
    mode: "Pragmatic Masterclass & Implementation Guide",
    tone: "Hyper-practic, tehnic și axat pe configurare pas cu pas, securitate și eficiență operațională imediată.",
    focus: "Meniuri concrete, pași de configurare, tabele comparative, checklist-uri de bune practici și fluxuri aplicabile de mâine în cabinet."
  };
} else if (randomTemp < 0.88) {
  creativePosture = {
    mode: "Strategic Transformation & Practice Economics",
    tone: "Analitic, orientat spre ROI, economie de timp și valoare adăugată pentru clientela cabinetului.",
    focus: "Calculul orelor facturabile vs. administrative, riscul de conformitate, transformarea relației cu clienții și scalabilitatea practicii juridice."
  };
} else {
  creativePosture = {
    mode: "Forward-Looking LegalTech Innovation & Paradigm Shift",
    tone: "Vizionar, curajos, axat pe automatizări avansate, agenți AI și viitorul profesiei de avocat.",
    focus: "Fluxuri avansate cu asistență AI, OCR și extragere automată de date din dosare, interacțiuni digitale inovatoare și regândirea serviciilor juridice."
  };
}

// 3. Pool of high-value candidate topics for Romanian lawyers
const candidateTopics = [
  {
    title: "e-Factura pentru avocați: ghid complet de integrare",
    slug: "e-factura-pentru-avocati-ghid-integrare",
    description: "Ghid practic e-Factura pentru cabinete de avocatură: configurare SPV, certificat digital calificat, automatizarea facturării și conformitate ANAF.",
    categories: ["digitalizare", "management", "automatizări"],
    tags: ["e-factura", "avocați", "anaf", "facturare", "digitalizare", "management"],
    keywords: ["e-factura", "anaf", "spv", "facturare electronica", "certificat digital"]
  },
  {
    title: "Arhivarea electronică a dosarelor pentru avocați",
    slug: "arhivarea-electronica-a-dosarelor-pentru-avocati",
    description: "Cum organizezi arhiva digitală a cabinetului: norme UNBR, politici de retenție a documentelor, criptare și căutare indexată fără hârtii inutile.",
    categories: ["digitalizare", "securitate", "management"],
    tags: ["arhivare", "dosare", "avocați", "securitate", "unbr", "digitalizare"],
    keywords: ["arhivare electronica", "unbr", "pastrare dosare", "cloud juridic", "criptare"]
  },
  {
    title: "Client Intake automatizat pentru societăți de avocați",
    slug: "client-intake-automatizat-pentru-avocati",
    description: "Ghid de automatizare a preluării clienților noi: formulare inteligente, verificare de conflicte, colectare preliminară de acte și contractare.",
    categories: ["automatizări", "digitalizare", "management"],
    tags: ["client intake", "automatizări", "avocați", "formulare", "productivitate"],
    keywords: ["client intake", "onboarding clienti", "formulare inteligente", "conflict check"]
  },
  {
    title: "Portal securizat pentru clienți în practica juridică",
    slug: "portal-securizat-clienti-avocatura",
    description: "Cum implementezi un spațiu digital securizat pentru clienți: partajare de documente, statusul dosarelor în timp real și reducerea apelurilor repetate.",
    categories: ["digitalizare", "securitate", "productivitate"],
    tags: ["portal clienti", "avocați", "comunicare", "securitate", "transparenta"],
    keywords: ["portal clienti", "client portal", "dosar online", "colaborare securizata"]
  },
  {
    title: "Cum să folosești OCR și AI pentru scanarea dosarelor",
    slug: "cum-sa-folosesti-ocr-si-ai-pentru-dosare-avocat",
    description: "Transformarea volumelor de acte scanate în text căutabil: unelte OCR avansate, extragere automată de termene și sinteză inteligentă de probe.",
    categories: ["legaltech", "productivitate", "digitalizare"],
    tags: ["ocr", "ai", "avocați", "dosare scanate", "cercetare", "productivitate"],
    keywords: ["ocr", "scanare dosare", "recunoastere text", "sinteza documente", "ai juridic"]
  },
  {
    title: "Prevenirea atacurilor Ransomware în cabinete de avocat",
    slug: "prevenirea-ransomware-in-cabinete-de-avocatura",
    description: "Ghid de securitate defensivă: protecția fișierelor confidențiale, strategii de backup imuabil, igiena parolelor și prevenirea extorcării digitale.",
    categories: ["securitate", "digitalizare", "management"],
    tags: ["ransomware", "securitate", "avocați", "backup", "gdpr", "protectie date"],
    keywords: ["ransomware", "atac cibernetic", "backup securizat", "confidentialitate", "antivirus"]
  },
  {
    title: "WhatsApp Business pentru avocați: ghid și etică",
    slug: "whatsapp-business-pentru-avocati-ghid-si-etica",
    description: "Cum folosești WhatsApp Business respectând secretul profesional: mesaje automate de întâmpinare, etichete pe clienți și separarea vieții personale.",
    categories: ["digitalizare", "productivitate", "comunicare"],
    tags: ["whatsapp business", "avocați", "comunicare", "securitate", "productivitate"],
    keywords: ["whatsapp business", "comunicare clienti", "secret profesional", "mesaje automate"]
  },
  {
    title: "Time tracking și măsurarea rentabilității dosarelor",
    slug: "time-tracking-rentabilitate-dosare-avocati",
    description: "De la estimări oarbe la cifre exacte: cum monitorizezi timpul consumat pe fiecare dosar, identifici clienții nerentabili și optimizezi tarifele.",
    categories: ["management", "productivitate", "digitalizare"],
    tags: ["time tracking", "rentabilitate", "avocați", "management cabinet", "onorarii"],
    keywords: ["time tracking", "pontaj avocat", "calcul onorariu", "rentabilitate dosar", "eficienta"]
  },
  {
    title: "Semnătura electronică calificată conform eIDAS pentru avocați",
    slug: "semnatura-electronica-calificata-eidas-avocati",
    description: "Tot ce trebuie să știe un avocat despre semnătura digitală calificată: valoare probatorie, depunerea actelor în instanță și fluxuri contractuale.",
    categories: ["digitalizare", "legaltech", "securitate"],
    tags: ["semnătură electronică", "eidas", "avocați", "contracte", "securitate"],
    keywords: ["semnatura electronica", "eidas", "certificat calificat", "semnare contracte", "instanta"]
  },
  {
    title: "Implementarea unui CRM juridic pentru cabinete de avocați",
    slug: "implementare-crm-juridic-pentru-avocati",
    description: "Cum alegi și configurezi un CRM adaptat practicii juridice: gestiunea lead-urilor, istoricul interacțiunilor cu clienții și fidelizarea portofoliului.",
    categories: ["digitalizare", "management", "marketing juridic"],
    tags: ["crm", "management cabinet", "avocați", "clienți", "marketing juridic"],
    keywords: ["crm juridic", "gestiune clienti", "vanzari servicii juridice", "pipeline dosare"]
  }
];

// 4. Filter out any topic whose slug or similar title already exists
const availableTopics = candidateTopics.filter(t => {
  if (existingSlugs.has(t.slug)) return false;
  const isTitleClose = existingTitles.some(et => {
    // Check keyword overlap
    const titleWords = t.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const matches = titleWords.filter(w => et.includes(w));
    return matches.length >= 3;
  });
  return !isTitleClose;
});

// Pick candidate topic (using pseudo-random choice from available)
const selectedTopic = availableTopics.length > 0
  ? availableTopics[Math.floor(Math.random() * availableTopics.length)]
  : {
      title: "Ghid de securitate a dispozitivelor mobile pentru avocați",
      slug: "securitatea-dispozitivelor-mobile-pentru-avocati",
      description: "Protecția datelor clienților pe smartphone și tabletă: MDM, criptare la nivel de fișier, Wi-Fi public securizat și backup automat.",
      categories: ["securitate", "digitalizare", "productivitate"],
      tags: ["smartphone", "securitate mobilă", "avocați", "criptare", "gdpr"],
      keywords: ["securitate mobil", "mdm", "protectie smartphone", "avocat la distanta"]
    };

// 5. Select Undraw Images based on topic relevance
const imageUsageMap = {
  "undraw_contract-signed_vutk.png": "Semnare contracte, acorduri juridice, conformitate eIDAS",
  "undraw_fingerprint-login_19qv.png": "Autentificare securizată, biometrie, 2FA, protecție acces",
  "undraw_helpful-sign_qvgg.png": "Ghidaj, bune practici, orientare strategică în cabinet",
  "undraw_scrum-board_7bgh.png": "Organizare task-uri, fluxuri de dosare, proceduri interne",
  "undraw_security-on_btwg.png": "Securitate cibernetică activă, protecție dosare și date",
  "undraw_sign-here_lxua.png": "Documente oficiale, împuterniciri, semnături electronice",
  "undraw_unlock_m0yr.png": "Permisiuni de acces, deblocare eficiență, audit securitate",
  "undraw_mobile-encryption_flk2.png": "Criptare mobilă, comunicare securizată, confidențialitate",
  "undraw_Schedule_re_2vro.png": "Calendar, planificare termene, termene de decădere",
  "undraw_security_0ubl.png": "Infrastructură securizată, protecție rețea cabinet",
  "undraw_inbox-cleanup_be27.png": "Organizare corespondență, filtrare mesaje, triaj",
  "undraw_add-information_06qr.png": "Introducere date dosar, baze de date, completare formulare",
  "undraw_online-organizer_1kdy.png": "Organizare fișiere și registre electronice ale cabinetului",
  "undraw_time-management_fedt.png": "Gestionarea orelor, pontaj, rentabilitate și eficiență"
};

let introImage = "undraw_add-information_06qr.png";
let midImage = "undraw_security-on_btwg.png";

if (selectedTopic.slug.includes("factura") || selectedTopic.slug.includes("time-tracking")) {
  introImage = "undraw_time-management_fedt.png";
  midImage = "undraw_add-information_06qr.png";
} else if (selectedTopic.slug.includes("securit") || selectedTopic.slug.includes("ransomware")) {
  introImage = "undraw_security-on_btwg.png";
  midImage = "undraw_fingerprint-login_19qv.png";
} else if (selectedTopic.slug.includes("semnatura") || selectedTopic.slug.includes("contract")) {
  introImage = "undraw_sign-here_lxua.png";
  midImage = "undraw_contract-signed_vutk.png";
} else if (selectedTopic.slug.includes("arhiv") || selectedTopic.slug.includes("ocr")) {
  introImage = "undraw_online-organizer_1kdy.png";
  midImage = "undraw_add-information_06qr.png";
} else if (selectedTopic.slug.includes("portal") || selectedTopic.slug.includes("client")) {
  introImage = "undraw_scrum-board_7bgh.png";
  midImage = "undraw_helpful-sign_qvgg.png";
}

// 6. Select Internal Linking Targets from existing corpus
const candidateLinks = [
  { slug: "cat-te-costa-de-fapt-un-cabinet-de-avocatura-nedigitalizat", title: "Cât te costă, de fapt, un cabinet de avocatură nedigitalizat?" },
  { slug: "digitalizarea-cabinetului-individual-de-avocat", title: "Digitalizarea cabinetului individual de avocat: ghid integral" },
  { slug: "zero-trust-security-explicat-pentru-avocati", title: "Zero Trust Security explicat pentru avocați" },
  { slug: "cum-sa-folosesti-docusign-ca-avocat", title: "Cum să folosești DocuSign ca avocat" },
  { slug: "cum-sa-folosesti-notion-ca-avocat", title: "Cum să folosești Notion ca avocat" },
  { slug: "cum-sa-folosesti-google-drive-ca-avocat", title: "Cum să folosești Google Drive ca avocat" },
  { slug: "cum-sa-folosesti-portalul-instantelor-ca-avocat", title: "Cum să folosești portalul instanțelor ca avocat" },
  { slug: "cum-sa-folosesti-rejust-ca-avocat", title: "Cum să folosești ReJust ca avocat" },
  { slug: "cum-sa-alegi-un-furnizor-de-servicii-de-digitalizare-pentru-o-societate-de-avocati", title: "Cum să alegi un furnizor de servicii de digitalizare" }
];

// Pick 3-5 relevant link targets
const relevantLinks = candidateLinks.slice(0, 4);

const result = {
  status: "success",
  seedMetadata: {
    generationTimestamp: new Date().toISOString(),
    randomTemperature: randomTemp,
    creativePosture: creativePosture,
    existingPostCount: existingPosts.length
  },
  suggestedArticle: {
    title: selectedTopic.title,
    slug: selectedTopic.slug,
    description: selectedTopic.description,
    categories: selectedTopic.categories,
    tags: selectedTopic.tags,
    targetFile: `blog/posts/${selectedTopic.slug}.md`,
    requiredWordCount: 2000,
    requiredSectionCount: 12
  },
  visualAssets: {
    introImage: {
      path: `../../assets/img/${introImage}`,
      altText: `Ilustrație: ${selectedTopic.title} în practica judiciară modernă`
    },
    midImage: {
      path: `../../assets/img/${midImage}`,
      altText: `Ilustrație: flux operațional și măsuri practice pentru ${selectedTopic.title}`
    }
  },
  internalLinkingOpportunities: relevantLinks.map(l => ({
    targetSlug: l.slug,
    targetTitle: l.title,
    recommendedMarkdownLink: `[${l.title}](../${l.slug}/)`
  })),
  bannedPhrasesFile: ".agents/skills/generate-lawyer-article/resources/banned-phrases.txt"
};

console.log(JSON.stringify(result, null, 2));
