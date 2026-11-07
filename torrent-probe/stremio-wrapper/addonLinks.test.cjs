const assert=require('node:assert/strict');
const ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/addonLinks.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject});
const base='http://127.0.0.1:11470/upnp/ui/';
for(const link of ['stremio://torrentio.strem.fun/manifest.json','stremio://torrentio.strem.fun/qualityfilter=4k%7Csizefilter=4gb/manifest.json']) {
 const route=exportsObject.addonInstallRoute(link,base);
 assert.equal(decodeURIComponent(route.split('addon=')[1]),link.replace('stremio:','https:'));
 assert.ok(route.startsWith(base+'#/addons?addon='));
}
for(const link of ['javascript:alert(1)','stremio:///detail/movie/x','stremio://name:secret@host/manifest.json','stremio://host/not-a-manifest','stremio://host/manifest.json#bad']) assert.equal(exportsObject.addonInstallRoute(link,base),null);
console.log('7 addon-link cases passed');
