import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router';
import {useCore} from 'stremio/core';
import {useProfile} from 'stremio/common';
import {availability, cachedJson, getJson, loadMeta, resourceUrl, safeImage, sourceFacts, supports, uniqueMetas} from './api';
import type {Addon, Meta, Selection, Source, Stream, Video} from './types';
import PlaybackStatus from './PlaybackStatus';
import CacheSettings from './CacheSettings';
import './tv.less';

const EMPTY: Addon[] = [];
const enc = encodeURIComponent;
function path(page: string, values: Record<string, string>) {return `/tv/${page}?${new URLSearchParams(values)}`;}
function Poster({meta, onOpen}: {meta: Meta; onOpen: () => void}) {
    return <button className="s4f-poster" data-autofocus data-focus={`poster-${meta.type}-${meta.id}`} onClick={onOpen}>
        {safeImage(meta.poster) ? <img src={safeImage(meta.poster)} alt="" loading="lazy" onError={e => {e.currentTarget.style.visibility = 'hidden';}} /> : <div className="s4f-poster-placeholder">▶</div>}
        <span>{meta.name}</span><small>{meta.releaseInfo || (meta.type === 'series' ? 'TV series' : 'Movie')}</small>
    </button>;
}
type Row = {key: string; name: string; provider: string; metas: Meta[]};
function Catalogue({addons, query, onOpen, onSearch}: {addons: Addon[]; query: string | null; onOpen: (meta: Meta) => void; onSearch: (query: string) => void}) {
    const [rows, setRows] = useState<Row[]>([]);const [loading, setLoading] = useState(true);const [failed, setFailed] = useState(0);const [attempt, setAttempt] = useState(0);const [input, setInput] = useState(query || '');
    useEffect(() => setInput(query || ''), [query]);
    useEffect(() => {
        const controller = new AbortController();setRows([]);setFailed(0);setLoading(true);
        const requests = addons.flatMap((addon, addonIndex) => (addon.manifest.catalogs || []).filter(c => {
            const extras = [...(c.extra || []).map(e => e.name), ...(c.extraSupported || [])];
            return ['movie', 'series'].includes(c.type) && (query === null ? !(c.extra || []).some(e => (e as {isRequired?: boolean}).isRequired) : extras.includes('search'));
        }).slice(0, query === null ? 2 : 4).map(catalogue => ({addon, addonIndex, catalogue}))).slice(0, query === null ? 8 : 16);
        if (query !== null && query.trim().length < 2) {setLoading(false);return () => controller.abort();}
        let remaining = requests.length;
        if (!remaining) setLoading(false);
        requests.forEach(({addon, addonIndex, catalogue}, index) => {
            cachedJson<{metas: Meta[]}>(resourceUrl(addon, 'catalog', catalogue.type, catalogue.id, query === null ? {} : {search: query}), controller.signal)
                .then(data => {
                    if (controller.signal.aborted) return;
                    const metas = uniqueMetas((data.metas || []).map(meta => ({...meta, type: meta.type || catalogue.type}))).slice(0, query === null ? 24 : 100);
                    if (metas.length) setRows(current => [...current, {key: `${index}-${addonIndex}-${catalogue.id}`, name: `${catalogue.name || 'Browse'} · ${catalogue.type === 'series' ? 'TV series' : 'Movies'}`, provider: addon.manifest.name, metas}].sort((a,b) => Number(a.key.split('-')[0])-Number(b.key.split('-')[0])));
                }).catch(() => {if (!controller.signal.aborted) setFailed(n => n+1);})
                .finally(() => {if (!controller.signal.aborted && --remaining === 0) setLoading(false);});
        });
        return () => controller.abort();
    }, [addons, query, attempt]);
    function submit(e: React.FormEvent) {e.preventDefault();if (input.trim().length >= 2) onSearch(input.trim());}
    return <>
        <header className="s4f-heading"><p className="s4f-eyebrow">STREAMIO4FIRE</p><h1>{query === null ? 'Find your next watch' : 'Search movies & TV'}</h1><p>{query === null ? 'Your installed addons. Built for your remote.' : 'Enter a title, then select Search.'}</p></header>
        {query !== null && <form className="s4f-search" onSubmit={submit}><input autoComplete="off" aria-label="Movie or TV series title" placeholder="Search movies and TV series" value={input} onChange={e => setInput(e.target.value)} /><button type="submit">Search</button></form>}
        {loading && <p role="status" className="s4f-notice">Loading {query === null ? 'catalogues' : 'search results'}…</p>}
        {!loading && rows.length === 0 && <div className="s4f-notice"><h2>{query !== null && query.length < 2 ? 'What would you like to watch?' : failed ? 'The catalogues did not respond' : 'No matching titles'}</h2><p>{failed ? 'Check the connection or retry. Your installed addons are unchanged.' : 'Try a different title or check your addons.'}</p><button onClick={() => setAttempt(n => n+1)}>Retry</button></div>}
        {rows.map(row => <section className="s4f-row" key={row.key}><h2>{row.name} <small>{row.provider}</small></h2><div className={query === null ? 's4f-rail' : 's4f-grid'}>{row.metas.map(meta => <Poster key={`${meta.type}-${meta.id}`} meta={meta} onOpen={() => onOpen(meta)} />)}</div></section>)}
        {failed > 0 && rows.length > 0 && <p className="s4f-muted">Some addons did not respond. Available results are shown.</p>}
    </>;
}
function Details({addons, type, id, initialSeason, onEpisode}: {addons: Addon[]; type: string; id: string; initialSeason: string | null; onEpisode: (meta: Meta, addon: Addon, video: Video | null, season: number) => void}) {
    const [item, setItem] = useState<{meta: Meta; addon: Addon} | null>(null);const [error, setError] = useState('');const [attempt, setAttempt] = useState(0);const [season, setSeason] = useState(initialSeason === null ? 1 : Number(initialSeason));const [shown, setShown] = useState(100);
    useEffect(() => {
        const controller = new AbortController();setItem(null);setError('');
        loadMeta(addons, type, id, controller.signal).then(value => {
            if (controller.signal.aborted) return;setItem(value);
            const available = Array.from(new Set((value.meta.videos || []).map(v => v.season ?? 1))).sort((a,b) => a-b);
            if (!available.includes(season)) setSeason(available.includes(1) ? 1 : available[0] ?? 1);
        }).catch(() => {if (!controller.signal.aborted) setError('No installed addon returned details for this title.');});
        return () => controller.abort();
    }, [addons, type, id, attempt]);
    if (!item) return <section className="s4f-heading"><h1>{error || 'Loading title…'}</h1>{error && <button data-autofocus onClick={() => setAttempt(n => n+1)}>Retry</button>}</section>;
    const {meta, addon} = item;
    const seasons = Array.from(new Set((meta.videos || []).map(v => v.season ?? 1))).sort((a,b) => a-b);
    const episodes = (meta.videos || []).filter(v => (v.season ?? 1) === season).sort((a,b) => (a.episode ?? 0)-(b.episode ?? 0));
    return <>
        <section className="s4f-hero" style={safeImage(meta.background) ? {backgroundImage: `linear-gradient(90deg,#111321 25%,#11132188),url("${safeImage(meta.background)?.replace(/["\\]/g, '')}")`} : undefined}>
            <p className="s4f-eyebrow">{meta.type === 'series' ? 'TV SERIES' : 'MOVIE'} · {meta.releaseInfo || ''}</p><h1>{meta.name}</h1><p className="s4f-facts">{[meta.runtime, ...(meta.genres || []).slice(0,3)].filter(Boolean).join(' · ')}</p><p className="s4f-description">{meta.description || 'No description available.'}</p>
            {meta.type !== 'series' && <button data-autofocus onClick={() => onEpisode(meta, addon, null, season)}>Choose a source</button>}
        </section>
        {meta.type === 'series' && <section className="s4f-row"><h2>Choose an episode</h2><div className="s4f-rail s4f-seasons" aria-label="Seasons">{seasons.map(value => <button key={value} aria-pressed={season === value} onClick={() => {setSeason(value);setShown(100);}}>{value === 0 ? 'Specials' : `Season ${value}`}</button>)}</div>
            <div className="s4f-episodes">{episodes.slice(0,shown).map(video => <button key={video.id} data-autofocus data-focus={`episode-${video.id}`} onClick={() => onEpisode(meta, addon, video, season)}><strong>{video.season === 0 ? 'Special' : `S${video.season ?? season}`} · E{video.episode ?? '?'}</strong><span>{video.title || 'Episode'}</span></button>)}</div>
            {!episodes.length && <p>No episode list was returned by your metadata addons.</p>}{episodes.length > shown && <button onClick={() => setShown(n => n+100)}>Show more episodes ({shown} of {episodes.length})</button>}
        </section>}
    </>;
}
function Sources({addons, type, id, videoId, onSelect, onAddons}: {addons: Addon[]; type: string; id: string; videoId: string; onSelect: (source: Source, meta: Meta, metaAddon: Addon) => void; onAddons: () => void}) {
    const [sources, setSources] = useState<Source[]>([]);const [item, setItem] = useState<{meta: Meta; addon: Addon} | null>(null);const [pending, setPending] = useState(true);const [failed, setFailed] = useState(0);const [attempt, setAttempt] = useState(0);const [sort, setSort] = useState(false);
    useEffect(() => {
        const controller = new AbortController();setSources([]);setPending(true);setFailed(0);setItem(null);
        const metadata = loadMeta(addons, type, id, controller.signal).then(value => {if (!controller.signal.aborted) setItem(value);}).catch(() => {if (!controller.signal.aborted) setFailed(n => n+1);});
        const eligible = addons.filter(addon => supports(addon, 'stream', type, videoId));
        let remaining = eligible.length;
        if (!remaining) setPending(false);
        eligible.forEach((addon, addonIndex) => {
            getJson<{streams: Stream[]}>(resourceUrl(addon, 'stream', type, videoId), controller.signal).then(data => {
                if (controller.signal.aborted) return;
                setSources(current => [...current, ...(data.streams || []).filter(stream => typeof stream.infoHash === 'string' || (typeof stream.url === 'string' && /^https?:\/\//i.test(stream.url))).map((stream, index) => ({key: `${addonIndex}-${index}`, addon, stream}))]);
            }).catch(() => {if (!controller.signal.aborted) setFailed(n => n+1);}).finally(() => {if (!controller.signal.aborted && --remaining === 0) setPending(false);});
        });
        void metadata;return () => controller.abort();
    }, [addons, type, id, videoId, attempt]);
    const ordered = sort ? [...sources].sort((a,b) => (availability(b.stream).seeders ?? -1)-(availability(a.stream).seeders ?? -1)) : sources;
    return <><header className="s4f-heading"><p className="s4f-eyebrow">CHOOSE A SOURCE</p><h1>{item?.meta.name || 'Available sources'}</h1><p>{type === 'series' ? `Episode ${videoId.split(':').slice(1).join(' · ')}` : 'Choose quality, file size and reported availability.'}</p><div className="s4f-actions"><button aria-pressed={sort} onClick={() => setSort(value => !value)}>Sort: {sort ? 'Most seeders' : 'Addon order'}</button><button onClick={() => setAttempt(n => n+1)}>Refresh sources</button></div></header>
        {pending && <p role="status">Finding sources from installed addons…</p>}
        {!item && failed > 0 && <p role="alert">Title details could not be loaded yet. Select Refresh sources to try again.</p>}
        {!pending && !ordered.length && <div className="s4f-notice"><h2>{failed ? 'Source addons did not respond' : 'No playable sources returned'}</h2><p>Retry or check your installed addons.</p><button onClick={() => setAttempt(n => n+1)}>Retry</button><button onClick={onAddons}>Manage addons</button></div>}
        <div className="s4f-source-list">{ordered.map(source => {const facts = sourceFacts(source.stream);const reported = availability(source.stream);return <button className="s4f-source" key={source.key} data-focus={`source-${source.key}`} data-autofocus disabled={!item} onClick={() => item && onSelect(source, item.meta, item.addon)}><div><strong>{facts.quality} · {facts.size} · {facts.format}</strong><span>{source.addon.manifest.name}</span><p>{(source.stream.description || source.stream.title || source.stream.name || '').split('\n')[0]}</p></div><div className="s4f-availability"><span>Seeders <b>{reported.seeders ?? 'Unknown'}</b></span><span>Leechers <b>{reported.leechers ?? 'Unknown'}</b></span></div></button>;})}</div>
        {!!sources.length && <p className="s4f-muted">Availability is reported by addons and may be out of date. Leechers are shown only when provided.</p>}{failed > 0 && <p>Some addons did not respond. Available sources are shown.</p>}
    </>;
}

export default function TvShell({children}: {children: React.ReactNode}) {
    const core = useCore();const profile = useProfile() as unknown as {addons?: Addon[]};
    const addons = profile.addons || EMPTY;
    const location = useLocation();const navigate = useNavigate();const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const route = location.pathname;const routeKey = route + location.search;const player = route.startsWith('/player/');
    const legacy = !player && !['/', '/search'].includes(route) && !route.startsWith('/tv/');
    const [selection, setSelection] = useState<Selection | null>(null);
    const request = useRef<AbortController | null>(null);const remembered = useRef(new Map<string, string>());const root = useRef<HTMLElement>(null);const backHeld = useRef(false);const wasPlayer = useRef(false);
    const type = params.get('type') || 'movie';const id = params.get('id') || '';const videoId = params.get('video') || id;
    const goBack = useCallback(() => {
        if (selection) {request.current?.abort();setSelection(null);navigate(selection.back);fetch('/cache/release', {method:'POST'}).catch(() => {});return;}
        if (route === '/tv/sources' || route === '/tv/detail') navigate(params.get('back') || '/');
        else if (route === '/tv/cache' || legacy) navigate('/tv/settings');
        else if (route === '/tv/settings' || route.includes('search')) navigate('/');
        else document.querySelector<HTMLButtonElement>('.s4f-nav button')?.focus();
    }, [selection, route, location.search, navigate, legacy]);
    useEffect(() => {
        document.body.classList.toggle('s4f-tv-player', player);document.body.classList.toggle('s4f-tv-legacy', legacy);
        const key = (event: KeyboardEvent) => {
            const name = event.key === 'Unidentified' ? event.code : event.key;
            const element = document.activeElement as HTMLElement | null;
            if (['Enter','NumpadEnter',' ','Space'].includes(name) && element?.matches('.s4f-shell button,.s4f-loading button,.s4f-legacy-nav button')) {event.preventDefault();event.stopImmediatePropagation();if (event.type === 'keydown' && !event.repeat) element.click();return;}
            if (!['Escape','GoBack','BrowserBack'].includes(name)) return;
            if (backHeld.current && event.type === 'keyup') {backHeld.current = false;event.preventDefault();event.stopImmediatePropagation();return;}
            if (player && !selection?.preparing && !selection?.error) return;
            if (document.querySelector('#vega-cache-dialog')) return;
            if (legacy && document.querySelector('[role="dialog"]')) return;
            event.preventDefault();event.stopImmediatePropagation();if (event.type === 'keydown' && !event.repeat) {backHeld.current = true;goBack();}
        };
        window.addEventListener('keydown', key, true);window.addEventListener('keyup', key, true);
        return () => {window.removeEventListener('keydown', key, true);window.removeEventListener('keyup', key, true);};
    }, [goBack, player, legacy, selection?.preparing, selection?.error]);
    useEffect(() => {
        if (player || legacy) return;
        const focus = () => {
            const saved = remembered.current.get(routeKey);
            const candidates = [...(root.current?.querySelectorAll<HTMLElement>('[data-focus]') || [])];
            const target = candidates.find(e => e.dataset.focus === saved) || root.current?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') || root.current?.querySelector<HTMLElement>('button,input');
            target?.focus();
        };
        const frame = requestAnimationFrame(focus);
        // Restore a remembered card once asynchronous results have arrived, once.
        const observer = new MutationObserver(() => {const saved = remembered.current.get(routeKey);if (saved && [...(root.current?.querySelectorAll<HTMLElement>('[data-focus]') || [])].some(e => e.dataset.focus === saved)) {focus();observer.disconnect();}});
        if (root.current) observer.observe(root.current, {childList:true,subtree:true});
        return () => {cancelAnimationFrame(frame);observer.disconnect();};
    }, [routeKey, player, legacy]);
    useEffect(() => () => request.current?.abort(), []);
    useEffect(() => {if (wasPlayer.current && !player) {request.current?.abort();setSelection(null);}wasPlayer.current = player;}, [player]);
    useEffect(() => {
        if (player && !selection) {
            const token = route.split('/')[2];let active = true;
            core.transport.decodeStream(decodeURIComponent(token)).then(stream => {
                if (!active || !stream || !addons.length) return;
                const addon = addons.find(a => supports(a, 'stream', 'movie', '')) || addons[0];
                setSelection({source:{key:'linked',addon,stream:stream as unknown as Stream},meta:{id:'',type:'movie',name:stream.name || 'Video'},metaAddon:addon,videoId:'',back:'/',started:Date.now(),readyAt:Date.now(),preparing:false,error:null});
            }).catch(() => {});return () => {active = false;};
        }
    }, [player, route, selection, addons]);
    async function select(source: Source, meta: Meta, metaAddon: Addon, back: string, selectedVideo: string) {
        request.current?.abort();const controller = new AbortController();request.current = controller;
        const pending: Selection = {source,meta,metaAddon,videoId:selectedVideo,back,started:Date.now(),preparing:true,error:null};setSelection(pending);
        try {
            const stream = {...source.stream};
            if (stream.infoHash) {
                if (!/^[a-f0-9]{40}$/i.test(stream.infoHash)) throw Error('Invalid torrent hash');
                const guess = !Number.isInteger(stream.fileIdx);
                const result = await getJson<{guessedFileIdx?: number}>(`/${stream.infoHash}/create`, controller.signal, 85000, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({guessFileIdx:guess ? (meta.type === 'series' ? {episode:Number(selectedVideo.split(':').at(-1))} : {}) : false,peerSearch:{sources:Array.isArray(stream.announce) ? stream.announce.map(value => `tracker:${value}`) : []}})});
                if (guess && typeof result.guessedFileIdx === 'number') stream.fileIdx = result.guessedFileIdx;
            }
            const encoded = await core.transport.encodeStream(stream as unknown as Parameters<typeof core.transport.encodeStream>[0]);
            if (controller.signal.aborted) return;
            setSelection({...pending,source:{...source,stream},preparing:false,readyAt:Date.now()});
            navigate(`/player/${enc(encoded)}/${enc(source.addon.transportUrl)}/${enc(metaAddon.transportUrl)}/${enc(meta.type)}/${enc(meta.id)}/${enc(selectedVideo)}`);
        } catch (error) {if (!controller.signal.aborted) setSelection({...pending,preparing:false,error:(error as Error).message});}
    }
    const retry = () => {if (selection) select(selection.source,selection.meta,selection.metaAddon,selection.back,selection.videoId);};
    if (player) return <>{!selection?.preparing && children}{selection && <PlaybackStatus key={selection.started} selection={selection} player onBack={goBack} onRetry={retry} />}</>;
    if (legacy) return <><nav className="s4f-legacy-nav"><button onClick={goBack}>← TV settings</button><button onClick={() => navigate('/')}>Home</button></nav>{children}</>;
    const detail = (meta: Meta) => navigate(path('detail', {type:meta.type,id:meta.id,back:routeKey}));
    return <div className="s4f-shell">
        <nav className="s4f-nav" aria-label="Main menu"><img src="images/streamio4fire-icon.png" alt=""/><strong>Streamio4Fire</strong>{[['Home','/'],['Search','/tv/search'],['Settings','/tv/settings']].map(([label,to]) => <button key={to} aria-current={(route === to || (label === 'Search' && route.includes('search'))) ? 'page' : undefined} onClick={() => {request.current?.abort();setSelection(null);navigate(to);}}>{label}</button>)}</nav>
        <main ref={root} onFocus={event => {const focus = (event.target as HTMLElement).dataset.focus;if (focus) remembered.current.set(routeKey, focus);}}>
            {route !== '/' && <button className="s4f-back" onClick={goBack}>← Back</button>}
            {(route === '/' || route === '/tv/search' || route === '/search') && <Catalogue addons={addons} query={route === '/' ? null : params.get('q') || ''} onOpen={detail} onSearch={q => navigate(path('search',{q}))} />}
            {route === '/tv/detail' && <Details addons={addons} type={type} id={id} initialSeason={params.get('season')} onEpisode={(meta,addon,video,season) => {void addon;const back = path('detail',{type,id,season:String(season),back:params.get('back') || '/'});navigate(path('sources',{type,id,video:video?.id || id,back}));}} />}
            {route === '/tv/sources' && <Sources addons={addons} type={type} id={id} videoId={videoId} onSelect={(source,meta,addon) => select(source,meta,addon,routeKey,videoId)} onAddons={() => navigate('/addons')} />}
            {route === '/tv/settings' && <section className="s4f-heading"><p className="s4f-eyebrow">SETTINGS</p><h1>Make yourself comfortable</h1><div className="s4f-settings-grid"><button data-autofocus onClick={() => navigate('/tv/cache')}><strong>Streaming & Cache</strong><span>Storage budget and unused downloads</span></button><button onClick={() => navigate('/addons')}><strong>Manage addons</strong><span>Sources, catalogues and configuration</span></button><button onClick={() => navigate('/settings')}><strong>Advanced settings</strong><span>Existing Stremio preferences</span></button></div></section>}
            {route === '/tv/cache' && <CacheSettings onDone={() => navigate('/tv/settings')} />}
        </main>
        {selection && <PlaybackStatus key={selection.started} selection={selection} player={false} onBack={goBack} onRetry={retry} />}
    </div>;
}




