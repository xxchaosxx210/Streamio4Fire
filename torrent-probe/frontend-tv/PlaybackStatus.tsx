import React, {useEffect, useRef, useState} from 'react';
import {availability, friendlyFailure, getJson, sourceFacts} from './api';
import type {Selection} from './types';

type Snapshot = {peers: number | null; speed: number | null; bytes: number; buffered: number; seconds: number; phase: string};
const initial: Snapshot = {peers: null, speed: null, bytes: 0, buffered: 0, seconds: 0, phase: 'Finding peers and seeders…'};
export default function PlaybackStatus({selection, player, onBack, onRetry}: {selection: Selection; player: boolean; onBack: () => void; onRetry: () => void}) {
    const [snapshot, setSnapshot] = useState(initial);
    const [visible, setVisible] = useState(true);
    const [failure, setFailure] = useState<{title: string; message: string} | null>(null);
    const [technical, setTechnical] = useState('');
    const [details, setDetails] = useState(false);
    const panel = useRef<HTMLDivElement>(null);
    const reported = availability(selection.source.stream);
    const facts = sourceFacts(selection.source.stream);
    useEffect(() => {
        if (visible) {const id = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus());return () => cancelAnimationFrame(id);}
    }, [visible]);
    useEffect(() => {
        const controller = new AbortController();let timer: ReturnType<typeof setTimeout>;let played = false;let waitingSince = 0;
        let video: HTMLVideoElement | null = null;
        const playing = () => {played = true;waitingSince = 0;setVisible(false);};
        const showFailure = (reason: string) => {if (!controller.signal.aborted) {setTechnical(reason);setFailure(friendlyFailure(reason));setVisible(true);}};
        const tick = async () => {
            const current = player ? document.querySelector('video') : null;
            if (current !== video) {video?.removeEventListener('playing', playing);video = current;video?.addEventListener('playing', playing);}
            let bytes = 0, peers: number | null = null, speed: number | null = null;
            try {
                const hash = selection.source.stream.infoHash;
                if (hash) {
                    const raw = await getJson<any>(`/torrents/${encodeURIComponent(hash)}/stats/v1`, controller.signal, 3000).catch(() => null);
                    peers = raw?.live?.snapshot?.peer_stats?.live ?? null;
                    speed = typeof raw?.live?.download_speed?.mbps === 'number' ? raw.live.download_speed.mbps * 1048576 : null;
                    bytes = raw?.live?.snapshot?.fetched_bytes || raw?.progress_bytes || 0;
                    if (raw?.error && !selection.preparing) showFailure(String(raw.error));
                    if (!selection.preparing && Date.now() - (selection.readyAt || selection.started) > 1500) {
                        const cache = await getJson<any>('/cache', controller.signal, 3000).catch(() => null);
                        if (cache?.error) showFailure(String(cache.error));
                    }
                }
                if (controller.signal.aborted) return;
                let buffered = 0;
                if (video) {
                    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) buffered = video.buffered.end(i) - video.currentTime;
                    if (video.error) {
                        setTechnical(`Media error ${video.error.code}: ${video.error.message || 'Video could not be opened'}`);
                        setFailure(video.error.code === 4
                            ? {title: 'This video format cannot play on this device', message: 'Try another source. MP4 with H.264 video is a good starting point.'}
                            : {title: 'The video connection stopped', message: 'The source stopped delivering playable video. Retry or choose another source.'});setVisible(true);
                    } else if (video.currentTime > 0 && !video.paused && video.readyState >= 3) playing();
                    else if (played && !video.paused && video.readyState < 3) {waitingSince ||= Date.now();if (Date.now() - waitingSince >= 1800) setVisible(true);}
                    else if (played && video.paused) {waitingSince = 0;setVisible(false);}
                }
                const seconds = Math.floor((Date.now() - selection.started) / 1000);
                if (!selection.preparing && !played && Date.now() - (selection.readyAt || selection.started) > 90000) showFailure('Video did not start in time');
                setSnapshot({peers, speed, bytes, buffered, seconds, phase: selection.preparing ? 'Finding peers and seeders…' : video?.readyState && video.readyState >= 2 ? 'Starting playback…' : bytes > 0 || video?.currentSrc ? 'Buffering video…' : 'Connecting to peers and seeders…'});
            } finally {if (!controller.signal.aborted) timer = setTimeout(tick, played && !waitingSince ? 4000 : 1000);}
        };
        tick();
        return () => {controller.abort();clearTimeout(timer);video?.removeEventListener('playing', playing);};
    }, [selection.started, selection.preparing, player]);
    const error = selection.error ? friendlyFailure(selection.error) : failure;
    if (!visible && !error) return null;
    const unknown = (n: number | null) => n === null ? 'Unknown' : n.toLocaleString();
    return <div className="s4f-loading" role="dialog" aria-modal="true" aria-labelledby="s4f-loading-title" ref={panel}>
        <section>
            <p className="s4f-eyebrow">{facts.quality} · {facts.size} · {facts.format}</p>
            <h1 id="s4f-loading-title">{selection.meta.name}</h1>
            <h2 role="status" aria-live="polite">{error?.title || snapshot.phase}</h2>
            {error ? <p>{error.message}</p> : <>
                {snapshot.buffered > 0 ? <progress aria-label="Buffered seconds, up to five seconds shown" max={5} value={Math.min(5, snapshot.buffered)} /> : <div className="s4f-indeterminate" role="progressbar" aria-label={snapshot.phase} />}
                <p>{snapshot.seconds} seconds{snapshot.buffered > 0 ? ` · Buffered ahead: ${snapshot.buffered.toFixed(1)}s` : ''}</p>
                <ol className="s4f-stages"><li>✓ Source selected</li><li>{selection.preparing ? '●' : '✓'} Finding peers and seeders</li><li>{!selection.preparing ? '●' : '○'} Buffering video</li><li>○ Starting playback</li></ol>
            </>}
            <div className="s4f-stats"><span>Reported seeders <strong>{unknown(reported.seeders)}</strong></span><span>Reported leechers <strong>{unknown(reported.leechers)}</strong></span><span>Connected peers <strong>{unknown(snapshot.peers)}</strong></span><span>Download speed <strong>{snapshot.speed === null ? '—' : `${(snapshot.speed / 1048576).toFixed(2)} MB/s`}</strong></span></div>
            <p className="s4f-muted">Reported availability can be out of date. Connected peers and speed show current activity.</p>
            <div className="s4f-actions"><button onClick={onBack}>Choose another source</button>{error ? <button onClick={onRetry}>Try again</button> : <button onClick={onBack}>Cancel</button>}<button aria-expanded={details} onClick={() => setDetails(value => !value)}>{details ? 'Hide' : 'Show'} technical details</button></div>
            {details && <div className="s4f-technical"><p>Stage: {snapshot.phase} · Received: {(snapshot.bytes / 1048576).toFixed(2)} MiB</p><p>{selection.error || technical || 'No error reported.'}</p></div>}
        </section>
    </div>;
}
