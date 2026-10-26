"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const { isGaCollectTransportUrl } = require("../../scripts/lib/ga-collect-transport");

/** @type {string[]} */
let sinkHits = [];

/** @type {import("http").Server | null} */
let httpServer = null;

/** @type {import("https").Server | null} */
let httpsServer = null;

/** @type {string | null} */
let certDir = null;

/**
 * @param {import("http").IncomingMessage} req
 * @returns {void}
 */
const recordSinkRequest = (req) => {
  const host = req.headers.host || "";
  const url = `https://${host}${req.url || "/"}`;
  if (isGaCollectTransportUrl(url) || isGaCollectTransportUrl(`http://${host}${req.url || "/"}`)) {
    sinkHits.push(url);
  }
};

/**
 * @returns {string}
 */
const ensureSinkTlsMaterial = () => {
  if (certDir && fs.existsSync(path.join(certDir, "cert.pem"))) {
    return certDir;
  }
  certDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-ga-sink-tls-"));
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=www.google-analytics.com"`,
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return certDir;
};

/**
 * @returns {string}
 */
const sinkCertificateSpkiHash = () => {
  const dir = ensureSinkTlsMaterial();
  const certPath = path.join(dir, "cert.pem");
  const der = execSync(`openssl x509 -in "${certPath}" -pubkey -noout | openssl pkey -pubin -outform der`, {
    encoding: "buffer",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return createHash("sha256").update(der).digest("base64");
};

/**
 * @returns {Promise<{ httpPort: number, httpsPort: number, spkiHash: string }>}
 */
const startGaCollectSinkServer = async () => {
  resetGaCollectSink();
  const dir = ensureSinkTlsMaterial();
  const key = fs.readFileSync(path.join(dir, "key.pem"));
  const cert = fs.readFileSync(path.join(dir, "cert.pem"));
  const spkiHash = sinkCertificateSpkiHash();

  const requestListener = (req, res) => {
    recordSinkRequest(req);
    res.writeHead(204);
    res.end();
  };

  httpServer = http.createServer(requestListener);
  httpsServer = https.createServer({ key, cert }, requestListener);

  const httpPort = 8080;
  await new Promise((resolve) => {
    httpServer.listen(httpPort, "127.0.0.1", resolve);
  });
  const httpsPort = 4443;
  await new Promise((resolve) => {
    httpsServer.listen(httpsPort, "127.0.0.1", resolve);
  });

  return { httpPort, httpsPort, spkiHash };
};

/**
 * @returns {Promise<void>}
 */
const stopGaCollectSinkServer = () =>
  new Promise((resolve) => {
    const closeHttp = httpServer ? new Promise((r) => httpServer.close(() => r(undefined))) : Promise.resolve();
    const closeHttps = httpsServer ? new Promise((r) => httpsServer.close(() => r(undefined))) : Promise.resolve();
    Promise.all([closeHttp, closeHttps]).then(() => {
      httpServer = null;
      httpsServer = null;
      resolve();
    });
  });

/**
 * @returns {void}
 */
const resetGaCollectSink = () => {
  sinkHits.length = 0;
};

/**
 * @returns {string[]}
 */
const getGaCollectSinkHits = () => [...sinkHits];

/**
 * @returns {void}
 */
const assertGaCollectSinkEmpty = () => {
  if (sinkHits.length > 0) {
    throw new Error(`GA collect reached the local sink (network leak): ${sinkHits.join(", ")}`);
  }
};

module.exports = {
  startGaCollectSinkServer,
  stopGaCollectSinkServer,
  resetGaCollectSink,
  getGaCollectSinkHits,
  assertGaCollectSinkEmpty,
  sinkCertificateSpkiHash,
};
