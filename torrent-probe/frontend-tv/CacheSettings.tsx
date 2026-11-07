import React, {useEffect, useRef, useState} from 'react';
import {getJson} from './api';
export default function CacheSettings({onDone}: {onDone: () => void}) {
    const [status, setStatus] = useState<any>(null);const [choice, setChoice] = useState('auto');const [message, setMessage] = useState('');const [busy, setBusy] = useState(false);
    const request = useRef<AbortController | null>(null);
    useEffect(() => () => request.current?.abort(), []);
    useEffect(() => {const controller = new AbortController();getJson<any>('/cache', controller.signal).then(s => {setStatus(s);setChoice(s.preferences.mode === 'auto' ? 'auto' : String(s.preferences.limitBytes));}).catch(e => {if (!controller.signal.aborted) setMessage(e.message);});return () => controller.abort();}, []);
    const gib = (n: number) => `${(n / 1073741824).toFixed(2)} GiB`;
    async function action(clear = false) {
        setBusy(true);setMessage('');
        const controller = new AbortController();request.current?.abort();request.current = controller;
        try {
            const result = await getJson<any>(clear ? '/cache/clear' : '/cache/settings', controller.signal, 10000, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(clear ? {} : {mode: choice === 'auto' ? 'auto' : 'manual', limitBytes: choice === 'auto' ? null : Number(choice)})});
            if (controller.signal.aborted) return;
            if (clear) {setStatus(result.cache);setMessage('Unused cache cleared. Active playback is protected.');} else onDone();
        } catch (error) {if (!controller.signal.aborted) setMessage((error as Error).message);} finally {if (!controller.signal.aborted) setBusy(false);}
    }
    return <section className="s4f-cache"><h1>Streaming & Cache</h1>{status ? <>
        <p>Cached {gib(status.diskBytes)} · Budget {gib(status.limitBytes)} · Free storage {gib(status.freeBytes)}</p>
        <progress aria-label="Cache usage" max={Math.max(1, status.limitBytes)} value={status.diskBytes} />
        <p>Choose a budget, then Save.</p><div className="s4f-actions">{['auto', .5, 1, 1.5, 2, 4, 8].map(size => {const value = size === 'auto' ? 'auto' : String(Number(size) * 1073741824);return <button key={size} data-autofocus={value === choice || undefined} aria-pressed={choice === value} disabled={busy || (value !== 'auto' && Number(value) > status.maxLimitBytes)} onFocus={() => setChoice(value)} onClick={() => setChoice(value)}>{size === 'auto' ? 'Auto' : `${size} GiB`}</button>;})}</div>
        <p>Movies can be larger than this cache. Older pieces are removed and downloaded again if you seek back. Auto uses up to 1.5 GiB and keeps {gib(status.reserveBytes)} free for the system.</p>
        <div className="s4f-actions"><button disabled={busy} onClick={() => action()}>Save</button><button disabled={busy} onClick={() => action(true)}>Clear unused cache</button><button disabled={busy} onClick={onDone}>Back</button></div>
    </> : <p>Loading storage information…</p>}<p role="status">{message}</p></section>;
}
