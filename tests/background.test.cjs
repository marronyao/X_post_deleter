const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');

function fixture(initial) {
  let state = initial ? structuredClone(initial) : {};
  let listener, removed, updated;
  const tabs = [];
  const chrome = {
    storage: {session: {
      get: async () => structuredClone(state),
      set: async value => {state = structuredClone(value);}
    }},
    runtime: {onMessage: {addListener: fn => {listener = fn;}}},
    tabs: {
      create: async options => {tabs.push(options); return {id: 20};},
      update: async () => {}, reload: async () => {}, sendMessage: async () => ({stopped: true}),
      onRemoved: {addListener: fn => {removed = fn;}},
      onUpdated: {addListener: fn => {updated = fn;}}
    }
  };
  vm.runInNewContext(source, {chrome, URL, crypto: {randomUUID: () => 'job-1'}});
  const sender = (id = 10, route = '/owner') => ({tab: {id}, frameId: 0, url: `https://x.com${route}`});
  const message = (payload, from = sender()) => new Promise(resolve => listener(payload, from, resolve));
  const start = () => message({type: 'START_RUN', handle: 'owner', seconds: 0});
  return {chrome, tabs, sender, message, start, state: () => state,
    removed: id => removed(id), updated: (id, change) => updated(id, change)};
}

test('starting from Posts opens an inactive All tab and claim is bound to that tab', async () => {
  const f = fixture(); const result = await f.start();
  assert.equal(result.job.status, 'starting');
  assert.equal(f.tabs[0].active, false);
  assert.equal(f.tabs[0].url, 'https://x.com/owner/all');
  assert.equal((await f.message({type: 'CLAIM_RUN'}, f.sender(10))).claim, undefined);
  assert.equal((await f.message({type: 'CLAIM_RUN'}, f.sender(30))).job, null);
  assert.equal((await f.message({type: 'CLAIM_RUN'}, f.sender(20, '/owner/all'))).claim, true);
});
test('source tab may close or navigate without stopping the background job', async () => {
  const f = fixture(); await f.start();
  f.removed(10); f.updated(10, {status: 'loading'});
  const status = await f.message({type: 'GET_RUN'}, f.sender(10, '/home'));
  assert.equal(status.job.status, 'starting');
});
test('closing the deletion tab records a stopped run', async () => {
  const f = fixture(); await f.start(); f.removed(20);
  const result = await f.message({type: 'GET_RUN'});
  assert.equal(result.job.status, 'stopped');
});
test('reload never silently reauthorizes an already claimed deletion tab', async () => {
  const f = fixture(); await f.start();
  await f.message({type: 'CLAIM_RUN'}, f.sender(20, '/owner/all'));
  const second = await f.message({type: 'CLAIM_RUN'}, f.sender(20, '/owner/all'));
  assert.equal(second.claim, undefined); assert.equal(second.job.status, 'stopped');
});
test('navigation of the deletion tab stops the job', async () => {
  const f = fixture(); await f.start();
  await f.message({type: 'CLAIM_RUN'}, f.sender(20, '/owner/all'));
  f.updated(20, {status: 'loading'});
  assert.equal((await f.message({type: 'GET_RUN'})).job.status, 'stopped');
});
test('stop before claim prevents any automatic deletion', async () => {
  const f = fixture(); await f.start();
  await f.message({type: 'STOP_RUN', id: 'job-1'});
  const result = await f.message({type: 'CLAIM_RUN'}, f.sender(20, '/owner/all'));
  assert.equal(result.claim, undefined); assert.equal(result.job.status, 'stopped');
});
test('simultaneous starts create only one background tab', async () => {
  const f = fixture(); const results = await Promise.all([f.start(), f.start()]);
  assert.equal(f.tabs.length, 1);
  assert.match(results[1].error, /already active/);
});
test('only the worker may report completion and only matching job IDs are accepted', async () => {
  const f = fixture(); await f.start();
  await f.message({type: 'REPORT_RUN', id: 'job-1', status: 'finished', submitted: 99});
  assert.equal(f.state().job.status, 'starting');
  await f.message({type: 'REPORT_RUN', id: 'wrong', status: 'finished'}, f.sender(20));
  assert.equal(f.state().job.status, 'starting');
  await f.message({type: 'REPORT_RUN', id: 'job-1', status: 'finished', submitted: 2}, f.sender(20));
  assert.equal(f.state().job.status, 'starting'); assert.equal(f.state().job.submitted, 2);
});
test('worker suspension preserves job identity in session storage', async () => {
  const f = fixture(); await f.start();
  const restarted = fixture(f.state());
  const result = await restarted.message({type: 'CLAIM_RUN'}, restarted.sender(20, '/owner/all'));
  assert.equal(result.claim, true); assert.equal(result.job.handle, 'owner');
});
test('invalid origins, frames, routes and delays cannot launch a run', async () => {
  const f = fixture();
  for (const sender of [
    {...f.sender(), url: 'https://example.com/owner'},
    {...f.sender(), frameId: 1}, f.sender(10, '/someone')
  ]) {
    assert((await f.message({type: 'START_RUN', handle: 'owner', seconds: 0}, sender)).error);
  }
  assert((await f.message({type: 'START_RUN', handle: 'owner', seconds: -1})).error);
  assert.equal(f.tabs.length, 0);
});

test('requires four fresh alternating passes with no deletions before finishing', async () => {
  const f=fixture(); await f.start();
  for(let i=0;i<4;i++) {
    const job=f.state().job;
    await f.message({type:'CLAIM_RUN'},f.sender(20,job.route));
    const result=await f.message({type:'NEXT_PASS',id:'job-1',submitted:0,batchLimit:false},f.sender(20,job.route));
    assert.equal(result.job.status,i===3?'finished':'starting');
    assert.equal(!!result.continue,i!==3);
    if(i<3) assert.notEqual(result.job.route,job.route);
  }
});
test('new deletions reset verification; checkpoint reloads same timeline', async () => {
  const f=fixture(); await f.start();
  await f.message({type:'CLAIM_RUN'},f.sender(20,'/owner/all'));
  await f.message({type:'NEXT_PASS',id:'job-1',submitted:0,batchLimit:false},f.sender(20,'/owner/all'));
  await f.message({type:'CLAIM_RUN'},f.sender(20,'/owner/with_replies'));
  const result=await f.message({type:'NEXT_PASS',id:'job-1',submitted:25,batchLimit:true},f.sender(20,'/owner/with_replies'));
  assert.equal(f.state().job.cleanPasses,0);
  assert.equal(result.job.route,'/owner/with_replies');
  assert.equal(result.job.submitted,25);
});
test('controlled navigation survives onUpdated, but stop blocks the next claim', async () => {
  const f=fixture(); await f.start();
  await f.message({type:'CLAIM_RUN'},f.sender(20,'/owner/all'));
  await f.message({type:'NEXT_PASS',id:'job-1',submitted:1,batchLimit:false},f.sender(20,'/owner/all'));
  f.updated(20,{status:'loading'});
  assert.equal((await f.message({type:'GET_RUN'})).job.status,'starting');
  await f.message({type:'STOP_RUN',id:'job-1'});
  assert.equal((await f.message({type:'CLAIM_RUN'},f.sender(20,'/owner/with_replies'))).claim,undefined);
});
