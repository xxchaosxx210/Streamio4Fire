export type NativePlaybackRequest = {type: 'native-play'; id: string; title: string; url: string; position: number; hash?: string; seeders?: number | null; leechers?: number | null};
export function isBundledPage(url: unknown): boolean {return typeof url === 'string' && url.startsWith('http://127.0.0.1:11470/app/');}

/** Only bundled UI messages may launch HTTP media. Never log source URLs. */
export function nativePlaybackRequest(data: string): NativePlaybackRequest | null {
  if (data.length > 20000) return null;
  try {
    const value = JSON.parse(data);
    if (value.type !== 'native-play' || typeof value.id !== 'string' || value.id.length > 500 || typeof value.title !== 'string' || typeof value.url !== 'string') return null;
    if (!/^https?:\/\/[^\s]+$/i.test(value.url) || /[\u0000-\u001f]/.test(value.url)) return null;
    return {type: 'native-play', id: value.id, title: value.title.slice(0, 300), url: value.url,
      position: typeof value.position === 'number' && Number.isFinite(value.position) ? Math.max(0, value.position) : 0,
      hash: typeof value.hash === 'string' && /^[a-f0-9]{40}$/i.test(value.hash) ? value.hash : undefined,
      seeders: typeof value.seeders === 'number' && Number.isFinite(value.seeders) && value.seeders >= 0 ? value.seeders : null,
      leechers: typeof value.leechers === 'number' && Number.isFinite(value.leechers) && value.leechers >= 0 ? value.leechers : null};
  } catch {return null;}
}
