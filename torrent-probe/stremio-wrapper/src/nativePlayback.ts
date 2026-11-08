export type NativePlaybackRequest = {type: 'native-play'; id: string; title: string; url: string; position: number; container?: 'mkv'; returnUrl?: string; hash?: string; seeders?: number | null; leechers?: number | null};
export function isBundledPage(url: unknown): boolean {return typeof url === 'string' && url.startsWith('http://127.0.0.1:11470/app/');}
export function remuxEndpoint(url: string): string | null {
  const match=/^http:\/\/127\.0\.0\.1:11470\/([a-f0-9]{40})\/(\d+)$/i.exec(url);
  return match ? `http://127.0.0.1:11470/remux/${match[1]}/${match[2]}` : null;
}
/** Some Vega controls emit release-only Select events; handle each press once. */
export function handleTVPress(held: Set<string>, key: string, action?: number): boolean {
  if (action === 0) {if (held.has(key)) return false;held.add(key);return true;}
  if (action === 1) return !held.delete(key);
  return true;
}

/** Only bundled UI messages may launch HTTP media. Never log source URLs. */
export function nativePlaybackRequest(data: string): NativePlaybackRequest | null {
  if (data.length > 20000) return null;
  try {
    const value = JSON.parse(data);
    if (value.type !== 'native-play' || typeof value.id !== 'string' || value.id.length > 500 || typeof value.title !== 'string' || typeof value.url !== 'string') return null;
    if (!/^https?:\/\/[^\s]+$/i.test(value.url) || /[\u0000-\u001f]/.test(value.url)) return null;
    return {type: 'native-play', id: value.id, title: value.title.slice(0, 300), url: value.url,
      container: value.container === 'mkv' ? 'mkv' : undefined,
      returnUrl: isBundledPage(value.returnUrl) && value.returnUrl.length <= 4096 ? value.returnUrl : undefined,
      position: typeof value.position === 'number' && Number.isFinite(value.position) ? Math.max(0, value.position) : 0,
      hash: typeof value.hash === 'string' && /^[a-f0-9]{40}$/i.test(value.hash) ? value.hash : undefined,
      seeders: typeof value.seeders === 'number' && Number.isFinite(value.seeders) && value.seeders >= 0 ? value.seeders : null,
      leechers: typeof value.leechers === 'number' && Number.isFinite(value.leechers) && value.leechers >= 0 ? value.leechers : null};
  } catch {return null;}
}
