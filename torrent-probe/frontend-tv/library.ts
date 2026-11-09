import type {Meta} from './types';

export type HistoryItem = {meta: Meta; videoId: string; position: number; duration: number; updated: number};
export type Library = {version: 1; favourites: Meta[]; history: HistoryItem[]};
export const LIBRARY_KEY = 'streamio-tv-library-v1';
const empty = (): Library => ({version: 1, favourites: [], history: []});
export const titleKey = (meta: Meta) => `${meta.type}:${meta.id}`;
export const historyKey = (item: HistoryItem) => `${item.meta.type}:${item.videoId}`;
// Only display metadata is persisted. Stream URLs, hashes and addon credentials
// must never become part of the library snapshot.
export function displayMeta(value: unknown): Meta | null {
    if (!value || typeof value !== 'object') return null;
    const m = value as Record<string, unknown>;
    if (!['movie','series'].includes(String(m.type)) || typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || !m.name) return null;
    const result: Meta = {id:m.id.slice(0,500), type:String(m.type), name:m.name.slice(0,500)};
    for (const key of ['poster','releaseInfo'] as const) if (typeof m[key] === 'string') {
        if (key === 'poster') {try {const url = new URL(m[key] as string);if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) continue;} catch {continue;}}
        result[key] = (m[key] as string).slice(0,2000);
    }
    return result;
}
export function readLibrary(storage: Pick<Storage,'getItem'>): Library {
    try {
        const data = JSON.parse(storage.getItem(LIBRARY_KEY) || 'null');
        if (data?.version !== 1) return empty();
        const favourites: Meta[] = [];const seen = new Set<string>();
        for (const item of Array.isArray(data.favourites) ? data.favourites : []) {const meta = displayMeta(item);if (meta && !seen.has(titleKey(meta))) {favourites.push(meta);seen.add(titleKey(meta));}if (favourites.length === 100) break;}
        const history: HistoryItem[] = [];const ids = new Set<string>();
        for (const item of Array.isArray(data.history) ? data.history : []) {
            const meta = displayMeta(item?.meta);
            if (!meta || typeof item.videoId !== 'string' || !item.videoId || !Number.isFinite(item.position) || item.position < 0 || !Number.isFinite(item.duration) || item.duration < 0 || !Number.isFinite(item.updated)) continue;
            const value = {meta,videoId:item.videoId.slice(0,500),position:item.position,duration:item.duration,updated:item.updated};
            if (!ids.has(historyKey(value))) {history.push(value);ids.add(historyKey(value));}
        }
        return {version:1,favourites,history:history.sort((a,b)=>b.updated-a.updated).slice(0,100)};
    } catch {return empty();}
}
export function writeLibrary(storage: Pick<Storage,'setItem'>, library: Library): boolean {
    try {storage.setItem(LIBRARY_KEY,JSON.stringify(library));return true;} catch {return false;}
}
export function toggleFavourite(library: Library, value: Meta): Library {
    const meta = displayMeta(value);if (!meta) return library;
    const found = library.favourites.some(m=>titleKey(m)===titleKey(meta));
    // Existing favourites are never silently evicted at the limit.
    if (!found && library.favourites.length >= 100) return library;
    return {...library,favourites:found ? library.favourites.filter(m=>titleKey(m)!==titleKey(meta)) : [meta,...library.favourites]};
}
export function rememberPlayback(library: Library, meta: Meta, videoId: string, position: number): Library {
    const clean = displayMeta(meta);if (!clean) return library;
    const key = `${clean.type}:${videoId}`;const old = library.history.find(item=>historyKey(item)===key);
    return {...library,history:[{meta:clean,videoId,position:Number.isFinite(position)?Math.max(0,position):0,duration:old?.duration || 0,updated:Date.now()},...library.history.filter(item=>titleKey(item.meta)!==titleKey(clean))].slice(0,100)};
}
export function updateProgress(library: Library, progress: {id: string; position: number; duration?: number; ended?: boolean}): Library {
    if (!Number.isFinite(progress.position) || progress.position < 0) return library;
    const duration = Number.isFinite(progress.duration) && progress.duration! > 0 ? progress.duration! : 0;
    const complete = progress.ended || (duration > 0 && progress.position >= duration-15);
    return {...library,history:library.history.flatMap(item=>historyKey(item)!==progress.id ? [item] : complete ? [] : [{...item,position:progress.position,duration:duration || item.duration,updated:Date.now()}]).sort((a,b)=>b.updated-a.updated)};
}
export function continueWatching(library: Library): HistoryItem[] {
    // One card per series, pointing to its most recently watched episode.
    const seen = new Set<string>();return library.history.filter(item=>{
        const key=titleKey(item.meta);if (item.position<=5 || (item.duration>0 && item.position>=item.duration-15) || seen.has(key)) return false;
        seen.add(key);return true;
    });
}
export function resumeLabel(item: HistoryItem): string {
    const episode = item.meta.type==='series' && /:\d+:\d+$/.test(item.videoId) ? `S${item.videoId.split(':').at(-2)} E${item.videoId.split(':').at(-1)} · ` : '';
    return episode+(item.duration>item.position ? `${Math.ceil((item.duration-item.position)/60)} min remaining` : `${Math.floor(item.position/60)} min watched`);
}
