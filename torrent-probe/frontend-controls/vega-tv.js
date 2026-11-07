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
    function onKey(e) {
        const key=e.key || e.code;
        if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key) || editing(doc.activeElement)) return;
        // Left/Right retain the player's seek shortcuts until its controls are focused.
        if (isPlayer() && !playerFocus && ['ArrowLeft','ArrowRight'].includes(key)) return;
        e.preventDefault();e.stopImmediatePropagation();
        if (e.type==='keydown') {revealControls();requestAnimationFrame(()=>requestAnimationFrame(()=>move(key)));}
    }
    root.addEventListener('keydown',onKey,true);
    root.addEventListener('keyup',onKey,true);
    function syncRoute() {
        playerFocus=false;
        if (!isPlayer()) fetch('/cache/release',{method:'POST'}).catch(()=>{});
        const panel=doc.getElementById('vega-cache-panel');
        if (!location.hash.startsWith('#/settings')) panel?.remove();
    }
    root.addEventListener('hashchange',syncRoute);
    root.addEventListener('pagehide',()=>navigator.sendBeacon('/cache/release',''));
    function installStyle() {
        if (!doc.head || doc.getElementById('vega-tv-style')) return;
        const style=doc.createElement('style');style.id='vega-tv-style';
        style.textContent='[tabindex]:focus,a:focus,button:focus,input:focus,select:focus{outline:3px solid #50d8ff!important;outline-offset:3px!important}#vega-cache-panel{position:fixed;right:3vw;bottom:4vh;z-index:9999;background:#202036;color:white;padding:16px;border-radius:12px;font:20px sans-serif;max-width:44vw}#vega-cache-panel button{background:#6252bb;color:white;border:0;padding:12px;margin-top:10px;font:inherit;border-radius:8px}#vega-cache-error{position:fixed;top:7vh;left:10vw;right:10vw;z-index:10000;background:#652937;color:white;padding:18px;font:24px sans-serif;border-radius:12px}';
        doc.head.append(style);
    }
    function showCache(status) {
        installStyle();
        if (location.hash.startsWith('#/settings')) {
            let panel=doc.getElementById('vega-cache-panel');
            if (!panel) {
                panel=doc.createElement('section');panel.id='vega-cache-panel';
                const text=doc.createElement('div');text.id='vega-cache-text';
                const button=doc.createElement('button');button.textContent='Clear unused downloads';
                button.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(!e.repeat)button.click();}};
                button.onkeyup=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();}};
                button.onclick=async()=>{button.disabled=true;try{const r=await fetch('/cache/clear',{method:'POST'});const result=await r.json();if(!r.ok)throw Error(result.error);showCache(result.cache);}catch(e){text.textContent=String(e.message);}finally{button.disabled=false;}};
                panel.append(text,button);doc.body.append(panel);
            }
            const gib=n=>(n/1073741824).toFixed(2);
            doc.getElementById('vega-cache-text').textContent='Downloads: '+gib(status.diskBytes)+' / '+gib(status.limitBytes)+' GiB. Active playback is protected.';
        }
        let error=doc.getElementById('vega-cache-error');
        if (isPlayer() && status.error) {if(!error){error=doc.createElement('div');error.id='vega-cache-error';doc.body.append(error);}error.textContent=status.error;}
        else error?.remove();
    }
    let checkingCache=false;
    setInterval(()=>{
        if (isPlayer() && playerFocus) revealControls();
        if (!checkingCache && doc.body && (isPlayer() || location.hash.startsWith('#/settings'))) {
            checkingCache=true;
            fetch('/cache',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(showCache).catch(()=>{}).finally(()=>{checkingCache=false;});
        }
    },1000);
    doc.addEventListener('DOMContentLoaded',()=>{installStyle();syncRoute();});
})(typeof window==='object'?window:globalThis);
