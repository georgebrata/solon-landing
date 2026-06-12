const https = require("https");

const WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbwn4t5N7pIn2WVMwLLDmncDtzPeUC09D76Wf_eA3QNinWkFkUWeymKMdpn5OethdAGm/exec?secret=kyokid";
const AUTHOR = "George";

const formatToday = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
};

const appendRow = (title) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify({ row: [formatToday(), "", title, AUTHOR] });

    const request = https.request(
      WEBHOOK_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 400) {
            resolve(body);
          } else {
            reject(
              new Error(`Request failed with status ${response.statusCode}: ${body}`)
            );
          }
        });
      }
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });

const main = async () => {
  const title = process.argv.slice(2).join(" ").trim();

  if (!title) {
    console.error('Error: "title" is required.');
    console.error("Usage: node scripts/append-blog-google-sheets.js \"Article title\"");
    process.exit(1);
  }

  try {
    await appendRow(title);
    console.log(`Appended row to Google Sheet: ["${formatToday()}", "", "${title}", "${AUTHOR}"]`);
  } catch (error) {
    console.error(`Failed to append row: ${error.message}`);
    process.exit(1);
  }
};

main();
