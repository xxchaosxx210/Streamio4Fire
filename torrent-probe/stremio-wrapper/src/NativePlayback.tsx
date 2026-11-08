import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, BackHandler, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {KeplerVideoView, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {handleTVPress, NativePlaybackRequest} from './nativePlayback';

export type NativeProgress = {id: string; position: number; duration: number; ended: boolean};
export function NativePlayback({request, onProgress, onClose}: {request: NativePlaybackRequest; onProgress: (progress: NativeProgress) => void; onClose: (progress: NativeProgress) => void}) {
  const video = useRef<VideoPlayer | null>(null);
  const close = useRef<() => void>(() => {});
  const [ready, setReady] = useState<VideoPlayer | null>(null);
  const [status, setStatus] = useState('Connecting to video…');
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controls, setControls] = useState(true);
  const [waiting, setWaiting] = useState(true);
  const [focus, setFocus] = useState('pause');
  const [preferFocus, setPreferFocus] = useState(true);
  const [seekMessage, setSeekMessage] = useState('');
  const seekAttempt = useRef<{from: number; target: number; started: number; paused: boolean; seekedAt?: number; warned?: boolean} | null>(null);
  const [stats, setStats] = useState({peers: null as number | null, speed: null as number | null});
  const shown = useRef(Date.now());
  const lastAction = useRef({id: '', at: 0});
  const heldKeys = useRef(new Set<string>());
  const uiState = useRef({controls, waiting, error, focus});uiState.current = {controls, waiting, error, focus};
  const callbacks = useRef({onProgress, onClose});callbacks.current = {onProgress, onClose};
  const reveal = () => {shown.current = Date.now();setControls(true);};
  const toggle = () => {
    const current = video.current;if (!current) return;
    reveal();
    if (current.paused) void current.play().catch(() => setError('Playback could not resume. Choose another source or try again.'));
    else current.pause();
    setPaused(current.paused);
  };
  const seek = (amount: number) => {
    const current = video.current;if (!current || !Number.isFinite(current.duration)) return;
    const from = current.currentTime;const target = Math.max(0, Math.min(current.duration - 0.2, from + amount));
    seekAttempt.current = {from, target, started: Date.now(), paused: current.paused};
    setSeekMessage(`Seeking ${amount > 0 ? 'forward' : 'back'} 10 seconds…`);reveal();
    try {current.fastSeek(target);} catch {try {current.currentTime = target;} catch {seekAttempt.current = null;setSeekMessage('This source could not move to that time.');}}
  };
  useEffect(() => {if (controls || waiting || error) setPreferFocus(true);}, [controls, waiting, error]);
  const activate = (id: string, action: () => void) => {
    const now = Date.now();if (lastAction.current.id === id && now-lastAction.current.at < 300) return;
    lastAction.current = {id, at: now};action();
  };
  useTVEventHandler(event => {
    if (!handleTVPress(heldKeys.current, event.eventType, event.eventKeyAction)) {
      if (event.eventKeyAction === 1 && ['select','enter'].includes(event.eventType)) lastAction.current.at = Date.now();
      return;
    }
    const ui = uiState.current;
    if (event.eventType === 'playpause') toggle();
    else if (['select', 'enter'].includes(event.eventType) && ui.controls) {
      const id = ui.waiting || ui.error ? 'cancel' : ui.focus;
      activate(id, () => {if (id === 'cancel' || id === 'back') close.current();else if (id === 'rewind') seek(-10);else if (id === 'forward') seek(10);else toggle();});
    }
    else if (event.eventType === 'rewind' || event.eventType === 'skip_backward') seek(-10);
    else if (['forward', 'skip_forward', 'fastforward', 'fast_forward'].includes(event.eventType)) seek(10);
    else if (!ui.controls && ['left', 'right'].includes(event.eventType)) seek(event.eventType === 'left' ? -10 : 10);
    else if (['up', 'down', 'left', 'right', 'select', 'menu'].includes(event.eventType)) reveal();
  });
  useEffect(() => {
    const current = new VideoPlayer();video.current = current;
    let active = true, initialized = false, closing = false, played = false, resumed = false, bufferingSince = 0, lastProgress = 0, advancing = 0, previousTime = 0;
    const started = Date.now();
    const progress = (ended = false): NativeProgress => ({id: request.id, position: Number.isFinite(current.currentTime) ? current.currentTime : 0, duration: Number.isFinite(current.duration) ? current.duration : 0, ended});
    const release = async () => {if (initialized) {initialized = false;try {current.pause();await current.deinitialize();} catch { /* Already deinitialized on shutdown. */ }}};
    const finish = async (ended = false) => {
      if (closing) return;closing = true;
      const saved = progress(ended);callbacks.current.onProgress(saved);
      await release();if (active) callbacks.current.onClose(saved);
    };
    close.current = () => {void finish();};
    const playing = () => {if (!active) return;played = true;bufferingSince = 0;setWaiting(false);setPaused(false);setStatus('Playing');shown.current = Date.now();};
    const failed = () => {if (active) {setWaiting(false);setError('We could not open this video. The source may be unavailable or use an unsupported video or audio format. Try another source.');setControls(true);}};
    const ended = () => {void finish(true);};
    const seeked = () => {if (seekAttempt.current) seekAttempt.current.seekedAt = Date.now();};
    current.addEventListener('playing', playing);current.addEventListener('error', failed);current.addEventListener('ended', ended);current.addEventListener('seeked', seeked);
    const back = BackHandler.addEventListener('hardwareBackPress', () => {void finish();return true;});
    const background = AppState.addEventListener('change', state => {if (state === 'background') void finish();});
    const timer = setInterval(() => {
      if (!active || !initialized || closing) return;
      const position = current.currentTime;
      setTime(position || 0);setDuration(Number.isFinite(current.duration) ? current.duration : 0);setPaused(current.paused);
      const attempt = seekAttempt.current;
      if (attempt) {
        const elapsed = (Date.now()-attempt.started)/1000;
        const sinceSeek = (Date.now()-(attempt.seekedAt || attempt.started))/1000;
        const expected = attempt.target + (attempt.paused ? 0 : sinceSeek);
        const tolerance = Math.min(3, Math.abs(attempt.target-attempt.from)/2);
        // A normal clock reaching the target ten seconds later is not a seek.
        if (elapsed > 1.2 && (attempt.seekedAt ? sinceSeek > 1.2 : elapsed < 3) && Math.abs(position-expected) < tolerance) {seekAttempt.current = null;setSeekMessage('');}
        else if (elapsed > 8 && !attempt.warned) {attempt.warned = true;setSeekMessage('The video has not moved to that time yet. It may be buffering, or this source may not support seeking.');shown.current = Date.now();setControls(true);}
        else if (elapsed > 30) seekAttempt.current = null;
      }
      if (!resumed && played && current.duration > 0) {resumed = true;if (request.position > 5 && request.position < current.duration - 15) current.currentTime = request.position;}
      if (position > previousTime + 0.05) advancing = Date.now();previousTime = position;
      if (!played && Date.now() - started > 45000) {setWaiting(false);setError('The video has not started. The source may be too slow or use an unsupported codec. Choose another source.');}
      if (played && !current.paused && Date.now() - advancing > 1800) {bufferingSince ||= Date.now();setWaiting(true);setStatus('Buffering video…');}
      else if (played && (current.paused || Date.now() - advancing < 1200)) {bufferingSince = 0;setWaiting(false);}
      if (played && !current.paused && !seekAttempt.current && Date.now() - shown.current > 4000) setControls(false);
      if (Date.now() - lastProgress > 5000) {lastProgress = Date.now();callbacks.current.onProgress(progress());}
    }, 500);
    void current.initialize().then(async () => {
      initialized = true;if (!active || closing) {await release();return;}
      setReady(current);current.src = request.url;await current.play();
    }).catch(() => {if (active) {setWaiting(false);setError('The native player could not start. Return to the source list and try again.');}});
    return () => {
      active = false;clearInterval(timer);back.remove();background.remove();current.removeEventListener('playing', playing);current.removeEventListener('error', failed);current.removeEventListener('ended', ended);current.removeEventListener('seeked', seeked);void release();video.current = null;
    };
  }, [request]);
  useEffect(() => {
    if (!request.hash) return;
    let active = true;const controller = new AbortController();let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {const response = await fetch(`http://127.0.0.1:11470/torrents/${request.hash}/stats/v1`, {signal: controller.signal});const data = await response.json();if (active) setStats({peers: data.live?.snapshot?.peer_stats?.live ?? null, speed: data.live?.download_speed?.mbps ?? null});} catch { /* Missing stats do not mean playback failed. */ }
      if (active) timer = setTimeout(poll, 2000);
    };void poll();return () => {active = false;controller.abort();clearTimeout(timer);};
  }, [request.hash]);
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  const button = (id: string, label: string, action: () => void) => <TouchableOpacity key={id} activeOpacity={0.9} hasTVPreferredFocus={preferFocus && (id === 'pause' || id === 'cancel')} onFocus={() => {setPreferFocus(false);uiState.current.focus = id;setFocus(id);reveal();}} onPress={() => activate(id, action)} style={[styles.button, focus === id && styles.focus]} accessibilityRole="button"><Text style={styles.text}>{label}</Text></TouchableOpacity>;
  return <View style={styles.root}>
    {ready && <KeplerVideoView style={styles.video} videoPlayer={ready} scalingmode="fit" showControls={false} />}
    {(waiting || error) && <View style={styles.loading}>
      <Text style={styles.title}>{request.title}</Text><Text style={styles.text}>{error || status}</Text>
      {duration > 0 && <Text style={styles.text}>{clock(time)} / {clock(duration)}</Text>}
      {!error && <><ActivityIndicator size="large" color="#4ce0df" accessibilityLabel={status} /><Text style={styles.text}>Connecting / buffering…</Text><Text style={styles.text}>Reported seeders: {request.seeders ?? 'Unknown'} · Leechers: {request.leechers ?? 'Unknown'}</Text><Text style={styles.text}>Connected peers: {stats.peers ?? 'Unknown'} · Download: {stats.speed === null ? 'Unknown' : `${stats.speed.toFixed(2)} MB/s`}</Text></>}
      {button('cancel', 'Choose another source', () => close.current())}
    </View>}
    {!waiting && !error && controls && <View style={styles.controls}><Text style={styles.title}>{request.title}</Text><Text style={styles.text}>{clock(time)} / {clock(duration)}</Text>{!!seekMessage && <Text style={styles.text}>{seekMessage}</Text>}<View style={styles.row}>{button('back', 'Back to sources', () => close.current())}{button('rewind', '−10 sec', () => seek(-10))}{button('pause', paused ? 'Play' : 'Pause', toggle)}{button('forward', '+10 sec', () => seek(10))}</View></View>}
  </View>;
}
const styles = StyleSheet.create({
  root: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'black'},
  video: {flex: 1, zIndex: 0},text: {fontSize: 25, color: 'white', marginBottom: 12},title: {fontSize: 32, color: 'white', marginBottom: 16},
  loading: {position: 'absolute', zIndex: 20, top: '20%', left: '10%', right: '10%', padding: 32, backgroundColor: '#171d35ee'},
  controls: {position: 'absolute', zIndex: 10, left: 0, right: 0, bottom: 0, padding: 32, backgroundColor: '#101426ee'},row: {flexDirection: 'row'},
  button: {padding: 18, backgroundColor: '#333a56', marginRight: 18, borderWidth: 3, borderColor: 'transparent', borderRadius: 10},focus: {borderColor: '#4ce0df', backgroundColor: '#50598a'},
});
