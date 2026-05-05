/**
 * PDF generator — ported from backend/app/services/pdf_generator.py.
 *
 * Renders HTML to PDF via Playwright Chromium (same engine the Python backend
 * already uses). Combined and ZIP modes preserved.
 */

import JSZip from 'jszip';
import { app } from 'electron';
import { chromium } from 'playwright';

function chromiumExecutablePath(): string | undefined {
  if (!app.isPackaged) return undefined;
  try {
    const raw = chromium.executablePath();
    return raw.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');
  } catch {
    return undefined;
  }
}

const PAGE_CSS = `
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 20px;
    color: #172b4d;
    line-height: 1.6;
    font-size: 14px;
}
h1, h2, h3, h4, h5, h6 { color: #172b4d; margin-top: 1.5em; margin-bottom: 0.5em; }
h1 { font-size: 24px; border-bottom: 1px solid #dfe1e6; padding-bottom: 8px; }
h2 { font-size: 20px; }
h3 { font-size: 16px; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #dfe1e6; padding: 8px 12px; text-align: left; }
th { background-color: #f4f5f7; font-weight: 600; }
pre, code { background-color: #f4f5f7; border-radius: 3px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; }
pre { padding: 12px; overflow-x: auto; }
code { padding: 2px 4px; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 3px solid #dfe1e6; margin-left: 0; padding-left: 16px; color: #6b778c; }
a { color: #0052cc; text-decoration: none; }
.page-header { margin-bottom: 24px; }
.page-header h1 { margin-top: 0; }
.page-meta { color: #6b778c; font-size: 12px; margin-bottom: 16px; }
@page { margin: 2cm; size: A4; }
`;

export interface PdfPage {
  title: string;
  bodyHtml: string;
  breadcrumbs?: string[];
}

function pageHtml(p: PdfPage): string {
  const breadcrumbs = p.breadcrumbs?.length
    ? `<div class="page-meta">${p.breadcrumbs.join(' &gt; ')}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${p.title}</title>
<style>${PAGE_CSS}</style></head><body>
<div class="page-header">${breadcrumbs}<h1>${p.title}</h1></div>
<div class="page-content">${p.bodyHtml}</div>
</body></html>`;
}

function combinedHtml(pages: PdfPage[]): string {
  const sections = pages.map((p, i) => {
    const breadcrumbs = p.breadcrumbs?.length
      ? `<div class="page-meta">${p.breadcrumbs.join(' &gt; ')}</div>`
      : '';
    const pageBreak = i > 0 ? 'style="page-break-before: always;"' : '';
    return `<div ${pageBreak}>
      <div class="page-header">${breadcrumbs}<h1>${p.title}</h1></div>
      <div class="page-content">${p.bodyHtml}</div>
    </div>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Confluence Translation</title>
<style>${PAGE_CSS}</style></head><body>${sections}</body></html>`;
}

async function renderPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutablePath() });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buf = await page.pdf({
      format: 'A4',
      margin: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' },
      printBackground: true,
    });
    return buf;
  } finally {
    await browser.close();
  }
}

export async function generatePdfFromPage(p: PdfPage): Promise<Buffer> {
  return renderPdf(pageHtml(p));
}

export async function generateCombinedPdf(pages: PdfPage[]): Promise<Buffer> {
  return renderPdf(combinedHtml(pages));
}

export async function generatePdfZip(pages: PdfPage[]): Promise<Buffer> {
  const zip = new JSZip();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const safeTitle = p.title
      .split('')
      .filter((c) => /[A-Za-z0-9 \-_]/.test(c))
      .join('')
      .trim()
      .slice(0, 80) || `page_${i}`;
    const filename = `${String(i + 1).padStart(3, '0')}_${safeTitle}.pdf`;
    const pdf = await generatePdfFromPage(p);
    zip.file(filename, pdf);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
