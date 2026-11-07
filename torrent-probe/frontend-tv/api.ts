import type {Addon, Meta, Stream} from './types';

export function resourceUrl(addon: Addon, resource: string, type: string, id: string, extras: Record<string, string> = {}) {
    const url = new URL(addon.transportUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('Unsupported addon address');
    const extra = Object.entries(extras).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
    url.pathname = url.pathname.replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '') +
        `/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${extra ? '/' + extra : ''}.json`;
    return url.toString();
}
export function supports(addon: Addon, resource: string, type: string, id: string) {
    return (addon.manifest.resources || []).some(entry => {
        const descriptor = typeof entry === 'string' ? {name: entry} : entry;
        const types = descriptor.types || addon.manifest.types;
        const prefixes = descriptor.idPrefixes || addon.manifest.idPrefixes;
        return descriptor.name === resource && (!types?.length || types.includes(type)) && (!prefixes?.length || prefixes.some(prefix => id.startsWith(prefix)));
    });
}
export async function getJson<T>(url: string, signal: AbortSignal, timeout = 20000, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal.aborted) controller.abort();
    signal.addEventListener('abort', cancel, {once: true});
    const timer = setTimeout(cancel, timeout);
    try {
        const response = await fetch(url, {...init, signal: controller.signal});
        const data = await response.json();
        if (!response.ok) throw Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`);
        return data as T;
    } catch (error) {
        if (!signal.aborted && controller.signal.aborted) throw Error('The source did not respond in time.');
        throw error;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
export function availability(stream: Stream) {
    const description = stream.description || stream.title || '';
    const reported = /👤\s*(\d+)/u.exec(description);
    return {seeders: count(stream.seeders) ?? count(stream.behaviorHints?.seeders) ?? (reported ? Number(reported[1]) : null),
        leechers: count(stream.leechers) ?? count(stream.behaviorHints?.leechers)};
}
export function sourceFacts(stream: Stream) {
    const text = `${stream.name || ''} ${stream.description || stream.title || ''}`;
    return {quality: /\b(2160p|1080p|720p|480p|4k)\b/i.exec(text)?.[1] || 'Quality unknown',
        size: /💾\s*([^\n⚙️]+)/u.exec(text)?.[1]?.trim() || 'Size unknown',
        format: /\.([a-z0-9]+)$/i.exec(stream.behaviorHints?.filename || '')?.[1]?.toUpperCase() || 'Format unknown'};
}
export function friendlyFailure(message: string) {
    if (/metadata|source did not respond|timed? ?out/i.test(message)) return {
        title: 'No responding peers or seeders',
        message: 'We couldn’t get the source information needed to start this video. Try another source with more seeders.'};
    if (/cache|storage|disk/i.test(message)) return {title: 'Not enough streaming storage', message: 'Free some device storage or clear unused cache in Settings, then try again.'};
    if (/file index|episode auto-selection/i.test(message)) return {title: 'This source cannot identify the episode', message: 'Choose another source for this episode.'};
    return {title: 'This source could not start', message: 'The source did not return a playable video. Try another source or retry.'};
}
export function safeImage(value?: string) { return value && /^https?:\/\//i.test(value) ? value : undefined; }
export function uniqueMetas(items: Meta[]) {return Array.from(new Map(items.filter(m => m.id && m.name).map(m => [`${m.type}:${m.id}`, m])).values());}
const memory = new Map<string, {expires: number; data: unknown}>();
export async function cachedJson<T>(url: string, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const hit = memory.get(url);
    if (hit && hit.expires > Date.now()) return hit.data as T;
    const data = await getJson<T>(url, signal);
    if (memory.size >= 48) memory.delete(memory.keys().next().value as string);
    memory.set(url, {expires: Date.now() + 120000, data});return data;
}
export async function loadMeta(addons: Addon[], type: string, id: string, signal: AbortSignal) {
    const eligible = addons.filter(a => supports(a, 'meta', type, id));
    if (!eligible.length) throw Error('No installed addon provides details for this title.');
    return Promise.any(eligible.map(async addon => {
        const result = await cachedJson<{meta: Meta}>(resourceUrl(addon, 'meta', type, id), signal);
        if (!result.meta?.id) throw Error('No details returned');
        return {meta: {...result.meta, type: result.meta.type || type}, addon};
    }));
}

