// ==UserScript==
// @name         X Post Deleter (Auto-scroll and Stop)
// @namespace    local.x.session.delete
// @version      1.2.0
// @description  Type delete to automatically load and delete your own posts, quote posts, and replies. Stop at any time.
// @match        https://x.com/*
// @match        https://www.x.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('local-x-delete-panel')) return;
  const host = document.createElement('div');
  host.id = 'local-x-delete-panel';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `
    <style>
      :host {all:initial; position:fixed; right:16px; bottom:16px; z-index:2147483647;
        font:14px/1.5 system-ui,sans-serif; color:#e7e9ea; width:370px; max-width:calc(100vw - 32px)}
      * {box-sizing:border-box} section {background:#15202b;border:1px solid #536471;
        border-radius:14px;padding:16px;box-shadow:0 6px 24px #0008;max-height:88vh;overflow:auto}
      h2 {font-size:18px;margin:0 0 8px} p {margin:8px 0} small {color:#b4c0ca}
      input[type=text],input[type=number] {background:#06111b;color:white;border:1px solid #647887;
        border-radius:6px;padding:7px;width:100%;margin:4px 0 8px}
      button {border:0;border-radius:7px;padding:9px 12px;margin:4px 4px 4px 0;
        background:#d7e8f7;color:#102536;font-weight:600;cursor:pointer}
      button:disabled {opacity:.4;cursor:default} #run {background:#d93949;color:white}
      #stop {background:#ffda72}
      a {color:#8ac9ff} #log {white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;
        max-height:140px;overflow:auto;background:#09141e;padding:8px;border-radius:6px}
      #status {font-weight:600} #mini {display:none} :host(.folded) section {display:none}
      :host(.folded) #mini {display:block;float:right} label {display:block}
    </style>
    <button id="mini">Open X Post Deleter</button>
    <section>
      <h2>X Post Deleter</h2>
      <small>Permanently delete all discoverable posts, quote posts, and replies. Download your X archive first. Ordinary reposts are skipped.</small>
      <label>Your username (without @)<input id="handle" type="text" autocomplete="off" placeholder="Your username"></label>
      <p><small>Open your <a id="replies" href="https://x.com/">Replies tab</a> before starting. The tool automatically scrolls to find older posts.</small></p>
      <label>Delay between posts (0–120 seconds)<input id="delay" type="number" min="0" max="120" step="any" value="0"></label>
      <small>0 adds no extra delay. Each operation still waits for X to respond. Processing stops if X reports an error or limit.</small>
      <p id="status" role="status">Ready. Type delete to authorize permanent deletion.</p>
      <label>Type delete to confirm permanent deletion of ALL your discoverable posts<input id="confirm" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="delete"></label>
      <button id="run" disabled>Delete all posts</button><button id="stop" disabled>Stop now</button><button id="fold">Minimize</button>
      <p><small>Keep this tab in the foreground while running. Do not scroll, switch accounts, or use other menus. Stopping cannot undo deletion requests already submitted.</small></p>
      <div id="log" role="log" aria-live="polite">This tool does not read passwords, call private APIs, or send data to external services.</div>
    </section>`;
  document.documentElement.append(host);
  const $ = id => ui.getElementById(id);
  let session = null;
  let running = false;
  let stopped = false;
  let submitted = 0;
  const cleanHandle = value => value.trim().replace(/^@/, '').toLowerCase();
  const validHandle = value => /^[a-z0-9_]{1,15}$/.test(value);
  const visible = el => !!el && el.getClientRects().length > 0;
  const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const owned = (article, selector) => [...article.querySelectorAll(selector)]
    .filter(el => el.closest('article') === article);
  function log(message) {
    $('log').textContent += `\n${new Date().toLocaleTimeString()} ${message}`;
    $('log').scrollTop = $('log').scrollHeight;
  }
  function account() {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const m = link && new URL(link.href).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (!m) throw new Error('Cannot identify the signed-in account. Expand the left navigation on X, check that you are signed in, and try again.');
    return m[1].toLowerCase();
  }
  function context(handle) {
    if (!validHandle(handle) || account() !== handle) throw new Error('The entered username does not match the signed-in account.');
    const path = location.pathname.replace(/\/$/, '').toLowerCase();
    if (path !== `/${handle}/with_replies`) {
      throw new Error('Open the Replies tab on your own profile first so posts and replies are both included.');
    }
    return path;
  }
  function info(article) {
    // Timestamp permalinks are used instead of arbitrary status links inside quoted posts.
    const time = owned(article, 'time')[0];
    const permalink = time?.closest('a[href]');
    if (!permalink || !article.contains(permalink)) return null;
    const match = new URL(permalink.href).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    if (!match) return null;
    const author = owned(article, '[data-testid="User-Name"]')[0];
    const authorMatches = author && [...author.querySelectorAll('a[href]')].some(a =>
      new URL(a.href).pathname.toLowerCase().replace(/\/$/, '') === `/${match[1].toLowerCase()}`);
    if (!authorMatches) return null;
    // Keep pinned own posts, but conservatively skip other social-context cards.
    const social = owned(article, '[data-testid="socialContext"]');
    if (social.some(el => !/^(pinned|\u7f6e\u9802|\u7f6e\u9876)$/i.test(text(el)))) return null;
    if (!owned(article, '[data-testid="caret"]').length) return null;
    return { id: match[2], handle: match[1].toLowerCase(),
      url: `https://x.com/${match[1]}/status/${match[2]}`,
      date: time.getAttribute('datetime') || text(time),
      snippet: text(owned(article, '[data-testid="tweetText"]')[0]).slice(0, 180) || '(Image, video, or post without text)' };
  }
  function articles() {
    return [...document.querySelectorAll('[data-testid="primaryColumn"] article[data-testid="tweet"]')];
  }
  function locate(item) {
    return articles().find(article => {
      const data = info(article);
      return data && data.id === item.id && data.handle === item.handle;
    });
  }
  function validDelay() {
    const value = $('delay').value;
    const seconds = Number(value);
    return value.trim() !== '' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 120;
  }
  function authorized() {
    return validHandle(cleanHandle($('handle').value)) && validDelay() && $('confirm').value === 'delete';
  }
  function update() {
    $('run').disabled = running || !authorized();
  }
  function invalidate() {
    if (running) return;
    $('confirm').value = '';
    $('status').textContent = 'Settings changed. Type delete to confirm again.';
    update();
  }
  function guard() {
    if (stopped) throw new Error('Stopped.');
    if (document.hidden) throw new Error('The tab is no longer in the foreground. Stopped.');
    if (!session || context(session.handle) !== session.path) throw new Error('The page has changed. Stopped.');
  }
  async function pause(ms) {
    const end = Date.now() + ms;
    do { guard(); await new Promise(resolve => setTimeout(resolve, Math.min(150, Math.max(0, end - Date.now())))); }
    while (Date.now() < end);
    guard();
  }
  async function until(read, timeout = 7000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      guard(); const result = read(); if (result) return result;
      await pause(150);
    }
    throw new Error('Timed out waiting for X. The interface may have changed, or there may be a network issue or action limit. Stopped; no automatic retry.');
  }
  const deleteLabels = new Set(['Delete', '\u522a\u9664', '\u5220\u9664']);
  const deleteItem = el => deleteLabels.has(text(el));
  function errorToast() {
    const alerts = [...document.querySelectorAll('[role="alert"], [data-testid="toast"]')].filter(visible);
    return alerts.map(text).find(t => /something went wrong|try again|rate limit|too many|failed|error|\u51fa\u932f|\u51fa\u9519|\u5931\u6557|\u5931\u8d25|\u7a0d\u5f8c\u518d\u8a66|\u7a0d\u540e\u518d\u8bd5|\u9650\u5236/i.test(t));
  }
  async function removeOne(item) {
    guard();
    if (document.querySelector('[role="dialog"], [role="menu"]')) throw new Error('A dialog or menu is already open on the page. Stopped.');
    let article = locate(item);
    if (!article) { log(`Skipped ${item.id}: no longer on the page. Start a new run after checking X.`); return false; }
    article.scrollIntoView({ block: 'center', behavior: 'instant' });
    await pause(400);
    article = locate(item);
    if (!article) throw new Error('The post was unloaded after scrolling. Start a new run after checking X.');
    const caret = owned(article, '[data-testid="caret"]').find(visible);
    if (!caret) throw new Error('Cannot find the menu button for this post. Stopped.');
    guard(); caret.click();
    const menu = await until(() => [...document.querySelectorAll('[role="menu"]')].find(visible));
    const choices = [...menu.querySelectorAll('[role="menuitem"]')].filter(el => visible(el) && deleteItem(el));
    if (choices.length !== 1) throw new Error('Could not find exactly one Delete option. This may not be your post, or the interface language may be unsupported. Stopped.');
    guard(); choices[0].click();
    const confirm = await until(() => {
      const buttons = [...document.querySelectorAll('[data-testid="confirmationSheetConfirm"]')].filter(visible);
      return buttons.length === 1 && buttons[0];
    });
    if (!deleteItem(confirm) || !confirm.closest('[role="dialog"], [role="alertdialog"]')) {
      throw new Error('The deletion confirmation dialog does not match the expected format. Stopped.');
    }
    // Recheck ownership, page, and cancellation immediately before the irreversible click.
    if (!locate(item)) throw new Error('Cannot identify the target post again before confirmation. Stopped.');
    guard(); confirm.click(); submitted++;
    log(`Deletion request submitted for ${item.id}.`);
    await until(() => {
      const failure = errorToast(); if (failure) throw new Error(`X reported: ${failure}`);
      return !confirm.isConnected && !locate(item);
    }, 12000);
    log(`${item.id} has been removed from the page. Refresh after this run to verify.`);
    return true;
  }
  async function deleteAll(seconds) {
    const processed = new Set();
    let quietBottom = 0;
    let scans = 0;
    window.scrollTo({ top: 0, behavior: 'instant' });
    await pause(2500);
    while (true) {
      guard();
      const failure = errorToast();
      if (failure) throw new Error(`X reported: ${failure}`);
      // Rediscover after every deletion: X virtualizes its timeline and unloads cards.
      const item = articles().map(info).find(data => data && data.handle === session.handle && !processed.has(data.id));
      if (item) {
        $('status').textContent = `Deleting all: ${submitted} requests submitted; scanning for more posts.`;
        if (!await removeOne(item)) throw new Error('A discovered post was unloaded before deletion. Stopped; check X and start a new run.');
        processed.add(item.id);
        scans = 0;
        quietBottom = 0;
        if (seconds > 0) await pause(seconds * 1000);
        continue;
      }
      const root = document.scrollingElement || document.documentElement;
      const before = root.scrollTop;
      const height = root.scrollHeight;
      const signature = articles().map(article => owned(article, 'time')[0]?.closest('a[href]')?.href || '').join('|');
      root.scrollBy({ top: Math.max(300, window.innerHeight * 0.7), behavior: 'instant' });
      await pause(2500);
      const afterSignature = articles().map(article => owned(article, 'time')[0]?.closest('a[href]')?.href || '').join('|');
      const atBottom = root.scrollTop + window.innerHeight >= root.scrollHeight - 20;
      const loading = [...document.querySelectorAll('[data-testid="primaryColumn"] [role="progressbar"]')].some(visible);
      quietBottom = atBottom && !loading && root.scrollTop === before && root.scrollHeight === height && signature === afterSignature ? quietBottom + 1 : 0;
      $('status').textContent = `Deleting all: ${submitted} requests submitted; loading older posts (${quietBottom}/6 end checks).`;
      if (quietBottom >= 6) {
        log('Scan ended: X exposed no more eligible posts after repeated bottom checks. This does not prove your entire history is empty. Refresh your profile and verify; X may stop exposing older posts.');
        return;
      }
      // A stuck loader or changing page must not create an unbounded empty scan.
      if (++scans >= 120) throw new Error('No eligible posts found after 120 scroll checks. Stopped; refresh and check X before starting again.');
    }
  }
  async function run() {
    if (running || !authorized()) return;
    const handle = cleanHandle($('handle').value);
    const seconds = Number($('delay').value);
    try {
      const path = context(handle);
      if (document.hidden) throw new Error('Keep this tab in the foreground before starting.');
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) throw new Error('Close any open dialogs or menus on X first.');
      session = { handle, path };
    } catch (error) { log(error.message); return; }
    running = true; stopped = false; submitted = 0;
    for (const id of ['handle', 'delay', 'confirm']) $(id).disabled = true;
    $('confirm').value = '';
    $('stop').disabled = false; update();
    log(`Starting deletion of all discoverable posts, quote posts, and replies by @${handle}. Extra delay: ${seconds} seconds.`);
    let outcome = 'Stopped';
    try {
      guard();
      await deleteAll(seconds);
      outcome = 'Finished';
    } catch (error) { log(error.message); }
    finally {
      running = false; stopped = true;
      for (const id of ['handle', 'delay', 'confirm']) $(id).disabled = false;
      $('stop').disabled = true;
      session = null; $('confirm').value = '';
      $('status').textContent = `${outcome}; ${submitted} deletion requests submitted. Refresh to verify.`;
      update();
    }
  }
  $('run').addEventListener('click', run);
  $('stop').addEventListener('click', () => { stopped = true; log('Stop requested; no further actions will be submitted. Manually cancel any pending confirmation dialog on X.'); });
  $('fold').addEventListener('click', () => host.classList.add('folded'));
  $('mini').addEventListener('click', () => host.classList.remove('folded'));
  $('confirm').addEventListener('input', update);
  $('confirm').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); run(); }
  });
  $('handle').addEventListener('input', () => { invalidate(); updateRepliesLink(); });
  $('delay').addEventListener('input', invalidate);
  function updateRepliesLink() {
    const handle = cleanHandle($('handle').value);
    $('replies').href = validHandle(handle) ? `https://x.com/${handle}/with_replies` : 'https://x.com/';
  }
  document.addEventListener('visibilitychange', () => { if (running && document.hidden) stopped = true; });
  document.addEventListener('keydown', event => { if (running && event.key === 'Escape') stopped = true; }, true);
  try { $('handle').value = account(); } catch { /* User may log in after injection. */ }
  updateRepliesLink();
  update();
})();
