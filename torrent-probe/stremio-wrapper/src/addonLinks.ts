/** Convert an addon install URI into the local Stremio confirmation route. */
export function addonInstallRoute(candidate: string, appBase: string): string | null {
  if (!/^stremio:\/\/[a-z0-9.-]+(?::[0-9]+)?\//i.test(candidate)) return null;
  if (candidate.includes('#') || !candidate.split('?')[0].endsWith('/manifest.json')) return null;
  const manifest = candidate.replace(/^stremio:/i, 'https:');
  return `${appBase.split('#')[0]}#/addons?addon=${encodeURIComponent(manifest)}`;
}
