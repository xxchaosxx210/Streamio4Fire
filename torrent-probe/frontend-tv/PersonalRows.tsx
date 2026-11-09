import React from 'react';
import type {Meta} from './types';
import {continueWatching, historyKey, resumeLabel, type HistoryItem, type Library} from './library';
import {safeImage} from './api';

export function Poster({meta, onOpen, focusKey, history, favourite}: {meta: Meta; onOpen: () => void; focusKey: string; history?: HistoryItem; favourite?: boolean}) {
    return <button className={`s4f-poster${history ? ' s4f-resume-card' : ''}`} data-autofocus data-focus={focusKey} onClick={onOpen} aria-label={`${history ? 'Continue ' : ''}${meta.name}${history ? `, ${resumeLabel(history)}` : ''}`}>
        {safeImage(meta.poster) ? <img src={safeImage(meta.poster)} alt="" loading="lazy" onError={e => {e.currentTarget.style.visibility = 'hidden';}} /> : <div className="s4f-poster-placeholder">▶</div>}
        {favourite && <b className="s4f-favourite-mark" aria-label="Favourite">★</b>}
        {history && history.duration>0 && <progress aria-label={`${meta.name} watched`} value={Math.min(history.position,history.duration)} max={history.duration} />}
        <span>{meta.name}</span><small>{history ? resumeLabel(history) : meta.releaseInfo || (meta.type === 'series' ? 'TV series' : 'Movie')}</small>
    </button>;
}
export default function PersonalRows({library, libraryPage, onOpen, onResume, onRemove, onUnfavourite}: {library: Library; libraryPage: boolean; onOpen: (meta: Meta) => void; onResume: (item: HistoryItem) => void; onRemove: (key: string) => void; onUnfavourite: (meta: Meta) => void}) {
    const history=continueWatching(library);
    return <>
        <section className="s4f-row"><h2>Continue watching</h2>{history.length ? <div className="s4f-rail">{history.slice(0,libraryPage ? 100 : 12).map(item=><div className="s4f-personal-item" key={historyKey(item)}>
            <Poster meta={item.meta} history={item} focusKey={`continue-${historyKey(item)}`} onOpen={()=>onResume(item)} />
            {libraryPage && <button className="s4f-remove" aria-label={`Remove ${item.meta.name} from Continue watching`} onClick={()=>onRemove(historyKey(item))}>Remove</button>}
        </div>)}</div> : <p className="s4f-muted">Your movies and episodes appear here after you start watching.</p>}</section>
        <section className="s4f-row"><h2>Favourites <small>Saved on this Fire Stick</small></h2>{library.favourites.length ? <div className="s4f-rail">{library.favourites.slice(0,libraryPage ? 100 : 12).map(meta=><div className="s4f-personal-item" key={`${meta.type}:${meta.id}`}><Poster meta={meta} favourite focusKey={`favourite-${meta.type}:${meta.id}`} onOpen={()=>onOpen(meta)} />{libraryPage && <button className="s4f-remove" aria-label={`Remove ${meta.name} from favourites`} onClick={()=>onUnfavourite(meta)}>Remove favourite</button>}</div>)}</div> : <p className="s4f-muted">Open a title and select ☆ Add to favourites to save it here.</p>}</section>
    </>;
}
