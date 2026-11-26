#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const expectedVersion = '17.0.5';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const sourcePath = join(repositoryRoot, 'tutorial/tutorial.md');
const outputPath = join(repositoryRoot, 'tutorial/index.html');
const require = createRequire(import.meta.url);

async function loadMarked() {
  let entry;
  let packagePath;
  try {
    entry = require.resolve('marked');
    packagePath = require.resolve('marked/package.json');
  } catch (error) {
    const runtimeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (error.code !== 'MODULE_NOT_FOUND' || !runtimeModules) throw error;
    const packageRoot = join(runtimeModules, 'marked');
    entry = join(packageRoot, 'lib/marked.esm.js');
    packagePath = join(packageRoot, 'package.json');
  }
  const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
  if (metadata.version !== expectedVersion) {
    throw new Error(`Expected marked ${expectedVersion}; found ${metadata.version}. Run npm install --prefix scripts --ignore-scripts.`);
  }
  return import(pathToFileURL(entry).href);
}

let Marked, Renderer;
try {
  ({ Marked, Renderer } = await loadMarked());
} catch (error) {
  console.error('Tutorial build dependency unavailable. Run npm install --prefix scripts --ignore-scripts.');
  throw error;
}

const source = await readFile(sourcePath, 'utf8');
const titleMatch = source.match(/^# (.+)\r?\n/);
if (!titleMatch) throw new Error('The tutorial must begin with one H1 title.');
if ((source.match(/^# /gm) || []).length !== 1) throw new Error('Use one H1; chapters should be H2.');
const fullTitle = titleMatch[1];
const titleParts = fullTitle.split(': ');
const title = titleParts.shift();
const subtitle = titleParts.join(': ');
const markdownBody = source.slice(titleMatch[0].length).trimStart();
const readingMinutes = Math.ceil(source.trim().split(/\s+/).length / 230);
const sourceHash = createHash('sha256').update(source).digest('hex');

function escape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const chapters = [];
const slugUses = new Map();
let latestHeading = 'Tutorial reference';
let codeCount = 0;
let tableCount = 0;
let paragraphCount = 0;
const renderer = new Renderer();
const defaultTable = renderer.table;

function slugify(text) {
  const base = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  const used = slugUses.get(base) || 0;
  slugUses.set(base, used + 1);
  return used ? `${base}-${used + 1}` : base;
}

renderer.heading = function ({ tokens, depth, text }) {
  const html = this.parser.parseInline(tokens);
  const plain = text.replace(/[*_`]/g, '');
  const id = slugify(plain);
  latestHeading = plain;
  if (depth === 2) chapters.push({ title: plain, id });
  return `<h${depth} id="${id}" tabindex="-1">${html}<a class="heading-link" href="#${id}" aria-label="Link to ${escape(plain)}">#</a></h${depth}>\n`;
};

renderer.paragraph = function ({ tokens, text }) {
  paragraphCount++;
  const html = this.parser.parseInline(tokens);
  let className = paragraphCount === 1 ? ' class="lead"' : '';
  if (text.startsWith('**Start here:**')) className = ' class="resource-links"';
  if (text.startsWith('This is a teaching implementation')) className = ' class="validation-note"';
  return `<p${className}>${html}</p>\n`;
};

renderer.code = function ({ text, lang }) {
  const id = `code-${++codeCount}`;
  const language = (lang || 'text').split(/\s/)[0];
  const label = language === 'csharp' ? 'C#' : language.toUpperCase();
  return `<div class="code-block"><div class="code-header"><span>${escape(label)}</span><button class="copy-code" type="button" data-copy-code="${id}" aria-label="Copy ${escape(label)} code example ${codeCount}" hidden>Copy code</button></div><pre tabindex="0" aria-label="${escape(label)} code example ${codeCount}"><code id="${id}" class="language-${escape(language)}">${escape(text)}</code></pre></div>\n`;
};

renderer.table = function (token) {
  tableCount++;
  const html = defaultTable.call(this, token).replace(/<th(?=[\s>])/g, '<th scope="col"');
  return `<div class="table-wrap"><div class="table-scroll" tabindex="0" role="region" aria-label="${escape(latestHeading)} table">${html}</div><div class="table-hint" aria-hidden="true">Swipe or scroll horizontally to see the full table</div></div>\n`;
};

const marked = new Marked({ renderer, gfm: true, breaks: false });
const article = marked.parse(markdownBody);
const expectedChapters = (source.match(/^## /gm) || []).length;
if (chapters.length !== expectedChapters) throw new Error('Chapter rendering mismatch.');
const expectedCodeBlocks = (source.match(/^```[^\n]*$/gm) || []).length / 2;
if (codeCount !== expectedCodeBlocks) throw new Error('Code block rendering mismatch.');

const shortTitles = [
  'Build the teaching scene', 'Tracking and force paths', 'The GorillaLocomotion source',
  'C# source map', 'Three grab controllers', 'Feedforward and filtering',
  'Joint frames and rotation', 'FireBlast’s settings', 'Timing, gravity, release',
  'Experiments and tuning', 'Troubleshooting', 'Quest, WebXR, acceptance', 'Credits and foundations'
];

function tableOfContents() {
  return `<ol class="toc-list">${chapters.map((chapter, index) => `<li><a href="#${chapter.id}" data-chapter="${chapter.id}"><span class="toc-number" aria-hidden="true">${index < 12 ? String(index + 1).padStart(2, '0') : '+'}</span><span>${escape(shortTitles[index] || chapter.title.replace(/^\d+\.\s*/, ''))}</span></a></li>`).join('\n')}</ol>`;
}

const html = `<!doctype html>
<!-- Generated from tutorial/tutorial.md by scripts/build-tutorial.mjs. Source SHA-256: ${sourceHash} -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0c131c">
  <meta name="description" content="Build a Unity 6 OpenXR VR grabbing lab. Compare ConfigurableJoint, relative PD and backward PD while holding the same object, with C# starter code and a WebXR companion.">
  <meta property="og:title" content="VR Grabbing Tutorial · Physics Gym · Tront">
  <meta property="og:description" content="A complete Unity C# guide to hand locomotion, physical grabbing, joint frames and live controller A/B tests.">
  <meta property="og:type" content="article">
  <title>VR Grabbing Tutorial · Physics Gym · Tront</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <a class="skip-link" href="#tutorial-content">Skip to tutorial</a>
  <div class="reading-progress" aria-hidden="true"><span id="reading-progress"></span></div>
  <div class="shell">
    <header class="masthead">
      <a class="brand" href="../" aria-label="Physics Gym home"><span class="brand-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span><b>PHYSICS GYM</b><small>TRONT / INTERACTION LABS</small></span></a>
      <nav aria-label="Main navigation"><a href="../">Controller Gym</a><a href="../vr/">Grab Lab</a><a href="./" aria-current="page">Unity Tutorial</a><a href="https://github.com/TrentSterling/pid">GitHub <span aria-hidden="true">↗</span></a></nav>
    </header>

    <section class="hero" aria-labelledby="tutorial-title">
      <div class="hero-copy">
        <p class="eyebrow">THE UNITY FIELD GUIDE <span aria-hidden="true">/</span> 01</p>
        <h1 id="tutorial-title">${escape(title)}<span>${escape(subtitle)}</span></h1>
        <div class="guide-meta"><span>Unity 6 + OpenXR</span><span>${readingMinutes} min read</span><span>6 runtime scripts + Editor tools</span></div>
        <div class="hero-actions"><a class="button primary" href="../downloads/TrontPhysicsGym-Unity.zip" download><span aria-hidden="true">↓</span> Download Unity kit</a><a class="button secondary" href="../vr/">Open WebXR demo <span aria-hidden="true">↗</span></a></div>
      </div>
      <aside class="experiment-card" aria-labelledby="experiment-title">
        <p class="eyebrow">ONE OBJECT. SAME GRIP.</p>
        <h2 id="experiment-title">Feel the controller change.</h2>
        <ol><li><span>01</span><div><b>Build the scene</b><p>Generate a small VR playground from the included C# kit.</p></div></li><li><span>02</span><div><b>Keep holding the cube</b><p>Switch CJ, relative PD, and backward PD without dropping it.</p></div></li><li><span>03</span><div><b>Test it against a wall</b><p>Compare tracking, reaction, and recovery in your headset.</p></div></li></ol>
      </aside>
    </section>

    <details class="mobile-toc"><summary>On this page <span>${chapters.length} sections</span></summary><nav aria-label="Mobile table of contents">${tableOfContents()}</nav></details>

    <div class="document-layout">
      <aside class="sidebar"><div class="sidebar-inner"><nav aria-label="Table of contents"><p class="eyebrow">ON THIS PAGE</p>${tableOfContents()}</nav><div class="sidebar-links"><a href="../vr/">Try the Grab Lab <span aria-hidden="true">↗</span></a><a href="./tutorial.md" download>Download this guide <span aria-hidden="true">↓</span></a><p>Read the explanation, then test the feel.</p></div></div></aside>
      <main id="tutorial-content" class="doc-body" tabindex="-1" aria-label="Complete Unity VR tutorial">
${article}
        <div class="next-step"><div><span class="eyebrow">TAKE IT INTO THE LAB</span><h2>Same object. Your verdict.</h2><p>Keep your grip, switch the controller, and compare the response.</p></div><a class="button primary" href="../vr/">Open Grab Lab <span aria-hidden="true">↗</span></a></div>
      </main>
    </div>

    <footer class="footer"><div><b>PHYSICS GYM / TRONT</b><p>Trent Sterling + ChatGPT · Ducky / Duck (SCUG) · FireBlast</p><p>Primary technical inspiration: <a href="https://digitalopus.ca/site/pd-controllers/">Digital Opus</a>. Locomotion source: <a href="https://github.com/Another-Axiom/GorillaLocomotion">Another Axiom</a>.</p></div><nav aria-label="Footer navigation"><a href="../downloads/TrontPhysicsGym-Unity.zip" download>Unity starter kit</a><a href="https://github.com/TrentSterling/pid">Source + licenses</a><a href="#tutorial-title">Back to top ↑</a></nav></footer>
  </div>
  <p class="sr-only" id="copy-status" role="status" aria-live="polite"></p>
  <script>
    (() => {
      const status = document.getElementById('copy-status');
      document.querySelectorAll('[data-copy-code]').forEach(button => {
        button.hidden = false;
        button.addEventListener('click', async () => {
          const code = document.getElementById(button.dataset.copyCode);
          try {
            if (!navigator.clipboard) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(code.textContent);
            button.textContent = 'Copied';
            status.textContent = 'Code example copied to clipboard.';
          } catch {
            const range = document.createRange();
            range.selectNodeContents(code);
            const selection = window.getSelection();
            selection.removeAllRanges(); selection.addRange(range);
            button.textContent = 'Code selected';
            status.textContent = 'Code selected. Use your browser copy command.';
          }
          window.setTimeout(() => { button.textContent = 'Copy code'; }, 2000);
        });
      });

      const headings = Array.from(document.querySelectorAll('.doc-body > h2[id]'));
      const links = Array.from(document.querySelectorAll('[data-chapter]'));
      const progress = document.getElementById('reading-progress');
      let queued = false;
      function updateReadingPosition() {
        queued = false;
        let current = headings[0]?.id;
        for (const heading of headings) {
          if (heading.getBoundingClientRect().top <= 160) current = heading.id;
          else break;
        }
        for (const link of links) {
          const active = link.dataset.chapter === current;
          link.classList.toggle('is-active', active);
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        }
        const maximum = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = 'scaleX(' + (maximum > 0 ? Math.min(1, Math.max(0, window.scrollY / maximum)) : 0) + ')';
      }
      function scheduleUpdate() {
        if (!queued) { queued = true; window.requestAnimationFrame(updateReadingPosition); }
      }
      window.addEventListener('scroll', scheduleUpdate, { passive: true });
      window.addEventListener('resize', scheduleUpdate, { passive: true });
      document.querySelectorAll('.mobile-toc a').forEach(link => link.addEventListener('click', () => {
        document.querySelector('.mobile-toc').open = false;
      }));
      updateReadingPosition();
    })();
  </script>
</body>
</html>
`;

if (process.argv.includes('--check')) {
  const existing = await readFile(outputPath, 'utf8').catch(() => '');
  if (existing !== html) {
    console.error('tutorial/index.html is stale. Run node scripts/build-tutorial.mjs.');
    process.exitCode = 1;
  } else console.log(`Tutorial is current: ${chapters.length} chapters, ${tableCount} tables, ${codeCount} code examples.`);
} else {
  await writeFile(outputPath, html);
  console.log(`Built tutorial/index.html: ${chapters.length} chapters, ${tableCount} tables, ${codeCount} code examples.`);
}
