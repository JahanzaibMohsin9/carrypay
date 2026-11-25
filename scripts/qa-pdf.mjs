// Prints an internal Markdown note to an A4 PDF next to it (git-ignored folder, nothing published).
//   node scripts/qa-pdf.mjs docs/internal/QA_FINAL.md ["footer label"]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright-core";

const src = path.resolve(process.argv[2] ?? "docs/internal/QA_FINAL.md");
const out = src.replace(/\.md$/, ".pdf");
const label = (process.argv[3] ?? "Q&A for the final").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const css = `
@page { size: A4; margin: 16mm 15mm 18mm; }
body { font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1d2a27; }
h1 { font-size: 20pt; color: #0e1f1c; margin: 0 0 6pt; }
h2 { font-size: 14pt; color: #12705f; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5px solid #cfe0da; break-after: avoid; }
h3 { font-size: 12pt; color: #0e1f1c; margin: 12pt 0 4pt; break-after: avoid; background: #eef5f2; padding: 3pt 6pt; border-radius: 3pt; }
p { margin: 0 0 6pt; orphans: 3; widows: 3; }
p:has(> strong:first-child) { break-inside: avoid; }
strong { color: #0e1f1c; }
em { color: #5b6764; }
li { margin-bottom: 3pt; }
a { color: #12705f; text-decoration: none; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9pt; background: #f1efe9; padding: 0 2pt; border-radius: 2pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; }
tr { break-inside: avoid; }
th, td { border: 1px solid #d3e0db; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #e6f1ed; }
hr { border: none; border-top: 1px solid #d3e0db; margin: 12pt 0; }
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${marked.parse(fs.readFileSync(src, "utf8"))}</body></html>`;
const tmp = path.join(path.dirname(out), ".qa-print.html");
fs.writeFileSync(tmp, html);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(tmp).href);
await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="font-size:8pt;color:#6b7773;width:100%;text-align:center;font-family:Segoe UI,Arial">CarryPay · ${label} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" },
});
await browser.close();
fs.rmSync(tmp);
console.log(out);
