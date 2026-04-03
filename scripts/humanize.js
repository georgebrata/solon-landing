const fs = require("fs");
const path = require("path");

const POSTS_DIR = path.join(__dirname, "../blog/posts");

const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"));

let totalReplacements = 0;

files.forEach((file) => {
  const filePath = path.join(POSTS_DIR, file);
  const original = fs.readFileSync(filePath, "utf8");

  const updated = original.replace(/—/g, "-");

  const count = (original.match(/—/g) || []).length;

  if (count > 0) {
    fs.writeFileSync(filePath, updated, "utf8");
    console.log(`✔ ${file}: ${count} replacement(s)`);
    totalReplacements += count;
  }
});

if (totalReplacements === 0) {
  console.log("✔ No em dashes found. Nothing to update.");
} else {
  console.log(`\n✅ Done. ${totalReplacements} total replacement(s) across ${files.length} file(s) checked.`);
}
