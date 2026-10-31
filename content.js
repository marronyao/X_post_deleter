// X Post Deleter v1.3.1 — Chrome extension content script.

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
      <h2>X Post Deleter 1.3.1</h2>
      <small>Permanently delete all discoverable posts, quote posts, and replies. Download your X archive first. Ordinary reposts are skipped.</small>
      <p id="account" role="status">Your signed-in account will be detected automatically.</p>
      <p><small>Start from your own Posts or Replies tab. A separate background tab loads your posts and replies; you can browse elsewhere while it runs.</small></p>
      <label>Delay between posts (0–120 seconds)<input id="delay" type="number" min="0" max="120" step="any" value="0"></label>
      <small>0 adds no extra delay. Each operation still waits for X to respond. Processing stops if X reports an error or limit.</small>
      <p id="status" role="status">Ready. Type delete to authorize permanent deletion.</p>
      <label>Type delete to confirm permanent deletion of ALL your discoverable posts<input id="confirm" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="delete"></label>
      <button id="run" disabled>Delete all posts</button><button id="stop" disabled>Stop now</button><button id="fold">Minimize</button>
      <p><small>You may leave this page. Keep Chrome and the background deletion tab open. Do not interact with that tab or switch X accounts. Stopping cannot undo submitted requests.</small></p>
      <div id="log" role="log" aria-live="polite">This tool does not read passwords, call private APIs, or send data to external services.</div>
    </section>`;
  document.documentElement.append(host);
  const $ = id => ui.getElementById(id);
  let session = null;
  let running = false;
  let stopped = false;
  let submitted = 0;
  let remoteJob = null;
  let launching = false;
  let polling = null;
  const send = message => chrome.runtime.sendMessage(message).then(result => {
    if (result?.error) throw new Error(result.error);
    return result;
  });
  const validHandle = value => /^[a-z0-9_]{1,15}$/.test(value);
  const visible = el => !!el && el.getClientRects().length > 0;
  const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const owned = (article, selector) => [...article.querySelectorAll(selector)]
    .filter(el => el.closest('article') === article);
  function log(message) {
    $('log').textContent += `\n${new Date().toLocaleTimeString()} ${message}`;
    $('log').scrollTop = $('log').scrollHeight;
    if (session?.jobId) report(message);
  }
  function account() {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const m = link && new URL(link.href).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (!m) throw new Error('Cannot identify the signed-in account. Expand the left navigation on X, check that you are signed in, and try again.');
    return m[1].toLowerCase();
  }
  function context(handle) {
    if (!validHandle(handle) || account() !== handle) throw new Error('The signed-in account changed. Stopped.');
    const path = location.pathname.replace(/\/$/, '').toLowerCase();
    if (![ `/${handle}`, `/${handle}/all`, `/${handle}/with_replies` ].includes(path)) {
      throw new Error('Open the Posts or Replies tab on your own profile first.');
    }
    return path;
  }
  function permalinkData(article) {
    // The first timestamp belongs to the outer post, before any quoted card.
    const time = owned(article, 'time')[0];
    const permalink = time?.closest('a[href]');
    if (!permalink || !article.contains(permalink)) return null;
    const match = new URL(permalink.href).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    return match && {time, permalink, handle: match[1].toLowerCase(), id: match[2]};
  }
  function info(article) {
    const data = permalinkData(article);
    if (!data) return null;
    const author = owned(article, '[data-testid="User-Name"]')[0];
    const headerLinks = author ? [...author.querySelectorAll('a[href]')] : [];
    const profileLinks = headerLinks.length ? headerLinks : owned(article, 'a[href]').filter(a =>
      // Header/avatar profile links must precede the timestamp, not occur in a quote or body.
      !!(a.compareDocumentPosition(data.permalink) & 4));
    const authorMatches = profileLinks.some(a =>
      new URL(a.href).pathname.toLowerCase().replace(/\/$/, '') === `/${data.handle}`);
    if (!authorMatches) return null;
    // Unknown social labels must not hide own posts. Exclude recognizable reposts only.
    const social = owned(article, '[data-testid="socialContext"]');
    if (social.some(el => /repost|retweet|\u8f49\u767c|\u8f6c\u53d1|\u8f49\u5e16|\u8f6c\u5e16/i.test(text(el)))) return null;
    return {id: data.id, handle: data.handle, url: `https://x.com/${data.handle}/status/${data.id}`};
  }
  function articles() {
    // Current X layouts do not always keep the tweet or primaryColumn test IDs.
    const column = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main');
    const cards = column ? [...column.querySelectorAll('article')] : [];
    const fallback = cards.length ? cards : [...(document.querySelector('main')?.querySelectorAll('article') || [])];
    return fallback.filter(el => !el.parentElement?.closest('article'));
  }
  function caretFor(article) {
    const explicit = owned(article, '[data-testid="caret"]').filter(visible);
    if (explicit.length === 1) return explicit[0];
    const buttons = owned(article, 'button, [role="button"]').filter(el => visible(el) &&
      /^(more|\u66f4\u591a)$/i.test(el.getAttribute('aria-label') || text(el)));
    return buttons.length === 1 ? buttons[0] : null;
  }
  function emptyTimeline() {
    const column = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main');
    return !!column && [...column.querySelectorAll('[data-testid="emptyState"]')].some(el =>
      /hasn.t posted|haven.t posted|no posts yet|no replies yet|nothing to see here|\u5c1a\u672a.*\u767c|\u8fd8\u6ca1.*\u53d1/i.test(text(el)));
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
    return validDelay() && $('confirm').value === 'delete';
  }
  function update() {
    $('run').disabled = running || launching || !!(remoteJob && ['starting', 'running', 'stopping'].includes(remoteJob.status)) || !authorized();
  }
  function invalidate() {
    if (running) return;
    $('confirm').value = '';
    $('status').textContent = 'Settings changed. Type delete to confirm again.';
    update();
  }
  function guard() {
    if (stopped) throw new Error('Stopped.');
    if (!session || context(session.handle) !== session.path) throw new Error('The page has changed. Stopped.');
  }
  async function pause(ms) {
    guard();
    // A single timer avoids chains of tiny timers being heavily throttled in hidden tabs.
    await new Promise(resolve => setTimeout(resolve, ms));
    guard();
  }
  async function until(read, timeout = 7000) {
    const end = Date.now() + (document.hidden ? Math.max(timeout, 120000) : timeout);
    while (true) {
      guard();
      const result = read();
      if (result) return result;
      if (Date.now() >= end) break;
      await pause(250);
    }
    throw new Error('Timed out waiting for X. Stopped; check the deletion tab before starting again.');
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
    const caret = caretFor(article);
    if (!caret) throw new Error(`Cannot find a unique More menu for your post ${item.id}. Stopped; the interface needs inspection.`);
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
    await until(() => articles().length || emptyTimeline(), 15000);
    let seenCards = 0;
    const unresolved = new Set();
    const unsupported = new Set();
    while (true) {
      guard();
      const failure = errorToast();
      if (failure) throw new Error(`X reported: ${failure}`);
      // Rediscover after every deletion: X virtualizes its timeline and unloads cards.
      const cards = articles();
      seenCards = Math.max(seenCards, cards.length);
      const parsed = cards.map(article => ({article, data: info(article)}));
      for (const {article, data} of parsed) {
        const link = permalinkData(article);
        // A recognizable own permalink with no identity match is a parsing failure,
        // not evidence of an empty timeline. Recognizable reposts are the exception.
        const repost = owned(article, '[data-testid="socialContext"]').some(el => /repost|retweet|\u8f49\u767c|\u8f6c\u53d1|\u8f49\u5e16|\u8f6c\u5e16/i.test(text(el)));
        if (!link && !repost) unsupported.add(article);
        else unsupported.delete(article);
        if (link?.handle === session.handle && !data && !repost) unresolved.add(link.id);
        if (data) unresolved.delete(data.id);
      }
      const item = parsed.map(row => row.data).find(data => data && data.handle === session.handle && !processed.has(data.id));
      if (item) {
        $('status').textContent = `Deleting all: ${submitted} requests submitted; scanning for more posts.`;
        if (!await removeOne(item)) throw new Error('A discovered post was unloaded before deletion. Stopped; check X and start a new run.');
        processed.add(item.id);
        if (processed.size >= 25) {
          log('25 posts processed. Reloading a fresh timeline to avoid gaps from removed cards.');
          return {batchLimit: true};
        }
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
      const loading = [...document.querySelectorAll('main [role="progressbar"]')].some(visible);
      quietBottom = atBottom && !loading && root.scrollTop === before && root.scrollHeight === height && signature === afterSignature ? quietBottom + 1 : 0;
      $('status').textContent = `Deleting all: ${submitted} requests submitted; loading older posts (${quietBottom}/6 end checks).`;
      if (quietBottom >= 6) {
        if (unsupported.size) throw new Error(`Stopped: ${unsupported.size} post cards have an unsupported timestamp/permalink structure. The timeline is not verified empty.`);
        if (unresolved.size) throw new Error(`Stopped: ${unresolved.size} own posts could not be identified reliably (IDs: ${[...unresolved].slice(0, 5).join(', ')}). The timeline is not verified empty.`);
        if (!seenCards && !emptyTimeline()) throw new Error('No post cards or recognized empty state were loaded. Stopped; this is not a completed scan.');
        log(`This timeline pass reached the bottom (${seenCards} maximum loaded cards). Reloading and checking both Posts/All and Replies before completion.`);
        return {batchLimit: false};
      }
      // A stuck loader or changing page must not create an unbounded empty scan.
      if (++scans >= 120) throw new Error('No eligible posts found after 120 scroll checks. Stopped; refresh and check X before starting again.');
    }
  }
  function report(message, status) {
    if (!session?.jobId) return;
    return send({type: 'REPORT_RUN', id: session.jobId, submitted, message, status}).catch(() => {
      stopped = true;
    });
  }
  function showRemote(job) {
    remoteJob = job;
    if (!job) return;
    const active = ['starting', 'running', 'stopping'].includes(job.status);
    $('account').textContent = `Account: @${job.handle}`;
    $('status').textContent = `${job.status}: ${job.submitted} deletion requests submitted. ${job.message}`;
    $('stop').disabled = !active;
    $('delay').disabled = active;
    if (active) $('confirm').value = '';
    update();
    if (!active && polling) { clearInterval(polling); polling = null; }
  }
  async function poll() {
    try { const result = await send({type: 'GET_RUN'}); showRemote(result?.job); }
    catch (error) { log(error.message); }
  }
  function monitor() {
    if (!polling) polling = setInterval(poll, 2000);
  }
  async function run() {
    if (running || launching || !authorized() || (remoteJob && ['starting', 'running', 'stopping'].includes(remoteJob.status))) return;
    launching = true; update();
    try {
      const handle = account();
      context(handle);
      const result = await send({type: 'START_RUN', handle, seconds: Number($('delay').value)});
      $('confirm').value = '';
      showRemote(result.job); monitor();
      log(`Background deletion started for @${handle}. You may leave this page; keep the deletion tab open.`);
    } catch (error) { log(error.message); }
    finally { launching = false; update(); }
  }
  async function runWorker(job) {
    running = true; stopped = false; submitted = job.submitted || 0;
    session = {handle: job.handle, path: location.pathname.toLowerCase().replace(/\/$/, ''), jobId: job.id};
    $('account').textContent = `Deleting as @${job.handle} in this background tab`;
    $('confirm').value = ''; $('delay').value = String(job.seconds);
    $('delay').disabled = true; $('stop').disabled = false; update();
    let outcome = 'stopped';
    let continuing = false;
    try {
      // X's navigation can appear after document_idle, especially in inactive tabs.
      const deadline = Date.now() + 120000;
      while (true) {
        if (stopped) throw new Error('Stopped.');
        if (location.pathname.toLowerCase().replace(/\/$/, '') !== session.path) throw new Error('The deletion tab navigated away. Stopped.');
        let detected = null;
        try { detected = account(); } catch { /* Wait for X to finish loading. */ }
        if (detected && detected !== job.handle) throw new Error('The signed-in account does not match the authorized account. Stopped.');
        if (detected) break;
        if (Date.now() >= deadline) throw new Error('Cannot detect the signed-in account. Check the deletion tab and start again.');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      guard();
      log(`Deleting all discoverable posts, quote posts, and replies by @${job.handle}. Extra delay: ${job.seconds} seconds.`);
      const result = await deleteAll(job.seconds);
      guard();
      const next = await send({type: 'NEXT_PASS', id: job.id, submitted, batchLimit: !!result?.batchLimit});
      if (next?.error) throw new Error(next.error);
      if (next?.continue) { continuing = true; return; }
      if (next?.job?.status !== 'finished') throw new Error('Could not verify the next scan pass. Stopped.');
      outcome = 'finished';
    } catch (error) { log(error.message); }
    finally {
      if (!continuing) await report(outcome === 'finished' ? 'Verified fresh Posts/All and Replies timelines across four passes without further deletions. Unavailable history cannot be verified.' : $('log').textContent.split('\n').pop(), outcome);
      running = false; stopped = true;
      session = null; $('confirm').value = ''; $('delay').disabled = false; $('stop').disabled = true;
      $('status').textContent = continuing ? 'Loading a fresh verification pass in this deletion tab.' : `${outcome}; ${submitted} deletion requests submitted. Refresh to verify.`;
      update();
    }
  }
  async function stopRun() {
    stopped = true;
    log('Stop requested. No further deletion will be submitted. Cancel any pending X dialog manually.');
    const id = session?.jobId || remoteJob?.id;
    if (id) {
      try { const result = await send({type: 'STOP_RUN', id}); if (!running) showRemote(result.job); }
      catch (error) { log(error.message); }
    }
  }
  $('run').addEventListener('click', run);
  $('stop').addEventListener('click', stopRun);
  $('fold').addEventListener('click', () => host.classList.add('folded'));
  $('mini').addEventListener('click', () => host.classList.remove('folded'));
  $('confirm').addEventListener('input', update);
  $('confirm').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); run(); }
  });
  $('delay').addEventListener('input', invalidate);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (running || remoteJob)) stopRun();
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'STOP_RUN' && message.id === session?.jobId) {
      stopped = true;
      respond({stopped: true});
    }
  });
  async function initialize() {
    try {
      try { $('account').textContent = `Detected account: @${account()}`; } catch { /* Account is rechecked at Start. */ }
      const result = await send({type: 'CLAIM_RUN'});
      if (result?.claim) await runWorker(result.job);
      else if (result?.job) { showRemote(result.job); if (['starting', 'running', 'stopping'].includes(result.job.status)) monitor(); }
    } catch (error) { log(error.message); }
  }
  update();
  initialize();
})();
