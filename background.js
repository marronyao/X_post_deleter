'use strict';

// Only explicit, bounded verification passes may continue across navigation.
// Manual reloads of an active pass never silently reauthorize a run.
const ACTIVE = new Set(['starting', 'running', 'stopping']);
let queue = Promise.resolve();
const serialized = task => {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
};
const getJob = async () => (await chrome.storage.session.get('job')).job || null;
const saveJob = async job => { await chrome.storage.session.set({ job }); return job; };
function source(sender) {
  if (!sender.tab || sender.frameId !== 0) throw new Error('A top-level X tab is required.');
  const url = new URL(sender.url);
  if (url.protocol !== 'https:' || !['x.com', 'www.x.com'].includes(url.hostname)) throw new Error('An X page is required.');
  return url;
}
const snapshot = job => job && ({
  id: job.id, handle: job.handle, seconds: job.seconds, workerTabId: job.workerTabId,
  status: job.status, submitted: job.submitted, message: job.message,
  timeline: job.timeline, route: job.route, pass: job.pass
});
async function handleMessage(message, sender) {
  const url = source(sender);
  let job = await getJob();
  if (message.type === 'START_RUN') {
    if (job && ACTIVE.has(job.status)) throw new Error('A deletion run is already active. Stop it before starting another.');
    const handle = message.handle;
    const seconds = message.seconds;
    if (!/^[a-z0-9_]{1,15}$/.test(handle) || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new Error('Invalid account or delay.');
    const path = url.pathname.toLowerCase().replace(/\/$/, '');
    if (![ `/${handle}`, `/${handle}/all`, `/${handle}/with_replies` ].includes(path)) throw new Error('Start from your own Posts/All or Replies tab.');
    job = {
      id: crypto.randomUUID(), handle, seconds, sourceTabId: sender.tab.id,
      workerTabId: null, status: 'starting', submitted: 0,
      timeline: 'all', route: `/${handle}/all`, pass: 1,
      passStart: 0, cleanPasses: 0,
      message: 'Opening a background deletion tab.'
    };
    await saveJob(job);
    try {
      const tab = await chrome.tabs.create({url: `https://x.com${job.route}`, active: false});
      job.workerTabId = tab.id;
      await saveJob(job);
      // Best effort: Chrome can still suspend tabs or stop execution on shutdown.
      await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
    } catch (error) {
      job.status = 'stopped'; job.message = error.message;
      await saveJob(job);
      throw error;
    }
    return { job: snapshot(job) };
  }
  if (!job || ![job.sourceTabId, job.workerTabId].includes(sender.tab.id)) return { job: null };
  if (message.type === 'CLAIM_RUN') {
    if (sender.tab.id !== job.workerTabId) return { job: snapshot(job) };
    if (job.status !== 'starting') {
      // Reloading the worker must never silently reauthorize deletion.
      if (ACTIVE.has(job.status)) {
        job.status = 'stopped'; job.message = 'The deletion tab was reloaded. Start a new run to continue.';
        await saveJob(job);
      }
      return { job: snapshot(job) };
    }
    const path = url.pathname.toLowerCase().replace(/\/$/, '');
    const expected = job.route || `/${job.handle}/with_replies`;
    if (path !== expected && !(job.timeline === 'all' && path === `/${job.handle}`)) throw new Error('Unexpected deletion-tab URL.');
    job.status = 'running'; job.message = 'Waiting for the signed-in account and timeline.';
    await saveJob(job);
    return { job: snapshot(job), claim: true };
  }
  if (message.type === 'NEXT_PASS') {
    if (sender.tab.id !== job.workerTabId || message.id !== job.id || job.status !== 'running') throw new Error('No active authorized verification pass.');
    if (!Number.isInteger(message.submitted) || message.submitted < job.submitted) throw new Error('Invalid deletion count.');
    const progress = message.submitted > job.passStart;
    if (message.batchLimit && !progress) throw new Error('Cannot reload without deletion progress.');
    job.submitted = message.submitted;
    job.cleanPasses = progress ? 0 : job.cleanPasses + 1;
    if (job.cleanPasses >= 4) {
      job.status = 'finished';
      job.message = 'Fresh Posts/All and Replies timelines checked twice without further deletions. Unavailable history cannot be verified.';
      return {job: snapshot(await saveJob(job))};
    }
    // Alternate full scans; a 25-deletion chunk reloads the same feed first.
    if (!message.batchLimit) job.timeline = job.timeline === 'all' ? 'replies' : 'all';
    job.route = job.timeline === 'all' ? `/${job.handle}/all` : `/${job.handle}/with_replies`;
    job.pass++;
    job.passStart = job.submitted;
    job.status = 'starting';
    job.message = `Loading fresh ${job.timeline} pass ${job.pass}; ${job.cleanPasses}/4 clean verification passes.`;
    await saveJob(job);
    try {
      // update(url) may be a no-op for the identical URL, so explicitly reload.
      if (url.pathname.toLowerCase().replace(/\/$/, '') === job.route) await chrome.tabs.reload(job.workerTabId);
      else await chrome.tabs.update(job.workerTabId, {url: `https://x.com${job.route}`});
    } catch (error) {
      job.status = 'stopped'; job.message = `Cannot load verification pass: ${error.message}`;
      await saveJob(job);
      throw error;
    }
    return {job: snapshot(job), continue: true};
  }
  if (message.type === 'STOP_RUN' && message.id === job.id && ACTIVE.has(job.status)) {
    job.status = 'stopping'; job.message = 'Stop requested. No further deletion should be submitted.';
    await saveJob(job);
    try { await chrome.tabs.sendMessage(job.workerTabId, {type: 'STOP_RUN', id: job.id}); }
    catch { job.status = 'stopped'; job.message = 'Stopped before the deletion tab became ready.'; await saveJob(job); }
  }
  if (message.type === 'REPORT_RUN' && sender.tab.id === job.workerTabId && message.id === job.id) {
    if (Number.isInteger(message.submitted) && message.submitted >= job.submitted) job.submitted = message.submitted;
    if (typeof message.message === 'string') job.message = message.message.slice(0, 1200);
    // Only NEXT_PASS may declare completion after checking both feeds.
    if (message.status === 'stopped') job.status = 'stopped';
    await saveJob(job);
  }
  return { job: snapshot(job) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serialized(() => handleMessage(message, sender)).then(respond, error => respond({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  serialized(async () => {
    const job = await getJob();
    if (job && job.workerTabId === tabId && ACTIVE.has(job.status)) {
      job.status = 'stopped'; job.message = 'The deletion tab was closed. Start a new run to continue.';
      await saveJob(job);
    }
  });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading') return;
  serialized(async () => {
    const job = await getJob();
    if (job && job.workerTabId === tabId && ['running', 'stopping'].includes(job.status)) {
      job.status = 'stopped'; job.message = 'The deletion tab navigated or reloaded. Start a new run to continue.';
      await saveJob(job);
      await chrome.tabs.sendMessage(tabId, {type: 'STOP_RUN', id: job.id}).catch(() => {});
    }
  });
});
