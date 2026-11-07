/* App-local TV navigation and download-cache controls. */
(function (root) {
    function directionScore(from, to, key) {
        const dx = to.x + to.width / 2 - from.x - from.width / 2;
        const dy = to.y + to.height / 2 - from.y - from.height / 2;
        const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
        const forward = key === 'ArrowLeft' ? -dx : key === 'ArrowRight' ? dx : key === 'ArrowUp' ? -dy : dy;
        if (forward < Math.max(8, (horizontal ? Math.min(from.width, to.width) : Math.min(from.height, to.height)) / 2)) return null;
        const sideways = Math.abs(horizontal ? dy : dx);
        return forward + sideways * 4;
    }
    if (typeof module === 'object') module.exports = {directionScore};
    if (!root.document || root.__vegaTvInstalled) return;
    root.__vegaTvInstalled = true;
    const doc = root.document;
    let playerFocus = false;
    const isPlayer = () => location.hash.startsWith('#/player/');
    const editing = e => e && (e.isContentEditable || e.matches('input:not([readonly]),textarea,select'));
    function revealControls() {
        const video = doc.querySelector('video');
        video?.dispatchEvent(new MouseEvent('mousemove', {bubbles:true}));
    }
    function candidates() {
        const dialogs = [...doc.querySelectorAll('[role="dialog"],[class*="modal-container"]')].filter(e => e.getBoundingClientRect().width && getComputedStyle(e).visibility !== 'hidden');
        const scope = dialogs.at(-1) || doc;
        return [...scope.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[tabindex]')].filter(e => {
            const r = e.getBoundingClientRect();
            if (!e.matches('a[href],button,input,select,textarea,[role="button"],[role="option"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="slider"]') && !String(e.className).includes('button-container') && e.getAttribute('tabindex')!=='0') return false;
            if (!r.width || !r.height || e.disabled || e.closest('[inert],[aria-hidden="true"]') || getComputedStyle(e).pointerEvents==='none') return false;
            for (let p=e; p && p!==doc.body; p=p.parentElement) {
                const s=getComputedStyle(p);
                if (s.visibility==='hidden' || s.display==='none' || Number(s.opacity)===0) return false;
            }
            return true;
        });
    }
    function move(key) {
        const list=candidates();
        let current=doc.activeElement;
        if (!list.includes(current)) {
            current=(isPlayer() && list.find(e=>/^(Play|Pause)$/.test(e.title))) || list[0];
        } else {
            const from=current.getBoundingClientRect();
            const ranked=list.filter(e=>e!==current).map(e=>({e,score:directionScore(from,e.getBoundingClientRect(),key)})).filter(e=>e.score!==null).sort((a,b)=>a.score-b.score);
            if (!ranked.length) {
                if (isPlayer() && key==='ArrowDown') {current.blur();playerFocus=false;}
                return;
            }
            current=ranked[0].e;
        }
        if (current) { current.focus({preventScroll:true});current.scrollIntoView({block:'nearest',inline:'nearest'});playerFocus=isPlayer(); }
    }
    let cacheBackKey=false;
    function onKey(e) {
        const key=e.key==='Unidentified'?e.code:(e.key || e.code);
        if (doc.getElementById('vega-cache-dialog') && ['Enter','NumpadEnter',' ','Space','Spacebar'].includes(key)) {
            e.preventDefault();e.stopImmediatePropagation();
            if(e.type==='keydown' && !e.repeat && doc.activeElement?.matches('#vega-cache-dialog button:not(:disabled)')) doc.activeElement.click();
            return;
        }
        if ((doc.getElementById('vega-cache-dialog') || cacheBackKey) && ['Escape','GoBack','BrowserBack'].includes(key)) {
            e.preventDefault();e.stopImmediatePropagation();
            cacheBackKey=e.type==='keydown';
            if (cacheBackKey) closeCache();
            return;
        }
        if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key) || editing(doc.activeElement)) return;
        // Left/Right retain the player's seek shortcuts until its controls are focused.
        if (isPlayer() && !playerFocus && ['ArrowLeft','ArrowRight'].includes(key)) return;
        e.preventDefault();e.stopImmediatePropagation();
        if (e.type==='keydown') {revealControls();requestAnimationFrame(()=>requestAnimationFrame(()=>move(key)));}
    }
    root.addEventListener('keydown',onKey,true);
    root.addEventListener('keyup',onKey,true);
    let lastRoute=null;
    function syncRoute() {
        if(lastRoute===location.hash)return;
        lastRoute=location.hash;
        playerFocus=false;
        if (!isPlayer()) fetch('/cache/release',{method:'POST'}).catch(()=>{});
        const panel=doc.getElementById('vega-cache-panel');
        if (!location.hash.startsWith('#/settings')) {panel?.remove();closeCache(false);}
    }
    root.addEventListener('hashchange',syncRoute);
    root.addEventListener('popstate',syncRoute);
    // The frontend can change hash routes via History API without hashchange.
    for(const method of ['pushState','replaceState']) {
        const original=root.history[method];
        root.history[method]=function(...args){const result=original.apply(this,args);syncRoute();return result;};
    }
    root.addEventListener('pagehide',()=>navigator.sendBeacon('/cache/release',''));
    function installStyle() {
        if (!doc.head || doc.getElementById('vega-tv-style')) return;
        const style=doc.createElement('style');style.id='vega-tv-style';
        style.textContent='[tabindex]:focus,a:focus,button:focus,input:focus,select:focus{outline:3px solid #50d8ff!important;outline-offset:3px!important}#vega-cache-panel{position:fixed;right:3vw;bottom:4vh;z-index:9999;background:#202036;color:white;padding:16px;border-radius:12px;font:20px sans-serif;max-width:44vw}#vega-cache-panel button,#vega-cache-dialog button{background:#6252bb;color:white;border:0;padding:12px;margin:8px;font:inherit;border-radius:8px}#vega-cache-dialog button:disabled{opacity:.4}#vega-cache-dialog [aria-pressed="true"]{background:#24615e;box-shadow:inset 0 0 0 2px #50d8ff}#vega-cache-dialog{position:fixed;inset:0;z-index:10001;background:#000b;display:flex;align-items:center;justify-content:center;color:white;font:22px sans-serif}#vega-cache-dialog article{background:#202036;border-radius:16px;padding:26px;width:min(800px,80vw);max-height:85vh;overflow:auto}#vega-cache-dialog h2{margin:0 0 16px;font-size:30px}#vega-cache-dialog p{line-height:1.4;margin:12px 0}#vega-cache-dialog progress{width:100%;height:18px}#vega-cache-message{min-height:1.4em;color:#9ee8ff}#vega-cache-error{position:fixed;top:7vh;left:10vw;right:10vw;z-index:10000;background:#652937;color:white;padding:18px;font:24px sans-serif;border-radius:12px}';
        doc.head.append(style);
    }
    let cacheStatus=null, draft=null, busy=false;
    const gib=n=>(n/1073741824).toFixed(2)+' GiB';
    function remoteButton(button) {
        button.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(!e.repeat)button.click();}};
        button.onkeyup=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();}};
        return button;
    }
    function closeCache(restore=true) {
        doc.getElementById('vega-cache-dialog')?.remove();
        draft=null;
        if (restore) doc.querySelector('#vega-cache-panel button')?.focus();
    }
    function selectedPreference(status) {
        return status.preferences.mode==='auto'?'auto':String(status.preferences.limitBytes);
    }
    function openCache() {
        if (!cacheStatus || doc.getElementById('vega-cache-dialog')) return;
        draft=selectedPreference(cacheStatus);
        const dialog=doc.createElement('div');dialog.id='vega-cache-dialog';dialog.setAttribute('role','dialog');
        dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','vega-cache-heading');
        dialog.innerHTML='<article><h2 id="vega-cache-heading">Streaming &amp; Cache</h2><p id="vega-cache-usage"></p><progress id="vega-cache-meter" aria-label="Disk cache usage"></progress><p id="vega-cache-space"></p><p>Use arrows to choose a cache budget, then Save.</p><div id="vega-cache-choices" role="group" aria-label="Cache budget"></div><p id="vega-cache-selection"></p><p id="vega-cache-explanation">Auto uses up to 1.5 GiB while protecting system storage. This build retains whole files; rolling-cache playback is not implemented yet. Torrentio’s source-size filter is separate.</p><p id="vega-cache-message" role="status" aria-live="polite"></p><div id="vega-cache-actions"></div></article>';
        const choices=dialog.querySelector('#vega-cache-choices');
        for (const size of ['auto',.5,1,1.5,2,4,8]) {
            const button=remoteButton(doc.createElement('button'));
            button.type='button';button.dataset.budget=size==='auto'?'auto':String(size*1073741824);
            button.textContent=size==='auto'?'Auto':size+' GiB';
            button.onclick=()=>{draft=button.dataset.budget;dialog.querySelector('#vega-cache-message').textContent='Press Save to apply this cache budget.';renderCacheDialog();};
            button.onfocus=button.onclick;
            choices.append(button);
        }
        const actions=dialog.querySelector('#vega-cache-actions');
        for (const [label,action] of [['Save',saveCache],['Clear unused cache',clearCache],['Close',()=>closeCache()]]) {
            const button=remoteButton(doc.createElement('button'));button.type='button';button.textContent=label;
            button.onclick=action;actions.append(button);
        }
        // Browser Tab navigation must also remain inside the modal.
        dialog.onkeydown=e=>{
            if(e.key!=='Tab')return;
            const buttons=[...dialog.querySelectorAll('button:not(:disabled)')];
            if(!buttons.length)return;
            if(e.shiftKey&&doc.activeElement===buttons[0]){e.preventDefault();buttons.at(-1).focus();}
            else if(!e.shiftKey&&doc.activeElement===buttons.at(-1)){e.preventDefault();buttons[0].focus();}
        };
        doc.body.append(dialog);renderCacheDialog();
        (choices.querySelector('[aria-pressed="true"]:not(:disabled)') || choices.querySelector('button:not(:disabled)'))?.focus();
    }
    function renderCacheDialog() {
        const dialog=doc.getElementById('vega-cache-dialog');
        if (!dialog || !cacheStatus) return;
        const status=cacheStatus;
        const label=value=>value==='auto'?'Auto':gib(Number(value));
        dialog.querySelector('#vega-cache-selection').textContent='Selected: '+label(draft)+'. Saved: '+label(selectedPreference(status))+'.';
        dialog.querySelector('#vega-cache-usage').textContent='Cached: '+gib(status.diskBytes)+' / '+gib(status.limitBytes)+' budget';
        const meter=dialog.querySelector('progress');meter.max=Math.max(status.limitBytes,1);meter.value=status.diskBytes;
        dialog.querySelector('#vega-cache-space').textContent='Free storage: '+gib(status.freeBytes)+'. System reserve: '+gib(status.reserveBytes)+'. Safe maximum: '+gib(status.maxLimitBytes)+'.';
        dialog.querySelectorAll('[data-budget]').forEach(button=>{
            button.disabled=busy || (button.dataset.budget!=='auto' && Number(button.dataset.budget)>status.maxLimitBytes);
            button.setAttribute('aria-pressed',String(button.dataset.budget===draft));
        });
        dialog.querySelectorAll('#vega-cache-actions button').forEach(button=>{button.disabled=busy;});
    }
    async function cacheAction(path,body,success) {
        if (busy) return;
        const focused=doc.activeElement;
        busy=true;renderCacheDialog();
        const dialog=doc.getElementById('vega-cache-dialog');
        try {
            const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
            const result=await response.json();
            if(!response.ok)throw Error(result.error||'Unable to update cache');
            cacheStatus=result.cache||result;
            if(path==='/cache/settings')draft=selectedPreference(cacheStatus);
            if(dialog?.isConnected)dialog.querySelector('#vega-cache-message').textContent=success;
            if(path==='/cache/settings' && dialog?.isConnected)closeCache();
        } catch(error) {
            if(dialog?.isConnected)dialog.querySelector('#vega-cache-message').textContent=error.message;
        } finally {
            busy=false;renderCacheDialog();
            if(focused?.isConnected)focused.focus();
        }
    }
    function saveCache() {
        const preferences=draft==='auto'?{mode:'auto',limitBytes:null}:{mode:'manual',limitBytes:Number(draft)};
        return cacheAction('/cache/settings',preferences,'Cache budget saved.');
    }
    function clearCache() {return cacheAction('/cache/clear',{},'Unused cache cleared. Active playback is protected.');}
    function showCache(status) {
        installStyle();
        cacheStatus=status;
        if (location.hash.startsWith('#/settings')) {
            let panel=doc.getElementById('vega-cache-panel');
            if (!panel) {
                panel=doc.createElement('section');panel.id='vega-cache-panel';
                const text=doc.createElement('div');text.id='vega-cache-text';
                const button=remoteButton(doc.createElement('button'));button.textContent='Streaming & Cache';
                button.onclick=openCache;
                panel.append(text,button);doc.body.append(panel);
            }
            doc.getElementById('vega-cache-text').textContent='Cache: '+gib(status.diskBytes)+' / '+gib(status.limitBytes);
            renderCacheDialog();
        } else {doc.getElementById('vega-cache-panel')?.remove();closeCache(false);}
        let error=doc.getElementById('vega-cache-error');
        if (isPlayer() && status.error) {if(!error){error=doc.createElement('div');error.id='vega-cache-error';doc.body.append(error);}error.textContent=status.error;}
        else error?.remove();
    }
    let checkingCache=false;
    setInterval(()=>{
        syncRoute();
        if (isPlayer() && playerFocus) revealControls();
        if (!checkingCache && doc.body && (isPlayer() || location.hash.startsWith('#/settings'))) {
            checkingCache=true;
            fetch('/cache',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(showCache).catch(()=>{}).finally(()=>{checkingCache=false;});
        }
    },1000);
    doc.addEventListener('DOMContentLoaded',()=>{installStyle();syncRoute();});
})(typeof window==='object'?window:globalThis);
