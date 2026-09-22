const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function mount({ fine = true, reduced = false } = {}) {
  const listeners = {}, windows = {}, vars = {}, queue = new Map();
  const media = [{ matches: fine }, { matches: reduced }];
  media.forEach(m => { m.addEventListener = (_, fn) => m.change = fn; m.removeEventListener = () => {}; });
  const el = { dataset: {}, style: { setProperty: (k, v) => vars[k] = v, removeProperty: k => delete vars[k] },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    addEventListener: (k, fn) => listeners[k] = fn, removeEventListener: k => delete listeners[k] };
  let cleanup, id = 0, time = 0;
  const exports = {};
  const code = ts.transpileModule(readFileSync('src/components/agents/AgentDepthCard.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name === 'react' ? { useRef: () => ({ current: el }), useEffect: fn => cleanup = fn() } : name === 'react/jsx-runtime' ? { jsxs: () => null, jsx: () => null } : {},
    matchMedia: q => media[q.includes('reduced') ? 1 : 0],
    window: { addEventListener: (k, fn) => windows[k] = fn, removeEventListener: k => delete windows[k] },
    requestAnimationFrame: fn => { queue.set(++id, fn); return id; }, cancelAnimationFrame: id => queue.delete(id) });
  exports.AgentDepthCard({ accent: '#10B981', className: '', children: null });
  const flush = () => { for (let i = 0; queue.size && i < 100; i++) { const batch = [...queue.values()]; queue.clear(); time += 16; batch.forEach(fn => fn(time)); } assert.equal(queue.size, 0); };
  return { el, vars, queue, listeners, windows, media, flush, cleanup: () => cleanup(), move: (x, y, pointerType = 'mouse') => listeners.pointermove({ clientX: x, clientY: y, pointerType }) };
}
test('rapid moves coalesce and remain inside tilt/parallax limits', () => {
  const c = mount(); for (let i = 0; i < 200; i++) c.move(i * 10, i * 20);
  assert.equal(c.queue.size, 1); c.flush();
  assert.ok(Math.abs(parseFloat(c.vars['--depth-ry'])) <= 3);
  assert.ok(Math.abs(parseFloat(c.vars['--depth-rx'])) <= 2);
  assert.ok(Math.abs(parseFloat(c.vars['--depth-px'])) <= 6);
  assert.ok(Math.abs(parseFloat(c.vars['--depth-py'])) <= 4);
});
test('leave and scroll return the card to neutral and stop scheduling', () => {
  const c = mount(); c.move(400, 0); c.flush(); c.listeners.pointerleave(); c.flush();
  assert.equal(c.el.dataset.depthActive, undefined); assert.ok(Math.abs(parseFloat(c.vars['--depth-ry'])) < .01);
  c.move(400, 0); c.windows.scroll(); c.flush(); assert.equal(c.el.dataset.depthActive, undefined);
});
test('touch, coarse pointers and reduced motion never start tracking', () => {
  for (const options of [{ fine: false }, { reduced: true }]) { const c = mount(options); c.move(400, 0); assert.equal(c.queue.size, 0); }
  const c = mount(); c.move(400, 0, 'touch'); assert.equal(c.queue.size, 0);
});
test('changing motion preference cancels in-flight movement', () => {
  const c = mount(); c.move(400, 0); c.media[1].matches = true; c.media[1].change();
  assert.equal(c.queue.size, 0); assert.equal(c.el.dataset.depthActive, undefined); assert.equal(Object.keys(c.vars).length, 0);
});
test('cards are isolated and unmount removes handlers and pending frames', () => {
  const a = mount(), b = mount(); a.move(400, 0); assert.equal(b.queue.size, 0); a.cleanup();
  assert.equal(a.queue.size, 0); assert.equal(Object.keys(a.listeners).length, 0); assert.equal(Object.keys(a.windows).length, 0);
});
