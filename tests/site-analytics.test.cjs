const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, '../site/dc-analytics.js'), 'utf8');
function boot(options = {}) {
  const nodes = [], listeners = {};
  const loc = new URL(options.url || 'https://naviboard.yytyyf.com/?email=fixture@example.test#fixture');
  const w = { location: loc, navigator: options.navigator || {},
    localStorage: { getItem: () => options.consent || null },
    addEventListener: (name, cb) => { listeners[name] = cb; },
    setTimeout: cb => { cb(); }, history: {} };
  for (const method of ['pushState', 'replaceState']) w.history[method] = (_s, _t, url) => {
    if (url) w.location = new URL(url, w.location);
  };
  const d = { currentScript: { dataset: { gaId: 'G-VX7QCW396L', site: 'naviboard', hosts: 'naviboard.yytyyf.com' } },
    referrer: 'https://example.test/fixture?email=fixture@example.test',
    createElement: () => ({}), head: { appendChild: el => nodes.push(el) } };
  const ctx = vm.createContext({ window: w, document: d, URL, Date });
  vm.runInContext(code, ctx);
  return { w, nodes, listeners, ctx, events: () => (w.dataLayer || []).map(x => Array.from(x)).filter(x => x[0] === 'event') };
}
test('one sanitized initial view; no fake consent or sensitive text', () => {
  const b = boot();
  assert.equal(b.nodes.length, 1);
  assert.equal(b.events().length, 1);
  const ev = b.events()[0][2];
  assert.equal(ev.page_location, 'https://naviboard.yytyyf.com/');
  assert.equal(ev.page_referrer, 'https://example.test/');
  assert.equal(JSON.stringify(b.w.dataLayer).includes('fixture'), false);
  assert.equal(JSON.stringify(b.w.dataLayer).includes('granted'), false);
  vm.runInContext(code, b.ctx);
  assert.equal(b.events().length, 1);
});
test('preview, browser opt-out and historical rejection do not load Google', () => {
  for (const options of [{url:'https://preview.vercel.app/'}, {navigator:{doNotTrack:'1'}},
    {navigator:{globalPrivacyControl:true}}, {consent:JSON.stringify({value:'denied'})},
    {consent:JSON.stringify({status:'denied'})}]) assert.equal(boot(options).nodes.length, 0);
});
test('SPA navigation counts once, ignores query/hash changes, masks unknown paths', () => {
  const b = boot();
  b.w.history.pushState({}, '', '/en/?email=fixture@example.test');
  b.w.history.replaceState({}, '', '/en/?email=another@example.test#fragment');
  assert.equal(b.events().length, 2);
  b.w.history.pushState({}, '', '/user/fixture@example.test');
  assert.equal(b.events()[2][2].page_location, 'https://naviboard.yytyyf.com/other');
  assert.equal(JSON.stringify(b.w.dataLayer).includes('fixture'), false);
});
test('queue is bounded if Google is blocked', () => {
  const b = boot();
  for (let i=0; i<200; i++) b.w.history.pushState({}, '', i%2 ? '/' : '/en');
  assert.ok(b.w.dataLayer.length <= 100);
});
test('safe campaign labels retained without forwarding the raw URL', () => {
  const b = boot({url:'https://naviboard.yytyyf.com/?utm_source=directory&utm_campaign=launch&utm_content=person@example.test'});
  const config = Array.from(b.w.dataLayer).find(x => x[0] === 'config')[2];
  assert.equal(config.campaign_source, 'directory');
  assert.equal(config.campaign_name, 'launch');
  assert.equal(config.campaign_content, undefined);
  assert.equal(config.cookie_domain, 'naviboard.yytyyf.com');
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
});
