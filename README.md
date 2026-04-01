# solon-landing
Lightweight &amp; fast lading page for a digital agency from Cluj-Napoca.

<img width="1453" alt="Screenshot 2024-07-09 at 17 04 30" src="https://github.com/georgebrata/solon-landing/assets/15268479/33366e4a-c0bf-4a60-add6-5043ee7bec76">

Demo: https://solon.agency/

## Local Development
To run the project locally, simply clone the repository and open the root index.html file.
Optional: use [http-server]([url](https://github.com/http-party/http-server)) for local development


## Features
- Responsive design
- Mailchimp Integration - multiple audiences (phone, contact, newsletter)
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


