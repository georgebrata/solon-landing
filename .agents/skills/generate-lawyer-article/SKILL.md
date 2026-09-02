---
name: generate-lawyer-article
description: >-
  Generates a completely new, creative, in-depth blog article in Romanian about digitalization, legaltech, and modern workflows for lawyers in Romania. Analyzes the existing corpus to ensure topic uniqueness, applies dynamic random creativity (temperature), enforces high benchmarks (2,000+ words, 12+ H2s, images, internal links), includes mandatory UNBR legal disclaimer and SOLON CTA, and executes the full build and sitemap pipeline. Use when the user requests a new blog post or as an autonomous scheduled task.
---

# Generate Lawyer Digitalization Article — SOLON Agency

Autonomous skill for researching, drafting, validating, and publishing high-authority blog articles on digitalization, legaltech, and modern practice management for lawyers in Romania.

## Execution Architecture

```
1. Run Seed Script       → Random Temp (0.70-0.95), creative posture, deduplicated topic
2. Draft Article        → Romanian ("tu"), 2,000+ words, 12+ H2s, 2 images, 3+ internal links
3. Append Legal & CTA   → SOLON CTA, mandatory UNBR disclaimer, AI transparency marker
4. Run Quality Gate     → node .agents/skills/generate-lawyer-article/scripts/validate-article.js
5. Execute Pipeline     → humanize.js → build.js → update-sitemap.js → carousel → sheets
```

---

## Step 1 — Run the Topic & Seed Generator

Always start by executing the seed helper script:

```bash
node .agents/skills/generate-lawyer-article/scripts/generate-topic-seed.js
```

This script automatically:
- Scans `blog/posts/*.md` to prevent duplicate topics or titles.
- Generates a **random creativity temperature** ($0.70 - 0.95$) for Phase 1 ideation.
- Assigns the **creative posture**:
  - `0.70 - 0.78`: *Pragmatic Masterclass & Implementation Guide* (deep technical configuration, menus, settings, checklists).
  - `0.79 - 0.87`: *Strategic Transformation & Practice Economics* (ROI, billable vs. administrative hours, client retention).
  - `0.88 - 0.95`: *Forward-Looking LegalTech Innovation & Paradigm Shift* (AI agents, OCR synthesis, future workflows).
- Selects an unwritten high-impact topic, slug, category, and tags.
- Recommends 2 contextual illustrations from `assets/img/` with Romanian alt texts.
- Recommends internal cross-linking targets from existing articles.

> [!NOTE]
> If the user provided a specific topic in their prompt, you can keep the user's topic while still adopting the random temperature posture and asset recommendations from the script.

---

## Step 2 — Drafting the Article

Write the article to `blog/posts/[slug].md`. Adhere to the following standards:

### 1. Language, Tone & Voice
- **Language**: Romanian, with complete and accurate diacritics (`ă`, `â`, `î`, `ș`, `ț`).
- **Address**: Informal singular (**"tu"**), direct peer-to-peer practitioner tone.
- **Voice**: Pragmatic, expert, no fluff, actionable.
- **Formatting details**:
  - Menu paths, button names, UI elements in `**bold**`.
  - Commands, shortcuts, field names, search operators in `` `code` ``.
  - Tables for comparisons, settings, or feature maps.
  - Fenced code blocks for folder trees or workflow schemas.
- **Banned Tropes**: Avoid LLM clichés (see `.agents/skills/generate-lawyer-article/resources/banned-phrases.txt`), such as *"în peisajul dinamic"*, *"fără doar și poate"*, *"este crucial să înțelegem"*, *"în era digitală"*.

### 2. Frontmatter Specifications
Every article must start with a YAML block:

```yaml
---
title: "Titlu concis și atractiv" # Maximum 50 characters (with diacritics)
date: "YYYY-MM-DD"                # Today's date in ISO format
slug: "slug-prietenos-fara-diacritice" # Matches filename (without .md)
description: "Rezumat practic pentru avocați... Maximum 160 characters."
read_time: 12                     # Estimated read time (or omitted for auto-calculation)
categories: ["digitalizare", "legaltech", "management"] # All lowercase
tags: ["avocați", "digitalizare", "subiect1", "subiect2"] # Max 7 tags, always include "avocați"
---
```

### 3. Article Structure & Content Benchmarks
1. **Title H1**: Single H1 at the top matching frontmatter title.
2. **Introduction**: 2–3 concise sentences framing the problem, opportunity, and what the guide delivers.
3. **Intro Image**: Placed immediately after the introduction paragraph.
4. **Main Sections**: Minimum **12 numbered H2 sections** (`## 1. Titlu`, `## 2. Titlu`, ...).
5. **Visual Balance**: At least 1 markdown comparison table and 1 structured list or code schema.
6. **Mid-Article Image**: Second illustration placed between sections 6 and 8.
7. **Internal Cross-Links**: At least **3–4 contextual links** to existing SOLON articles formatted as `[Titlu sau ancoră relevantă](../slug-articol/)`.
8. **Word Count Benchmark**: Target **2,000+ words** (minimum acceptable: 1,500 words).

---

## Step 3 — Mandatory Image Formatting

Images must use the exact Bootstrap grid layout with the relative path `../../assets/img/`:

```html
<div class="row justify-content-center my-4">
  <div class="col-md-9">
    <img src="../../assets/img/NUME_IMAGINE.png" alt="Ilustrație: descriere detaliată în limba română relevantă pentru practica avocațială" class="img-fluid rounded shadow-sm" loading="lazy" decoding="async" />
  </div>
</div>
```

---

## Step 4 — Mandatory Concluding Sections

Every article must end with a `## Concluzie` section that includes the 3 required closing components:

### 1. Summary & Honest Trade-off
Summarize the operational gains and honestly mention 1–2 practical limitations, adoption curves, or prerequisites.

### 2. SOLON Call-to-Action (Mandatory)
```markdown
Dacă dorești să implementezi [tehnologia / fluxul descris] pentru cabinetul tău, adaptat specificului practicii și echipei tale, echipa **SOLON** oferă consultanță de digitalizare și dezvoltare dedicată profesioniștilor din domeniul juridic.
```

### 3. UNBR Legal Educational Disclaimer (Mandatory)
```markdown
---

> *Prezentul articol are un caracter pur informativ și educațional și nu constituie consultanță juridică în sensul Legii nr. 51/1995. Pentru asistență personalizată, vă recomandăm consultarea unui avocat specializat.*
```

### 4. EU AI Act Transparency Marker
At the very end of the file, include the comment marker for auditability:
```html
<!-- AI-Assisted Content | Verified by SOLON Editorial | Model: Gemini / Claude | Compliance: EU AI Act Art. 50 -->
```

---

## Step 5 — Run the Quality Gate Validator

Before running the build pipeline, validate the newly created markdown file:

```bash
node .agents/skills/generate-lawyer-article/scripts/validate-article.js blog/posts/[slug].md --log-audit
```

If validation **fails**:
- Inspect the reported issues (e.g. missing disclaimer, low word count, broken image path, unclosed tags).
- Fix the markdown file.
- Re-run the validator until it reports `✅ PASSED`.

---

## Step 6 — Run the Production Build Pipeline

Once validated, execute the full publishing chain:

```bash
# 1. Normalize typography and formatting
node scripts/humanize.js

# 2. Compile Markdown to HTML and regenerate posts.json
node scripts/build.js

# 3. Update sitemap.xml with the new article URL
node scripts/update-sitemap.js

# 4. Update the homepage carousel with the latest posts
node scripts/update-homepage-blog-carousel.js

# 5. Record publication in Google Sheets (pass article title)
node scripts/append-blog-google-sheets.js "TITLUL ARTICOLULUI"
```

---

## Step 7 — Verification & Output

Verify the compiled output:
1. Verify `blog/[slug]/index.html` exists and is well-formed.
2. Verify `blog/posts.json` contains the new post at index 0.
3. Verify `sitemap.xml` contains `https://solon.agency/blog/[slug]/`.
4. Output a summary to the user including:
   - Article title and slug
   - Random temperature and creative posture used
   - Word count and H2 section count
   - Quality gate validation status
   - Build status

---

## Autonomous Scheduled Task Usage

To configure this skill as a scheduled recurring task in Antigravity:

```text
/schedule CronExpression="0 9 * * 1" Prompt="Folosește skill-ul generate-lawyer-article pentru a cerceta corpusul curent, a alege o temă nouă de digitalizare juridică în România, a genera articolul complet și a rula pipeline-ul complet de build."
```

Or for a one-time timed execution:
```text
/schedule DurationSeconds=3600 Prompt="Rulează skill-ul generate-lawyer-article pentru a crea un nou articol de blog despre legaltech."
```
