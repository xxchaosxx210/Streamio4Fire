// Run with the pinned frontend's TypeScript available through NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
const context = {exports: exportsObject, URL, AbortController, DOMException, setTimeout, clearTimeout,
    fetch: async () => ({ok: true, json: async () => ({metas: []})})};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/api.ts', 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5},
}).outputText, context);
const api = exportsObject;
assert.equal(api.peerSources({sources:['tracker:udp://example.org:80', null],announce:['udp://example.org:80']}).length, 1);
assert.equal(api.peerSources({announce:['https://example.org/announce']})[0], 'tracker:https://example.org/announce');
assert.equal(api.peerSources({}).length, 0);
const addon = {transportUrl: 'https://example.org/config/manifest.json?token=test', manifest: {
    types: ['movie', 'series'], resources: ['catalog', {name: 'stream', types: ['series'], idPrefixes: ['tt']}]
}};
const url = new URL(api.resourceUrl(addon, 'catalog', 'series', 'top', {search: 'a/b & c'}));
assert.equal(url.pathname, '/config/catalog/series/top/search=a%2Fb%20%26%20c.json');
assert.equal(url.searchParams.get('token'), 'test');
assert.equal(api.supports(addon, 'stream', 'movie', 'tt1'), false);
assert.equal(api.supports(addon, 'stream', 'series', 'tt1:1:2'), true);
assert.equal(api.availability({description: '👤 42 💾 4 GB'}).seeders, 42);
assert.equal(api.availability({description: '👤 42'}).leechers, null);
assert.equal(api.availability({seeders: 0, leechers: 3}).seeders, 0);
assert.equal(api.availability({seeders: -1, leechers: Infinity}).leechers, null);
assert.match(api.friendlyFailure('metadata timed out').message, /source information/);
assert.match(api.friendlyFailure('not enough disk space').title, /storage/);
assert.equal(api.uniqueMetas([{id:'x',type:'movie',name:'A'},{id:'x',type:'movie',name:'A'},{id:'x',type:'series',name:'B'}]).length, 2);
(async () => {
    context.fetch = (_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled','AbortError'))));
    await assert.rejects(api.getJson('/test', new AbortController().signal, 5), /did not respond/);
    const cancel = new AbortController();
    const pending = api.getJson('/test', cancel.signal, 1000);cancel.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    console.log('TV API checks passed: URLs, addon compatibility, availability, errors, cancellation.');
})().catch(error => {console.error(error);process.exitCode = 1;});

