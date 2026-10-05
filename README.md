# solon-landing
Lightweight &amp; fast lading page for a digital agency from Cluj-Napoca.

<img width="1453" alt="Screenshot 2024-07-09 at 17 04 30" src="https://github.com/georgebrata/solon-landing/assets/15268479/33366e4a-c0bf-4a60-add6-5043ee7bec76">

Demo: https://solon.agency/

## Local Development
To run the project locally, simply clone the repository and open the root index.html file.
Optional: use [http-server]([url](https://github.com/http-party/http-server)) for local development

```bash
npm ci
npm run test:forms
npm run test:flags
npm audit --audit-level=high
```

## CI / Deploy

GitHub Actions (`.github/workflows/main.yml`) is the production pipeline. Issue #21's claim that `.github/workflows/` is empty is outdated; this workflow already exists and is the place to extend CI. Lighthouse CI and W3C HTML validation from #21 remain optional follow-ups.

| Event | `ci` job (`npm ci`, form/flag tests, `npm audit`) | FTP deploy |
| --- | --- | --- |
| Pull request targeting `main` | Yes | No |
| Push to `main` | Yes, then deploy | Yes, after `ci` |
| Manual **Run workflow** | Yes, then deploy | Yes, after `ci` |

Deploy uses `SamKirkland/FTP-Deploy-Action` with an exclude list so VCS, `node_modules`, tests, docs, tooling, and `.DS_Store` are not uploaded. Remote deletion (`dangerous-clean-slate`) is not enabled.

Repo admins should make the **ci** check required on `main`: **Settings → Branches → Add/Edit branch protection rule for `main` → Require status checks to pass before merging → search for `ci`**. Agents cannot always change that setting.

## Features
- Responsive design
- Contact, callback, and newsletter forms submit directly to Google Apps Script using vanilla JavaScript. See [form integration documentation](docs/forms.md).
- Stripe Integration
- Wordpress Blog support (but different domain)
- FAQ section with dinamic content from Google Sheets
- **Lightweight Static Blog System**: Write in Markdown, build to static HTML.

## Blog System

The project includes a minimal, performant static blog architecture.

### How it works
1.  **Content**: Write blog posts in Markdown (`.md`) in `/blog/posts/`.
2.  **Frontmatter**: Each post must include YAML frontmatter (title, date, slug, description, tags).
3.  **Build**: Run `node scripts/build.js` to compile Markdown files into static HTML pages in `/blog/`.
4.  **Templates**: Layout and styling are controlled via `/templates/`.
5.  **Search**: Includes client-side search and filtering by tag.

### Writing a new post
Create a new `.md` file in `/blog/posts/` with the following format:

```md
---
title: "Titlu Articol"
date: "2026-03-26"
slug: "titlu-articol"
description: "Scurtă descriere a articolului."
tags: ["tag1", "tag2"]
---

# Titlu Articol
Conținutul articolului tău aici...
```

### Automation
A Git pre-commit hook is configured to automatically run the build script and stage the generated files whenever you commit changes.

