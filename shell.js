// Physics Gym app shell.
//
// Every page under /pid/ is a real page with its own URL, and every one loads this
// script. The first page you land on becomes the host: it gets the shared tab bar and
// stays alive. Other pages open as views inside the host, are kept alive when you
// switch away, and get their frame loop paused while hidden. The address bar, back
// and forward buttons and direct links keep working because each view is its real URL.
//
// Classic script on purpose: it has to run before any page module so the frame-loop
// pause below is in place first.
(() => {
  'use strict';

  const script = document.currentScript;
  const BASE = new URL('./', script.src);
  const ROUTES = [
    { path: '', label: 'Controller gym', hint: 'PID and friends' },
    { path: 'vr/', label: 'Grab lab', hint: 'Hold things, WebXR' },
    { path: 'gtag/', label: 'Gorilla course', hint: 'Slap, pull, climb' },
    { path: 'gtag/ppo/', label: 'Monke PPO', hint: 'A net learns it' },
    { path: 'tutorial/', label: 'Unity tutorial', hint: 'Build it in C#' }
  ];
  const SOURCE = 'https://github.com/TrentSterling/pid';

  function routeOf(url) {
    const u = new URL(url, location.href);
    if (u.origin !== BASE.origin || !u.pathname.startsWith(BASE.pathname)) return null;
    const rest = u.pathname.slice(BASE.pathname.length).replace(/index\.html$/, '');
    return ROUTES.find((r) => r.path === rest) || null;
  }

  // ---- frame-loop pause -------------------------------------------------------
  // A hidden view should not keep rendering. Callbacks asked for while paused are
  // parked and handed to the real requestAnimationFrame when the view comes back.
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  let paused = false;
  let parkedId = -1;
  const parked = new Map();
  window.requestAnimationFrame = (cb) => {
    if (!paused) return realRaf(cb);
    parked.set(parkedId, cb);
    return parkedId--;
  };
  window.cancelAnimationFrame = (id) => {
    if (id < 0) parked.delete(id); else realCancel(id);
  };
  function setPaused(value) {
    if (paused === value) return;
    paused = value;
    if (!paused) {
      const waiting = [...parked.values()];
      parked.clear();
      for (const cb of waiting) realRaf(cb);
    }
    window.dispatchEvent(new CustomEvent('gym:visibility', { detail: { visible: !paused } }));
  }

  let host = null;
  try {
    if (window.parent !== window && window.parent.__gymShell) host = window.parent.__gymShell;
  } catch { host = null; }

  const root = document.documentElement;
  root.classList.add('gym-shell');

  const css = document.createElement('style');
  css.textContent = `
    .gym-shell .masthead{display:none!important}
    .gym-embedded,.gym-embedded body{scrollbar-width:thin}
    .gym-host body{padding-top:var(--gym-bar,52px)!important}
    .gym-shell .app-shell{padding-top:14px}
    .gym-host.gym-away body>:not(.gym-el){display:none!important}
    .gym-host.gym-away,.gym-host.gym-away body{overflow:hidden!important}
    .gym-bar{position:fixed;inset:0 0 auto 0;height:var(--gym-bar,52px);z-index:2147483000;display:flex;align-items:stretch;gap:4px;
      padding:0 14px;background:rgba(13,19,29,.94);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.09);
      font:600 13px/1.1 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#c9d4e3;box-sizing:border-box}
    .gym-bar *{box-sizing:border-box}
    .gym-brand{display:flex;align-items:center;gap:10px;padding-right:14px;margin-right:6px;color:#f2f6fb;text-decoration:none;
      letter-spacing:.14em;font-size:12px;font-weight:800;white-space:nowrap;border-right:1px solid rgba(255,255,255,.08)}
    .gym-brand i{display:flex;align-items:flex-end;gap:3px;height:20px}
    .gym-brand i b{display:block;width:4px;border-radius:2px;background:#67d8c5}
    .gym-brand small{display:block;margin-top:3px;font-size:9px;letter-spacing:.18em;color:#7f8da3;font-weight:700}
    .gym-tabs{display:flex;align-items:stretch;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}
    .gym-tabs::-webkit-scrollbar{display:none}
    .gym-tab{position:relative;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:0 14px;color:#9eabbf;
      text-decoration:none!important;white-space:nowrap;border-radius:8px 8px 0 0;transition:color .15s,background .15s}
    .gym-tab small{font-size:10px;font-weight:500;color:#66748a;letter-spacing:.02em}
    .gym-tab:hover{color:#f2f6fb;background:rgba(255,255,255,.04)}
    .gym-tab[aria-current=page]{color:#f2f6fb;background:rgba(103,216,197,.08)}
    .gym-tab[aria-current=page]::after{content:"";position:absolute;left:10px;right:10px;bottom:0;height:3px;border-radius:3px 3px 0 0;background:#67d8c5}
    .gym-tab[aria-current=page] small{color:#67d8c5}
    .gym-tab .gym-badge{display:inline-block;margin-left:7px;padding:2px 6px;border-radius:9px;background:#67d8c5;color:#0d131d;font-size:10px;font-weight:800;font-style:normal;vertical-align:1px}
    .gym-tab .gym-badge:empty{display:none}
    .gym-tab .gym-dot{display:inline-block;width:6px;height:6px;margin-left:6px;border-radius:50%;background:#67d8c5;opacity:0;vertical-align:middle}
    .gym-tab.gym-loaded .gym-dot{opacity:.55}
    .gym-src{display:flex;align-items:center;padding:0 6px 0 12px;color:#7f8da3;text-decoration:none;white-space:nowrap}
    .gym-src:hover{color:#f2f6fb}
    .gym-view{position:fixed;inset:var(--gym-bar,52px) 0 0 0;width:100%;height:calc(100% - var(--gym-bar,52px));border:0;background:#0d131d;z-index:2147482000}
    .gym-view[hidden]{display:block;visibility:hidden;pointer-events:none}
    .gym-loading{position:fixed;top:var(--gym-bar,52px);left:0;height:2px;width:100%;z-index:2147483001;background:linear-gradient(90deg,transparent,#67d8c5,transparent);
      background-size:40% 100%;background-repeat:no-repeat;animation:gym-load 1s linear infinite}
    .gym-loading[hidden]{display:none}
    @keyframes gym-load{from{background-position:-40% 0}to{background-position:140% 0}}
    @media (max-width:760px){.gym-bar{padding:0 8px}.gym-brand span{display:none}.gym-brand{padding-right:8px;margin-right:2px}.gym-tab{padding:0 10px}.gym-tab small{display:none}.gym-src{display:none}}
  `;
  document.head.appendChild(css);

  // ---- embedded view ----------------------------------------------------------
  if (host) {
    root.classList.add('gym-embedded');
    window.gymShell = {
      embedded: true,
      badge: (text) => host.badge(window, text),
      go: (url) => host.go(new URL(url, location.href).href)
    };
    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const a = event.target.closest && event.target.closest('a[href]');
      if (!a || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      const target = routeOf(url);
      if (a.target === '_blank' || !target) {
        if (!target && url.origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener'; }
        return;
      }
      if (target === routeOf(location.href)) return; // same view: let it handle its own hash or query
      event.preventDefault();
      host.go(url.href);
    });
    const report = () => host.sync(window);
    window.addEventListener('hashchange', report);
    window.addEventListener('DOMContentLoaded', report);
    window.addEventListener('load', report);
    host.adopt(window, setPaused);
    return;
  }

  // ---- host -------------------------------------------------------------------
  const hostRoute = routeOf(location.href);
  if (!hostRoute) return;
  root.classList.add('gym-host');
  const views = new Map(); // route.path -> { frame, win, pause, title }
  const hostTitle = document.title;
  let active = hostRoute;
  let bar, loading;
  const tabs = new Map();

  function hrefOf(route) { return new URL(route.path, BASE).href; }

  function build() {
    bar = document.createElement('nav');
    bar.className = 'gym-bar gym-el';
    bar.setAttribute('aria-label', 'Physics Gym sections');
    const brand = document.createElement('a');
    brand.className = 'gym-brand';
    brand.href = hrefOf(ROUTES[0]);
    brand.innerHTML = '<i aria-hidden="true"><b style="height:9px"></b><b style="height:18px"></b><b style="height:13px"></b><b style="height:20px"></b></i><span>PHYSICS GYM<small>TRONT LABS</small></span>';
    bar.appendChild(brand);
    const list = document.createElement('div');
    list.className = 'gym-tabs';
    for (const route of ROUTES) {
      const a = document.createElement('a');
      a.className = 'gym-tab';
      a.href = hrefOf(route);
      a.innerHTML = `<span>${route.label}<i class="gym-dot" aria-hidden="true"></i><em class="gym-badge"></em></span><small>${route.hint}</small>`;
      tabs.set(route.path, a);
      list.appendChild(a);
    }
    bar.appendChild(list);
    const src = document.createElement('a');
    src.className = 'gym-src';
    src.href = SOURCE; src.target = '_blank'; src.rel = 'noopener';
    src.textContent = 'Source ↗';
    bar.appendChild(src);
    loading = document.createElement('div');
    loading.className = 'gym-loading gym-el';
    loading.hidden = true;
    document.body.prepend(loading);
    document.body.prepend(bar);
    mark();
  }

  function mark() {
    for (const [path, a] of tabs) {
      if (path === active.path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      a.classList.toggle('gym-loaded', path !== active.path && (path === hostRoute.path || views.has(path)));
    }
    const tab = tabs.get(active.path);
    if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function show(route) {
    active = route;
    const away = route !== hostRoute;
    root.classList.toggle('gym-away', away);
    setPaused(away);
    for (const [path, view] of views) {
      const on = path === route.path;
      view.frame.hidden = !on;
      if (view.pause) view.pause(!on);
      if (on) { try { view.frame.contentWindow.focus(); } catch { /* not ready */ } }
    }
    if (!away) { window.focus(); window.dispatchEvent(new Event('resize')); }
    const view = views.get(route.path);
    document.title = away ? (view && view.title) || `${route.label} · Physics Gym` : hostTitle;
    loading.hidden = !(away && view && !view.ready);
    mark();
  }

  function go(url, push = true) {
    const target = new URL(url, location.href);
    const route = routeOf(target);
    if (!route) { location.href = target.href; return; }
    const sameRoute = route === active;
    if (route !== hostRoute) {
      let view = views.get(route.path);
      if (!view) {
        const frame = document.createElement('iframe');
        frame.className = 'gym-view gym-el';
        frame.title = route.label;
        frame.allow = 'xr-spatial-tracking; fullscreen; gamepad; accelerometer; gyroscope';
        frame.setAttribute('allowfullscreen', '');
        frame.src = target.href;
        view = { frame, pause: null, title: '', ready: false };
        views.set(route.path, view);
        document.body.appendChild(frame);
      } else {
        const now = new URL(view.frame.contentWindow.location.href);
        if (now.search !== target.search) view.frame.contentWindow.location.replace(target.href);
        else if (target.hash && now.hash !== target.hash) view.frame.contentWindow.location.hash = target.hash;
      }
    } else if (target.search !== location.search && sameRoute) {
      location.href = target.href; return;
    }
    if (push && target.href !== location.href) history.pushState({ gym: route.path }, '', target.href);
    show(route);
    if (route === hostRoute && target.hash) {
      const el = document.getElementById(decodeURIComponent(target.hash.slice(1)));
      if (el) el.scrollIntoView();
    }
  }

  function viewOf(win) {
    for (const [path, view] of views) if (view.frame.contentWindow === win) return [path, view];
    return [null, null];
  }

  window.__gymShell = {
    go,
    adopt(win, pause) {
      const [path, view] = viewOf(win);
      if (!view) return;
      view.pause = pause;
      pause(path !== active.path);
    },
    sync(win) {
      const [path, view] = viewOf(win);
      if (!view) return;
      view.ready = true;
      view.title = win.document.title;
      if (path !== active.path) return;
      loading.hidden = true;
      document.title = view.title || document.title;
      const inner = new URL(win.location.href);
      if (routeOf(inner) === active && (inner.search !== location.search || inner.hash !== location.hash)) {
        history.replaceState({ gym: path }, '', inner.href);
      }
    },
    badge(win, text) {
      const [path] = viewOf(win);
      const tab = tabs.get(path);
      if (tab) tab.querySelector('.gym-badge').textContent = text || '';
    }
  };
  window.gymShell = {
    embedded: false,
    go: (url) => go(new URL(url, location.href).href),
    badge(text) { const tab = tabs.get(hostRoute.path); if (tab) tab.querySelector('.gym-badge').textContent = text || ''; }
  };

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = event.target.closest && event.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    const route = routeOf(url);
    if (!route) return;
    if (route === hostRoute && active === hostRoute && url.search === location.search) return; // plain in-page link
    event.preventDefault();
    go(url.href);
  });
  window.addEventListener('popstate', () => go(location.href, false));

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
