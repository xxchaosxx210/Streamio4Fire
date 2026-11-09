export type Manifest = {
    id: string; name: string; types?: string[];
    resources?: Array<string | {name: string; types?: string[]; idPrefixes?: string[]}>;
    idPrefixes?: string[];
    catalogs?: Array<{id: string; type: string; name?: string; extra?: Array<{name: string; options?: string[]; isRequired?: boolean}>; extraSupported?: string[]}>;
};
export type Addon = {manifest: Manifest; transportUrl: string};
export type Video = {id: string; title?: string; season?: number; episode?: number; released?: string};
export type Meta = {id: string; type: string; name: string; poster?: string; background?: string; description?: string; releaseInfo?: string; runtime?: string; genres?: string[]; videos?: Video[]};
export type Stream = {
    name?: string; title?: string; description?: string; infoHash?: string; fileIdx?: number;
    url?: string; seeders?: number; leechers?: number;
    behaviorHints?: {filename?: string; seeders?: number; leechers?: number; [key: string]: unknown};
    [key: string]: unknown;
};
export type Source = {key: string; addon: Addon; stream: Stream};
export type Selection = {source: Source; meta: Meta; metaAddon: Addon; videoId: string; back: string; started: number; readyAt?: number; preparing: boolean; error: string | null};
