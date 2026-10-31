const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
function fixture() {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {value:'', checked:false, disabled:false, textContent:'',
      addEventListener(){}, replaceChildren(){}, append(){}});
    return elements.get(id);
  };
  const ui = {innerHTML:'', getElementById:$};
  const host = {attachShadow:() => ui};
  const document = {hidden:false, getElementById:() => null, createElement:() => host,
    documentElement:{append(){}}, querySelector:() => null, querySelectorAll:() => [], addEventListener(){}};
  const window = {innerHeight:800, scrollTo(){}, confirm:() => true};
  window.self = window; window.top = window;
  const sandbox = {window, document, location:{pathname:'/owner/with_replies'}, URL, setTimeout, console};
  const expose = `globalThis.api = {deleteAll, update, guard, run, invalidate, authorized,
    configure(code) { eval(code); }};`;
  vm.runInNewContext(source.replace('const owned =', 'let owned =').replace(/\}\)\(\);\s*$/, expose + '})();'), sandbox);
  return {sandbox, $, document, window, ui, api:sandbox.api};
}
function scanFixture() {
  const f = fixture();
  f.api.configure(`session = {handle:'owner', path:'/owner/with_replies'};
    stopped = false; context = () => session.path;
    globalThis.rows = []; globalThis.deleted = []; globalThis.ticks = 0;
    globalThis.loading = false;
    info = x => x; articles = () => rows; owned = () => [];
    pause = async () => { guard(); ticks++; };
    removeOne = async item => { guard(); deleted.push(item.id); submitted++; rows = rows.filter(x => x.id !== item.id); return true; };
    errorToast = () => null;`);
  const root = {scrollTop:0, scrollHeight:800, scrollBy(){}};
  f.document.scrollingElement = root;
  return {...f, root};
}
test('only exact lowercase delete authorizes starting without a preview', () => {
  const f=fixture(); f.$('handle').value='owner'; f.$('delay').value='0';
  for (const value of ['', 'DELETE', 'delete ', 'DELETE ALL @owner']) {
    f.$('confirm').value=value; f.api.update(); assert.equal(f.$('run').disabled,true);
  }
  f.$('confirm').value='delete'; f.api.update(); assert.equal(f.$('run').disabled,false);
  assert(!f.ui.innerHTML.includes('id="preview"'));
  assert(!f.ui.innerHTML.includes('id="ack"'));
  assert(f.ui.innerHTML.includes('min="0" max="120" step="any" value="0"'));
});
test('run refuses Posts tab without submitting a deletion', async () => {
  const f=fixture(); f.$('handle').value='owner'; f.$('delay').value='0'; f.$('confirm').value='delete';
  f.document.querySelector=() => ({href:'https://x.com/owner'});
  f.sandbox.location.pathname='/owner';
  await f.api.run();
  assert.match(f.$('log').textContent,/Replies tab/);
});
test('invalid delay disables starting, including blank, negative and excessive values', () => {
  const f=fixture(); f.$('handle').value='owner'; f.$('confirm').value='delete';
  for (const value of ['', '-1', '121', 'NaN', 'Infinity']) {
    f.$('delay').value=value; f.api.update(); assert.equal(f.$('run').disabled,true);
  }
  for (const value of ['0','0.5','120']) {
    f.$('delay').value=value; f.api.update(); assert.equal(f.$('run').disabled,false);
  }
});
test('changing settings clears the confirmation', () => {
  const f=fixture(); f.$('handle').value='owner'; f.$('delay').value='0'; f.$('confirm').value='delete';
  f.api.invalidate(); assert.equal(f.$('confirm').value,''); assert.equal(f.$('run').disabled,true);
});
test('discovers later posts automatically and ignores another author', async () => {
  const f=scanFixture(); f.sandbox.rows=[{id:'1', handle:'owner'},{id:'other',handle:'someone'}];
  let scrolls=0;
  f.root.scrollBy=()=>{ if (++scrolls===2) f.sandbox.rows.push({id:'2',handle:'owner'}); };
  await f.api.deleteAll(12);
  assert.deepEqual(Array.from(f.sandbox.deleted),['1','2']);
  assert(scrolls>=8);
  assert.match(f.$('log').textContent,/does not prove your entire history is empty/);
});
test('does not delete the same ID again when it reappears', async () => {
  const f=scanFixture(); f.sandbox.rows=[{id:'1',handle:'owner'}];
  f.root.scrollBy=()=>{ f.sandbox.rows=[{id:'1',handle:'owner'}]; };
  await f.api.deleteAll(8);
  assert.deepEqual(Array.from(f.sandbox.deleted),['1']);
});
test('stop prevents deletion', async () => {
  const f=scanFixture(); f.sandbox.rows=[{id:'1',handle:'owner'}];
  f.api.configure('stopped = true');
  await assert.rejects(f.api.deleteAll(12),/Stopped/);
  assert.equal(f.sandbox.deleted.length,0);
});
test('background tab and account changes stop processing', async () => {
  const f=scanFixture(); f.document.hidden=true;
  await assert.rejects(f.api.deleteAll(12),/foreground/);
  f.document.hidden=false; f.api.configure("context = () => {throw new Error('account changed')}");
  await assert.rejects(f.api.deleteAll(12),/account changed/);
});
test('X errors stop scanning without deletion retry', async () => {
  const f=scanFixture(); f.api.configure("errorToast = () => 'Rate limit exceeded'");
  await assert.rejects(f.api.deleteAll(12),/Rate limit/);
  assert.equal(f.sandbox.deleted.length,0);
});
test('stuck loading indicator stops after bounded empty scans', async () => {
  const f=scanFixture(); f.document.querySelectorAll=()=>[{getClientRects:()=>[{}]}];
  await assert.rejects(f.api.deleteAll(12),/120 scroll checks/);
});
test('run cleans up after an error and reports Stopped', async () => {
  const f=scanFixture(); f.$('handle').value='owner'; f.$('delay').value='0'; f.$('confirm').value='delete';
  f.api.configure("deleteAll = async () => {throw new Error('test failure')}");
  await f.api.run();
  assert.equal(f.$('stop').disabled,true);
  assert.equal(f.$('handle').disabled,false);
  assert.equal(f.$('confirm').value,'');
  assert.equal(f.$('run').disabled,true);
  assert.match(f.$('status').textContent,/^Stopped;/);
});

test('zero delay adds no between-post pause or random wait', async () => {
  const f=scanFixture(); f.sandbox.rows=[{id:'1',handle:'owner'},{id:'2',handle:'owner'}];
  f.api.configure('globalThis.waits = []; pause = async ms => {guard(); waits.push(ms)}');
  await f.api.deleteAll(0);
  assert.deepEqual(Array.from(f.sandbox.deleted),['1','2']);
  assert(f.sandbox.waits.every(ms => ms === 2500));
});
test('positive delay uses exactly the requested wait', async () => {
  const f=scanFixture(); f.sandbox.rows=[{id:'1',handle:'owner'}];
  f.api.configure('globalThis.waits = []; pause = async ms => {guard(); waits.push(ms)}');
  await f.api.deleteAll(0.5);
  assert.equal(f.sandbox.waits.filter(ms => ms === 500).length,1);
  assert(f.sandbox.waits.every(ms => ms === 2500 || ms === 500));
});
test('run needs no browser confirmation and prevents a second concurrent run', async () => {
  const f=scanFixture(); f.$('handle').value='owner'; f.$('delay').value='0'; f.$('confirm').value='delete';
  f.window.confirm=()=>{throw new Error('Unexpected browser prompt')};
  f.api.configure('globalThis.runs=0; globalThis.release=null; deleteAll=async () => {runs++; await new Promise(resolve => {release=resolve})}');
  const first=f.api.run();
  assert.equal(f.$('confirm').value,'');
  f.$('confirm').value='delete';
  await f.api.run(); assert.equal(f.sandbox.runs,1);
  f.sandbox.release(); await first;
  assert.equal(f.$('confirm').value,''); assert.equal(f.$('run').disabled,true);
  assert.match(f.$('status').textContent,/^Finished;/);
});
