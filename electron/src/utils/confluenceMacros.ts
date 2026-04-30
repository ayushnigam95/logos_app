/**
 * Confluence storage-format → standard HTML preprocessor.
 * Ported from backend/app/utils/confluence_macros.py.
 *
 * Order of operations:
 *   1. Layout macros            → CSS flex divs
 *   2. Structured macros        → clean HTML / diagram images / placeholders
 *   3. Image macros (ac:image)  → <img>
 *   4. Strip leftover ac:/ri:   → prevent attribute text leaking
 *
 * Cheerio is used in `xmlMode: true` so `ac:image`, `ri:attachment`, etc.
 * survive parsing.
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

type El = Cheerio<Element>;

const PARAM_PREFIXES = ['ac:parameter', 'ri:'];

export function preprocessConfluenceHtml(
  html: string,
  jobId = '',
  pageId = '',
  baseUrl = '',
): string {
  if (!html || !html.trim()) return html;

  const $ = cheerio.load(html, { xmlMode: true });

  convertLayouts($);
  convertStructuredMacros($, jobId, pageId, baseUrl);
  convertImages($, jobId, pageId, baseUrl);
  cleanRemainingMacros($);

  return $.root().html() ?? html;
}

// ---------- helpers ----------

function escapeNs(sel: string): string {
  // Escape colons for cheerio/css selectors (e.g. "ac:image" → "ac\\:image").
  return sel.replace(/:/g, '\\:');
}

function getMacroParam($: CheerioAPI, macro: AnyNode, name: string): string | null {
  let result: string | null = null;
  $(macro)
    .find(escapeNs('ac:parameter'))
    .each((_, p) => {
      if (result !== null) return;
      if ($(p).attr('ac:name') === name) {
        result = $(p).text().trim();
      }
    });
  return result;
}

function isParameter(node: AnyNode): boolean {
  if (node.type !== 'tag') return false;
  const name = (node as Element).name ?? '';
  return PARAM_PREFIXES.some((p) => name.startsWith(p));
}

function urlEncode(s: string): string {
  // Match Python's urllib.parse.quote(name, safe='') — encode everything non-alphanumeric.
  return encodeURIComponent(s);
}

function newTag($: CheerioAPI, tag: string, attrs: Record<string, string> = {}): El {
  const el = $(`<${tag}>`) as unknown as El;
  for (const [k, v] of Object.entries(attrs)) el.attr(k, v);
  return el;
}

/** Move all children from `from` element into `to` element (preserving order). */
function moveChildren($: CheerioAPI, fromEl: AnyNode, to: El): void {
  const children = $(fromEl).contents().toArray();
  for (const child of children) {
    to.append($(child as AnyNode) as unknown as Cheerio<AnyNode>);
  }
}

// ---------- layouts ----------

function convertLayouts($: CheerioAPI): void {
  $(escapeNs('ac:layout')).each((_, layout) => {
    const layoutDiv = newTag($, 'div', {
      class: 'confluence-layout',
      style: 'width: 100%; margin: 16px 0;',
    });

    $(layout)
      .children(escapeNs('ac:layout-section'))
      .each((__, section) => {
        const sectionType = $(section).attr('ac:type') ?? 'single';
        const sectionDiv = newTag($, 'div', {
          class: `confluence-layout-section confluence-layout-${sectionType}`,
          style: 'display: flex; gap: 24px; margin-bottom: 16px;',
        });

        const cells = $(section).children(escapeNs('ac:layout-cell')).toArray();
        const numCells = cells.length;

        for (const cell of cells) {
          const cellDiv = newTag($, 'div', {
            class: 'confluence-layout-cell',
            style: `flex: 0 0 ${getCellWidth(sectionType, numCells)}; min-width: 0;`,
          });
          moveChildren($, cell as Element, cellDiv);
          sectionDiv.append(cellDiv as unknown as Cheerio<AnyNode>);
        }

        layoutDiv.append(sectionDiv as unknown as Cheerio<AnyNode>);
      });

    $(layout).replaceWith(layoutDiv as unknown as Cheerio<AnyNode>);
  });
}

function getCellWidth(sectionType: string, numCells: number): string {
  const map: Record<string, string | string[]> = {
    single: '100%',
    two_equal: 'calc(50% - 12px)',
    two_left_sidebar: ['30%', 'calc(70% - 24px)'],
    two_right_sidebar: ['calc(70% - 24px)', '30%'],
    three_equal: 'calc(33.33% - 16px)',
    three_with_sidebars: ['20%', 'calc(60% - 48px)', '20%'],
  };
  const val = map[sectionType];
  if (Array.isArray(val)) {
    // Mirrors Python fallback: equal distribution
    const pct = (100 / numCells).toFixed(1);
    const gap = Math.round((12 * (numCells - 1)) / numCells);
    return `calc(${pct}% - ${gap}px)`;
  }
  if (typeof val === 'string') return val;
  if (numCells > 0) {
    const pct = (100 / numCells).toFixed(1);
    const gap = Math.round((12 * (numCells - 1)) / numCells);
    return `calc(${pct}% - ${gap}px)`;
  }
  return '100%';
}

// ---------- ac:image ----------

function convertImages($: CheerioAPI, _jobId: string, pageId: string, baseUrl: string): void {
  $(escapeNs('ac:image')).each((_, acImg) => {
    const img = makeImgTag($, acImg, pageId, baseUrl);
    if (img) {
      $(acImg).replaceWith(img as unknown as Cheerio<AnyNode>);
    } else {
      $(acImg).remove();
    }
  });
}

function makeImgTag(
  $: CheerioAPI,
  acImg: AnyNode,
  pageId: string,
  baseUrl: string,
): El | null {
  let src = '';
  let alt = '';

  const riAttach = $(acImg).find(escapeNs('ri:attachment')).first();
  if (riAttach.length) {
    const filename = riAttach.attr('ri:filename') ?? '';
    if (filename) {
      alt = filename;
      const cleanBase = baseUrl.replace(/\/+$/, '');
      src = cleanBase
        ? `${cleanBase}/download/attachments/${pageId}/${urlEncode(filename)}`
        : `/download/attachments/${pageId}/${urlEncode(filename)}`;
    }
  }

  if (!src) {
    const riUrl = $(acImg).find(escapeNs('ri:url')).first();
    if (riUrl.length) src = riUrl.attr('ri:value') ?? '';
  }

  if (!src) return null;

  const img = newTag($, 'img', { src, alt });
  for (const attr of ['ac:width', 'ac:height', 'width', 'height']) {
    const v = $(acImg).attr(attr);
    if (v) img.attr(attr.replace('ac:', ''), v);
  }
  return img;
}

// ---------- structured macros ----------

const NAV_MACROS = new Set([
  'toc', 'children', 'pagetree', 'pagetreesearch',
  'blog-posts', 'recently-updated', 'content-by-label',
  'contentbylabel', 'livesearch', 'popular-labels',
  'space-details', 'labels-list', 'profile-picture',
  'roster', 'gallery',
]);

const BODY_ONLY_MACROS = new Set([
  'excerpt', 'excerpt-include', 'panel', 'section',
  'column', 'tabs-container', 'tab', 'ui-tabs-container',
  'div', 'span', 'details',
]);

function convertStructuredMacros(
  $: CheerioAPI,
  jobId: string,
  pageId: string,
  baseUrl: string,
): void {
  $(escapeNs('ac:structured-macro')).each((_, macro) => {
    const name =
      $(macro).attr('ac:name') ?? $(macro).attr('data-macro-name') ?? '';

    if (name.includes('drawio') ||
        ['gliffy', 'lucidchart', 'plantuml', 'mermaid', 'mermaid-cloud'].includes(name)) {
      convertDiagramMacro($, macro, name, pageId, baseUrl);
    } else if (['info', 'note', 'warning', 'tip'].includes(name)) {
      convertPanelMacro($, macro, name);
    } else if (name === 'expand') {
      convertExpandMacro($, macro);
    } else if (['code', 'noformat'].includes(name)) {
      convertCodeMacro($, macro);
    } else if (name === 'status') {
      convertStatusMacro($, macro);
    } else if (['jira', 'jiraissues', 'jira-issue'].includes(name)) {
      convertJiraMacro($, macro);
    } else if (['viewxls', 'viewpdf', 'viewfile', 'view-file', 'view-doc', 'view-ppt'].includes(name)) {
      convertFileMacro($, macro, baseUrl, pageId);
    } else if (['attachments', 'attachment'].includes(name)) {
      convertAttachmentsMacro($, macro);
    } else if (['widget', 'widget-connector', 'iframe', 'multimedia'].includes(name)) {
      convertEmbedMacro($, macro);
    } else if (name === 'anchor') {
      convertAnchorMacro($, macro);
    } else if (['html', 'html-bobswift', 'html-include'].includes(name)) {
      convertHtmlMacro($, macro);
    } else if (NAV_MACROS.has(name)) {
      $(macro).remove();
    } else if (BODY_ONLY_MACROS.has(name)) {
      convertBodyOnly($, macro);
    } else {
      convertBodyOnly($, macro);
    }
  });

  convertAcLinks($);
  convertTaskLists($);
  convertEmoticons($);
}

// ---------- diagrams ----------

function convertDiagramMacro(
  $: CheerioAPI,
  macro: AnyNode,
  name: string,
  pageId: string,
  baseUrl: string,
): void {
  const container = newTag($, 'div', {
    class: 'confluence-diagram',
    style: 'text-align: center; margin: 16px 0;',
  });

  const innerImg = $(macro).find(escapeNs('ac:image')).first();
  const fallbackImg = innerImg.length ? innerImg : $(macro).find('img').first();
  if (fallbackImg.length) {
    container.append(fallbackImg.clone() as unknown as Cheerio<AnyNode>);
    fallbackImg.remove();
    $(macro).replaceWith(container as unknown as Cheerio<AnyNode>);
    return;
  }

  const diagramName = getMacroParam($, macro, 'diagramName');
  const targetPageId = getMacroParam($, macro, 'pageId') || pageId;

  if (diagramName && targetPageId) {
    const filename = `${diagramName}.png`;
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const src = cleanBase
      ? `${cleanBase}/download/attachments/${targetPageId}/${urlEncode(filename)}`
      : `/download/attachments/${targetPageId}/${urlEncode(filename)}`;

    const img = newTag($, 'img', { src, alt: diagramName });
    img.attr('style', 'max-width: 100%; height: auto;');
    const diagramWidth = getMacroParam($, macro, 'diagramWidth');
    const displayWidth = getMacroParam($, macro, 'width');
    if (diagramWidth) img.attr('width', diagramWidth);
    else if (displayWidth) img.attr('width', displayWidth);

    container.append(img as unknown as Cheerio<AnyNode>);
    $(macro).replaceWith(container as unknown as Cheerio<AnyNode>);
    return;
  }

  const placeholder = newTag($, 'div', {
    class: 'confluence-diagram-placeholder',
    style:
      'background: #f4f5f7; border: 1px dashed #ccc; border-radius: 4px; ' +
      'padding: 24px; text-align: center; margin: 16px 0; color: #6b778c;',
  });
  const label = diagramName || `[${name.charAt(0).toUpperCase() + name.slice(1)} Diagram]`;
  placeholder.text(`📊 ${label}`);
  $(macro).replaceWith(placeholder as unknown as Cheerio<AnyNode>);
}

// ---------- panels ----------

function convertPanelMacro($: CheerioAPI, macro: AnyNode, panelType: string): void {
  const styles: Record<string, [string, string, string]> = {
    info: ['ℹ️', '#deebff', '#0052cc'],
    note: ['📝', '#fffae6', '#ff8b00'],
    warning: ['⚠️', '#ffebe6', '#de350b'],
    tip: ['💡', '#e3fcef', '#006644'],
  };
  const [icon, bg, border] = styles[panelType] ?? ['', '#f4f5f7', '#ccc'];

  const panel = newTag($, 'div', {
    class: `confluence-panel confluence-panel-${panelType}`,
    style:
      `background: ${bg}; border-left: 4px solid ${border}; ` +
      `padding: 12px 16px; margin: 12px 0; border-radius: 4px;`,
  });

  const title = getMacroParam($, macro, 'title');
  if (title) {
    const strong = newTag($, 'strong');
    strong.text(`${icon} ${title}`);
    panel.append(strong as unknown as Cheerio<AnyNode>);
    panel.append(newTag($, 'br') as unknown as Cheerio<AnyNode>);
  }

  const body =
    $(macro).find(escapeNs('ac:rich-text-body')).first().get(0) ??
    $(macro).find(escapeNs('ac:plain-text-body')).first().get(0);

  if (body) {
    moveChildren($, body as Element, panel);
  } else {
    for (const child of $(macro).contents().toArray()) {
      if (!isParameter(child as AnyNode)) {
        panel.append($(child as AnyNode) as unknown as Cheerio<AnyNode>);
      }
    }
  }

  $(macro).replaceWith(panel as unknown as Cheerio<AnyNode>);
}

// ---------- expand ----------

function convertExpandMacro($: CheerioAPI, macro: AnyNode): void {
  const details = newTag($, 'details', { style: 'margin: 8px 0;' });
  const title = getMacroParam($, macro, 'title') || 'Click to expand';
  const summary = newTag($, 'summary', {
    style: 'cursor: pointer; font-weight: bold; padding: 4px 0;',
  });
  summary.text(title);
  details.append(summary as unknown as Cheerio<AnyNode>);

  const body = $(macro).find(escapeNs('ac:rich-text-body')).first().get(0);
  if (body) {
    const wrapper = newTag($, 'div', { style: 'padding: 8px 0 8px 16px;' });
    moveChildren($, body as Element, wrapper);
    details.append(wrapper as unknown as Cheerio<AnyNode>);
  }

  $(macro).replaceWith(details as unknown as Cheerio<AnyNode>);
}

// ---------- code ----------

function convertCodeMacro($: CheerioAPI, macro: AnyNode): void {
  const language = getMacroParam($, macro, 'language') || '';
  const body = $(macro).find(escapeNs('ac:plain-text-body')).first();
  const pre = newTag($, 'pre');
  const code = newTag($, 'code');
  if (language) code.attr('class', `language-${language}`);
  code.text(body.length ? body.text() : '');
  pre.append(code as unknown as Cheerio<AnyNode>);
  $(macro).replaceWith(pre as unknown as Cheerio<AnyNode>);
}

// ---------- status ----------

function convertStatusMacro($: CheerioAPI, macro: AnyNode): void {
  const title = getMacroParam($, macro, 'title') || '';
  const colour = (getMacroParam($, macro, 'colour') || 'grey').toLowerCase();
  const colors: Record<string, [string, string]> = {
    grey: ['#42526e', '#dfe1e6'],
    gray: ['#42526e', '#dfe1e6'],
    red: ['#bf2600', '#ffebe6'],
    yellow: ['#974f0c', '#fff0b3'],
    green: ['#006644', '#abf5d1'],
    blue: ['#0747a6', '#deebff'],
    purple: ['#403294', '#eae6ff'],
  };
  const [fg, bg] = colors[colour] ?? colors.grey;

  const badge = newTag($, 'span', {
    class: `confluence-status confluence-status-${colour}`,
    style:
      `display: inline-block; padding: 2px 8px; border-radius: 3px; ` +
      `font-size: 11px; font-weight: 700; text-transform: uppercase; ` +
      `background: ${bg}; color: ${fg};`,
  });
  badge.text(title);
  $(macro).replaceWith(badge as unknown as Cheerio<AnyNode>);
}

// ---------- jira ----------

function convertJiraMacro($: CheerioAPI, macro: AnyNode): void {
  const key = getMacroParam($, macro, 'key');
  const serverUrl =
    getMacroParam($, macro, 'serverId') || getMacroParam($, macro, 'server');

  if (!key) {
    $(macro).remove();
    return;
  }

  const link = newTag($, 'a', {
    class: 'confluence-jira-link',
    style:
      'display: inline-block; padding: 1px 6px; border-radius: 3px; ' +
      'font-family: monospace; font-size: 12px; background: #deebff; ' +
      'color: #0747a6; text-decoration: none; border: 1px solid #b3d4fc;',
  });
  link.text(key);
  if (serverUrl) link.attr('href', `${serverUrl}/browse/${key}`);
  $(macro).replaceWith(link as unknown as Cheerio<AnyNode>);
}

// ---------- file ----------

function convertFileMacro(
  $: CheerioAPI,
  macro: AnyNode,
  baseUrl: string,
  pageId: string,
): void {
  const attach = $(macro).find(escapeNs('ri:attachment')).first();
  const filename = attach.length
    ? (attach.attr('ri:filename') ?? '')
    : (getMacroParam($, macro, 'name') ?? '');

  if (!filename) {
    $(macro).remove();
    return;
  }
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const href = cleanBase
    ? `${cleanBase}/download/attachments/${pageId}/${urlEncode(filename)}`
    : `/download/attachments/${pageId}/${urlEncode(filename)}`;

  const link = newTag($, 'a', {
    href,
    class: 'confluence-file-link',
    style:
      'display: inline-block; padding: 6px 12px; margin: 8px 0; ' +
      'background: #f4f5f7; border: 1px solid #dfe1e6; border-radius: 4px; ' +
      'text-decoration: none; color: #0052cc;',
  });
  link.text(`📎 ${filename}`);
  $(macro).replaceWith(link as unknown as Cheerio<AnyNode>);
}

// ---------- attachments list ----------

function convertAttachmentsMacro($: CheerioAPI, macro: AnyNode): void {
  const note = newTag($, 'div', {
    class: 'confluence-attachments-note',
    style:
      'padding: 8px 12px; background: #f4f5f7; border-left: 3px solid #0052cc; ' +
      'font-size: 13px; color: #5e6c84; margin: 8px 0;',
  });
  note.text('📎 (Attachments list — view original page for files)');
  $(macro).replaceWith(note as unknown as Cheerio<AnyNode>);
}

// ---------- embed / iframe ----------

function convertEmbedMacro($: CheerioAPI, macro: AnyNode): void {
  const url =
    getMacroParam($, macro, 'url') ||
    getMacroParam($, macro, 'src') ||
    getMacroParam($, macro, 'location');

  if (!url) {
    convertBodyOnly($, macro);
    return;
  }

  const iframe = newTag($, 'iframe', {
    src: url,
    style:
      'width: 100%; min-height: 400px; border: 1px solid #dfe1e6; ' +
      'border-radius: 4px; margin: 8px 0;',
    loading: 'lazy',
    allowfullscreen: '',
  });
  $(macro).replaceWith(iframe as unknown as Cheerio<AnyNode>);
}

// ---------- anchor ----------

function convertAnchorMacro($: CheerioAPI, macro: AnyNode): void {
  const text = $(macro).text().trim();
  const name = text || getMacroParam($, macro, '0') || '';
  if (!name) {
    $(macro).remove();
    return;
  }
  const a = newTag($, 'a', { id: name, class: 'confluence-anchor' });
  $(macro).replaceWith(a as unknown as Cheerio<AnyNode>);
}

// ---------- html macro ----------

function convertHtmlMacro($: CheerioAPI, macro: AnyNode): void {
  const body = $(macro).find(escapeNs('ac:plain-text-body')).first();
  if (!body.length) {
    $(macro).remove();
    return;
  }
  const rawHtml = body.text();
  // Parse the inner HTML and reinsert as a wrapper div.
  const inner = cheerio.load(rawHtml, { xmlMode: false });
  const wrapper = newTag($, 'div', { class: 'confluence-html-macro' });
  // inner.root().html() returns the full body HTML
  const innerHtml = inner('body').html() ?? inner.root().html() ?? '';
  wrapper.html(innerHtml);
  $(macro).replaceWith(wrapper as unknown as Cheerio<AnyNode>);
}

// ---------- ac:link → <a> ----------

function convertAcLinks($: CheerioAPI): void {
  $(escapeNs('ac:link')).each((_, link) => {
    const body =
      $(link).find(escapeNs('ac:link-body')).first().get(0) ??
      $(link).find(escapeNs('ac:plain-text-link-body')).first().get(0);
    let text = body ? $(body).text().trim() : '';

    const riPage = $(link).find(escapeNs('ri:page')).first();
    const riUser = $(link).find(escapeNs('ri:user')).first();
    const riAttach = $(link).find(escapeNs('ri:attachment')).first();
    const riSpace = $(link).find(escapeNs('ri:space')).first();
    const anchor = $(link).attr('ac:anchor') ?? '';

    let href = '#';
    if (riPage.length) {
      const title = riPage.attr('ri:content-title') ?? '';
      if (!text) text = title;
      if (anchor) href = `#${anchor}`;
    } else if (riUser.length) {
      const username = riUser.attr('ri:username') ?? riUser.attr('ri:userkey') ?? '';
      if (!text) text = `@${username}`;
    } else if (riAttach.length) {
      const filename = riAttach.attr('ri:filename') ?? '';
      if (!text) text = filename;
    } else if (riSpace.length) {
      const spaceKey = riSpace.attr('ri:space-key') ?? '';
      if (!text) text = spaceKey;
    } else if (anchor) {
      href = `#${anchor}`;
      if (!text) text = anchor;
    }

    if (!text) {
      $(link).remove();
      return;
    }

    const a = newTag($, 'a', { href, class: 'confluence-internal-link' });
    a.text(text);
    $(link).replaceWith(a as unknown as Cheerio<AnyNode>);
  });
}

// ---------- task lists ----------

function convertTaskLists($: CheerioAPI): void {
  $(escapeNs('ac:task-list')).each((_, taskList) => {
    const ul = newTag($, 'ul', {
      class: 'confluence-task-list',
      style: 'list-style: none; padding-left: 0;',
    });

    $(taskList)
      .find(escapeNs('ac:task'))
      .each((__, task) => {
        const status = $(task).find(escapeNs('ac:task-status')).first();
        const body = $(task).find(escapeNs('ac:task-body')).first().get(0);
        const isDone = status.length && status.text().trim().toLowerCase() === 'complete';

        const li = newTag($, 'li', { style: 'margin: 4px 0;' });
        const cb = newTag($, 'input', {
          type: 'checkbox',
          disabled: '',
          style: 'margin-right: 8px;',
        });
        if (isDone) cb.attr('checked', '');
        li.append(cb as unknown as Cheerio<AnyNode>);

        if (body) moveChildren($, body as Element, li);
        ul.append(li as unknown as Cheerio<AnyNode>);
      });

    $(taskList).replaceWith(ul as unknown as Cheerio<AnyNode>);
  });
}

// ---------- emoticons ----------

const EMOTICON_MAP: Record<string, string> = {
  smile: '🙂', sad: '🙁', cheeky: '😋', laugh: '😄',
  wink: '😉', 'thumbs-up': '👍', 'thumbs-down': '👎',
  information: 'ℹ️', tick: '✔️', cross: '❌',
  warning: '⚠️', plus: '➕', minus: '➖',
  question: '❓', 'light-on': '💡', 'light-off': '💭',
  'yellow-star': '⭐', 'red-star': '🌟', 'green-star': '✨',
  'blue-star': '⭐', heart: '❤️', 'broken-heart': '💔',
};

function convertEmoticons($: CheerioAPI): void {
  $(escapeNs('ac:emoticon')).each((_, emo) => {
    const name = $(emo).attr('ac:name') ?? '';
    const ch = EMOTICON_MAP[name];
    if (ch) {
      $(emo).replaceWith(ch);
    } else {
      $(emo).remove();
    }
  });
}

// ---------- body-only fallback ----------

function convertBodyOnly($: CheerioAPI, macro: AnyNode): void {
  const body =
    $(macro).find(escapeNs('ac:rich-text-body')).first().get(0) ??
    $(macro).find(escapeNs('ac:plain-text-body')).first().get(0);

  if (body) {
    const wrapper = newTag($, 'div');
    moveChildren($, body as Element, wrapper);
    $(macro).replaceWith(wrapper as unknown as Cheerio<AnyNode>);
    return;
  }

  const wrapper = newTag($, 'div');
  let hasContent = false;
  for (const child of $(macro).contents().toArray()) {
    if (!isParameter(child as AnyNode)) {
      wrapper.append($(child as AnyNode) as unknown as Cheerio<AnyNode>);
      hasContent = true;
    }
  }
  if (hasContent) {
    $(macro).replaceWith(wrapper as unknown as Cheerio<AnyNode>);
  } else {
    $(macro).remove();
  }
}

// ---------- final cleanup ----------

function cleanRemainingMacros($: CheerioAPI): void {
  // Drop ac:parameter
  $(escapeNs('ac:parameter')).remove();

  // Drop orphaned ri: elements
  for (const tag of [
    'ri:attachment', 'ri:url', 'ri:page', 'ri:space',
    'ri:content-entity', 'ri:user',
  ]) {
    $(escapeNs(tag)).remove();
  }

  // Any remaining ac:* tags — unwrap (keep children) or drop if empty.
  // We re-query each iteration because unwrapping mutates the tree.
  let changed = true;
  while (changed) {
    changed = false;
    const remaining = $('*')
      .toArray()
      .filter((el) => (el as Element).name?.startsWith('ac:'));
    for (const el of remaining) {
      const $el = $(el);
      if ($el.contents().length) {
        // Unwrap — replace with its children.
        const childrenHtml = $el.html() ?? '';
        $el.replaceWith(childrenHtml);
      } else {
        $el.remove();
      }
      changed = true;
    }
  }
}
