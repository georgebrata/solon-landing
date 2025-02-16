const fs = require("fs");
const path = require("path");

// Get current ISO timestamp
const now = new Date().toISOString();

const sitemapPath = path.join(__dirname, "../sitemap.xml");

// Read sitemap.xml
let sitemapContent = fs.readFileSync(sitemapPath, "utf8");

// Replace lastmod with new timestamp
sitemapContent = sitemapContent.replace(
  /<lastmod>.*?<\/lastmod>/,
  `<lastmod>${now}</lastmod>`
);

// Write updated sitemap.xml
fs.writeFileSync(sitemapPath, sitemapContent, "utf8");

console.log(`✅ Updated sitemap.xml lastmod to ${now}`);
