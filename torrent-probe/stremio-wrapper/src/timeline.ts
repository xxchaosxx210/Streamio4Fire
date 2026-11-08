export const TRACK_INSET = 18;
export function timelinePosition(value: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, duration - 0.2), value));
}
export function timelineStep(heldMs: number): number {return heldMs >= 5000 ? 60 : heldMs >= 2000 ? 30 : 10;}
export function timelinePointer(x: number, width: number, duration: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(width) || !Number.isFinite(duration) || width <= TRACK_INSET * 2 || duration <= 0) return null;
  return timelinePosition((x - TRACK_INSET) / (width - TRACK_INSET * 2) * duration, duration);
}
export function timelineClock(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:` : ''}${hours ? String(minutes).padStart(2, '0') : minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
/** Preview changes never seek. Only commit consumes a pending target, once. */
export class TimelineScrub {
  preview: number | null = null;
  step(current: number, duration: number, direction: number, heldMs = 0): number {
    this.preview = timelinePosition((this.preview ?? current) + direction * timelineStep(heldMs), duration);
    return this.preview;
  }
  drag(x: number, width: number, duration: number): number | null {
    const position = timelinePointer(x, width, duration);
    if (position !== null) this.preview = position;
    return this.preview;
  }
  commit(): number | null {const value = this.preview;this.preview = null;return value;}
  cancel(): void {this.preview = null;}
}
