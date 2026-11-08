import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, BackHandler, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {KeplerVideoView, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {handleTVPress, NativePlaybackRequest, remuxEndpoint} from './nativePlayback';
import {RemuxPlayback} from './RemuxPlayback';
import {SeekBar} from './SeekBar';
import {TimelineScrub, timelineClock, timelinePosition} from './timeline';

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
  const [hasPlayed, setHasPlayed] = useState(false);
  const [focus, setFocus] = useState('pause');
  const [preferFocus, setPreferFocus] = useState(true);
  const [preferredControl, setPreferredControl] = useState('pause');
  const [preview, setPreview] = useState<number|null>(null);
  const scrubber = useRef(new TimelineScrub());
  const scrubHold = useRef<{key:string;direction:number;started:number}|null>(null);
  const scrubTimer = useRef<ReturnType<typeof setInterval>|null>(null);
  const [seekMessage, setSeekMessage] = useState('');
  const seekAttempt = useRef<{from: number; target: number; started: number; paused: boolean; seekedAt?: number; warned?: boolean} | null>(null);
  const remux = useRef<RemuxPlayback|null>(null);
  const preparing = useRef(false);
  const movieDuration = useRef(0);
  const lastPosition = useRef(0);
  const [stats, setStats] = useState({peers: null as number | null, speed: null as number | null});
  const shown = useRef(Date.now());
  const lastAction = useRef({id: '', at: 0});
  const heldKeys = useRef(new Set<string>());
  const uiState = useRef({controls, waiting, error, focus});uiState.current = {controls, waiting, error, focus};
  const callbacks = useRef({onProgress, onClose});callbacks.current = {onProgress, onClose};
  const reveal = () => {shown.current = Date.now();uiState.current.controls=true;setControls(true);};
  const toggle = () => {
    const current = video.current;if (!current) return;
    reveal();
    if (current.paused) void current.play().catch(() => setError('Playback could not resume. Choose another source or try again.'));
    else current.pause();
    setPaused(current.paused);
  };
  const seekTo = (target: number, message: string) => {
    const current=video.current;if(!current || preparing.current)return;
    cancelScrub();target=timelinePosition(target,movieDuration.current);
    const from=current.currentTime;const wasPaused=current.paused;
    seekAttempt.current = {from, target, started: Date.now(), paused: current.paused};
    setSeekMessage(message);reveal();
    const endpoint=remuxEndpoint(request.url);
    if(endpoint && (request.container==='mkv' || remux.current)){
      remux.current?.dispose();preparing.current=true;setWaiting(true);setStatus('Preparing video at the requested time…');
      const session=new RemuxPlayback(current,endpoint,movieDuration.current,message=>{setError(message);setWaiting(false);setControls(true);});remux.current=session;
      // A failed rebind has no valid clock; retain the last known resume point until close.
      void session.start(target,wasPaused).then(()=>{if(remux.current===session){preparing.current=false;seekAttempt.current=null;setSeekMessage('');setWaiting(false);}}).catch(error=>{if(remux.current===session){session.dispose();setWaiting(false);setError(String(error.message || 'This source could not seek.'));setControls(true);}});
      return;
    }
    try {current.fastSeek(target);} catch {try {current.currentTime = target;} catch {seekAttempt.current = null;setSeekMessage('This source could not move to that time.');}}
  };
  const seek = (amount:number) => {const current=video.current;if(!current || movieDuration.current<=0)return;seekTo(Math.max(0,Math.min(movieDuration.current-0.2,current.currentTime+amount)),`Seeking ${amount>0?'forward':'back'} 10 seconds…`);};
  const stopScrubHold = (key?:string) => {if(key && scrubHold.current?.key!==key)return;if(scrubTimer.current)clearInterval(scrubTimer.current);scrubTimer.current=null;scrubHold.current=null;};
  const cancelScrub = () => {stopScrubHold();scrubber.current.cancel();setPreview(null);shown.current=Date.now();};
  const focusTimeline = () => {uiState.current.focus='timeline';setFocus('timeline');setPreferredControl('timeline');setPreferFocus(true);reveal();};
  const stepScrub = (direction:number,heldMs=0) => {if(preparing.current || movieDuration.current<=0)return;reveal();setPreview(scrubber.current.step(video.current?.currentTime || 0,movieDuration.current,direction,heldMs));};
  const commitScrub = () => {stopScrubHold();const target=scrubber.current.commit();setPreview(null);reveal();if(target!==null && Math.abs(target-(video.current?.currentTime || 0))>0.2)seekTo(target,`Seeking to ${timelineClock(target)}…`);};
  useEffect(() => {if (controls || waiting || error) setPreferFocus(true);if(waiting || error){setPreferredControl('pause');cancelScrub();}}, [controls, waiting, error]);
  useEffect(() => () => {if(scrubTimer.current)clearInterval(scrubTimer.current);}, []);
  const activate = (id: string, action: () => void) => {
    const now = Date.now();if (lastAction.current.id === id && now-lastAction.current.at < 300) return;
    lastAction.current = {id, at: now};action();
  };
  useTVEventHandler(event => {
    const ui = uiState.current;
    if(['left','right'].includes(event.eventType) && (!ui.controls || ui.focus==='timeline') && !ui.waiting && !ui.error) {
      const direction=event.eventType==='left'?-1:1;
      if(event.eventKeyAction===1){const paired=heldKeys.current.delete(event.eventType);stopScrubHold(event.eventType);if(!paired){focusTimeline();stepScrub(direction);}}
      else if(event.eventKeyAction===0){
        if(heldKeys.current.has(event.eventType))return;
        heldKeys.current.add(event.eventType);stopScrubHold();focusTimeline();stepScrub(direction);
        scrubHold.current={key:event.eventType,direction,started:Date.now()};
        scrubTimer.current=setInterval(()=>{const hold=scrubHold.current;if(!hold)return;const elapsed=Date.now()-hold.started;if(elapsed>=450)stepScrub(hold.direction,elapsed);},250);
      }else if(!scrubHold.current){focusTimeline();stepScrub(direction);}
      return;
    }
    if (!handleTVPress(heldKeys.current, event.eventType, event.eventKeyAction)) {
      if (event.eventKeyAction === 1 && ['select','enter'].includes(event.eventType)) lastAction.current.at = Date.now();
      return;
    }
    if (event.eventType === 'playpause') {cancelScrub();toggle();}
    else if (['select', 'enter'].includes(event.eventType) && ui.controls) {
      if (ui.waiting && hasPlayed && !ui.error) return;
      const id = ui.waiting || ui.error ? 'cancel' : ui.focus;
      activate(id, () => {if (id === 'cancel' || id === 'back') close.current();else if(id==='timeline')commitScrub();else if (id === 'rewind') seek(-10);else if (id === 'forward') seek(10);else toggle();});
    }
    else if (event.eventType === 'rewind' || event.eventType === 'skip_backward') seek(-10);
    else if (['forward', 'skip_forward', 'fastforward', 'fast_forward'].includes(event.eventType)) seek(10);
    else if (['up', 'down', 'left', 'right', 'select', 'menu'].includes(event.eventType)) reveal();
  });
  useEffect(() => {
    const current = new VideoPlayer();video.current = current;
    let active = true, initialized = false, closing = false, played = false, resumed = false, bufferingSince = 0, lastProgress = 0, advancing = 0, previousTime = 0;
    const started = Date.now();
    const progress = (ended = false): NativeProgress => ({id: request.id, position: preparing.current ? lastPosition.current : Number.isFinite(current.currentTime) ? current.currentTime : 0, duration: movieDuration.current, ended});
    const release = async () => {remux.current?.dispose();remux.current=null;preparing.current=false;if (initialized) {initialized = false;try {current.pause();await current.deinitialize();} catch { /* Already deinitialized on shutdown. */ }}};
    const finish = async (ended = false) => {
      if (closing) return;closing = true;
      const saved = progress(ended);callbacks.current.onProgress(saved);
      await release();if (active) callbacks.current.onClose(saved);
    };
    close.current = () => {void finish();};
    const playing = () => {if (!active) return;played = true;setHasPlayed(true);bufferingSince = 0;setWaiting(false);setPaused(false);setStatus('Playing');shown.current = Date.now();};
    const failed = () => {if (active) {setWaiting(false);setError('We could not open this video. The source may be unavailable or use an unsupported video or audio format. Try another source.');setControls(true);}};
    const ended = () => {void finish(true);};
    const seeked = () => {if (seekAttempt.current) seekAttempt.current.seekedAt = Date.now();};
    current.addEventListener('playing', playing);current.addEventListener('error', failed);current.addEventListener('ended', ended);current.addEventListener('seeked', seeked);
    const back = BackHandler.addEventListener('hardwareBackPress', () => {if(scrubber.current.preview!==null){cancelScrub();return true;}void finish();return true;});
    const background = AppState.addEventListener('change', state => {if (state === 'background') void finish();});
    const timer = setInterval(() => {
      if (!active || !initialized || closing) return;
      const position = current.currentTime;
      if(!remux.current && Number.isFinite(current.duration) && current.duration>0)movieDuration.current=current.duration;
      if(preparing.current)return;
      lastPosition.current=position || 0;
      setTime(position || 0);setDuration(movieDuration.current);setPaused(current.paused);
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
      if (!resumed && played && movieDuration.current > 0) {resumed = true;if (request.position > 5 && request.position < movieDuration.current - 15) {lastPosition.current=request.position;seekTo(request.position,'Resuming from the saved position…');if(preparing.current)return;}}
      if (position > previousTime + 0.05) advancing = Date.now();previousTime = position;
      if (!played && Date.now() - started > 45000) {setWaiting(false);setError('The video has not started. The source may be too slow or use an unsupported codec. Choose another source.');}
      if (played && !current.paused && Date.now() - advancing > 1800) {bufferingSince ||= Date.now();setWaiting(true);setStatus('Buffering video…');}
      else if (played && (current.paused || Date.now() - advancing < 1200)) {bufferingSince = 0;setWaiting(false);}
      if (played && !current.paused && !seekAttempt.current && scrubber.current.preview===null && Date.now() - shown.current > 4000) setControls(false);
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
  const button = (id: string, label: string, action: () => void) => <TouchableOpacity key={id} activeOpacity={0.9} hasTVPreferredFocus={preferFocus && (id === preferredControl || id === 'cancel')} onFocus={() => {cancelScrub();setPreferredControl('pause');setPreferFocus(false);uiState.current.focus = id;setFocus(id);reveal();}} onPress={() => activate(id, action)} style={[styles.button, focus === id && styles.focus]} accessibilityRole="button"><Text style={styles.text}>{label}</Text></TouchableOpacity>;
  return <View style={styles.root}>
    {ready && <KeplerVideoView style={styles.video} videoPlayer={ready} scalingmode="fit" showControls={false} />}
    {waiting && hasPlayed && !error && <View pointerEvents="none" style={styles.buffering}><ActivityIndicator size="small" color="#4ce0df" accessibilityLabel={status} /><Text style={styles.bufferingText}>Buffering…</Text></View>}
    {((waiting && !hasPlayed) || error) && <View style={styles.loading}>
      <Text style={styles.title}>{request.title}</Text><Text style={styles.text}>{error || status}</Text>
      {duration > 0 && <Text style={styles.text}>{clock(time)} / {clock(duration)}</Text>}
      {!error && <><ActivityIndicator size="large" color="#4ce0df" accessibilityLabel={status} /><Text style={styles.text}>Connecting / buffering…</Text><Text style={styles.text}>Reported seeders: {request.seeders ?? 'Unknown'}</Text><Text style={styles.text}>Connected peers: {stats.peers ?? 'Unknown'} · Download: {stats.speed === null ? 'Unknown' : `${stats.speed.toFixed(2)} MB/s`}</Text></>}
      {button('cancel', 'Choose another source', () => close.current())}
    </View>}
    {!waiting && !error && controls && <View style={styles.controls}><Text style={styles.title}>{request.title}</Text>
      <SeekBar position={time} duration={duration} preview={preview} focused={focus==='timeline'} preferred={preferFocus && preferredControl==='timeline'}
        onFocus={()=>{setPreferFocus(false);uiState.current.focus='timeline';setFocus('timeline');reveal();}}
        onBlur={cancelScrub} onCancel={cancelScrub} onCommit={commitScrub} onStep={direction=>stepScrub(direction)}
        onDrag={(x,width)=>{if(preparing.current)return;focusTimeline();setPreview(scrubber.current.drag(x,width,movieDuration.current));}} />
      {!!seekMessage && <Text style={styles.text}>{seekMessage}</Text>}<View style={styles.row}>{button('back', 'Back to sources', () => close.current())}{button('rewind', '−10 sec', () => seek(-10))}{button('pause', paused ? 'Play' : 'Pause', toggle)}{button('forward', '+10 sec', () => seek(10))}</View></View>}
  </View>;
}
const styles = StyleSheet.create({
  root: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'black'},
  video: {flex: 1, zIndex: 0},text: {fontSize: 25, color: 'white', marginBottom: 12},title: {fontSize: 32, color: 'white', marginBottom: 16},
  loading: {position: 'absolute', zIndex: 20, top: '20%', left: '10%', right: '10%', padding: 32, backgroundColor: 'transparent'},
  buffering: {position: 'absolute', zIndex: 20, bottom: 48, right: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent'},
  bufferingText: {fontSize: 23, color: 'white', marginLeft: 12, textShadowColor: 'black', textShadowOffset: {width: 1, height: 1}, textShadowRadius: 3},
  controls: {position: 'absolute', zIndex: 10, left: 0, right: 0, bottom: 0, padding: 32, backgroundColor: '#101426ee'},row: {flexDirection: 'row'},
  button: {padding: 18, backgroundColor: '#333a56', marginRight: 18, borderWidth: 3, borderColor: 'transparent', borderRadius: 10},focus: {borderColor: '#4ce0df', backgroundColor: '#50598a'},
});
