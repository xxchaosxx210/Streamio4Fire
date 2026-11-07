// Run from the Stremio frontend checkout with its TypeScript dependency installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/common/Shortcuts/keyboard.ts', 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {
    exports: exportsObject,
    require: name => {
        assert.equal(name, 'stremio/common/Platform/device');
        return {name: 'linux'};
    },
});
const cases = [
    [{key: 'GoBack', code: 'BrowserBack', keyCode: 27}, 'Escape'],
    [{key: 'MediaPlayPause', code: 'MediaPlayPause', keyCode: 179}, 'Space'],
    [{key: 'Unidentified', code: 'Unidentified', keyCode: 179}, 'Space'],
    [{key: 'Escape', code: 'Escape', keyCode: 27}, 'Escape'],
    [{key: ' ', code: 'Space', keyCode: 32}, 'Space'],
    [{key: 'ArrowRight', code: 'ArrowRight', keyCode: 39}, 'ArrowRight'],
    [{key: 'Enter', code: 'Enter', keyCode: 13}, 'Enter'],
];
for (const [event, expected] of cases) {
    assert.equal(exportsObject.getKeyboardShortcutKey(event), expected);
    assert.ok(exportsObject.getKeyboardShortcutKeys(event).includes(expected));
}
console.log(`${cases.length} keyboard cases passed`);
