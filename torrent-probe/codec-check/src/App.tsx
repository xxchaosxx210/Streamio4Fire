import React, {useEffect, useState} from 'react';
import {AppState, BackHandler, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useHideSplashScreenCallback, usePreventHideSplashScreen} from '@amazon-devices/react-native-kepler';
import {VideoPlayer, KeplerVideoView} from '@amazon-devices/react-native-w3cmedia';


type Fixture = {id: string; file: string; video: string; audio: string};
type Result = {id: string; outcome: string; seconds: number; frames: number; width: number; height: number; audioTracks: number; seek: boolean; pauseResume: boolean; error?: string};
function report(result: Result) {
  console.info('CODEC_CHECK_RESULT', JSON.stringify(result));
  void fetch('http://127.0.0.1:18080/results', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(result)}).catch(() => {});
}

// This app has its own package ID. The normal Streamio4Fire player is untouched.
export function App() {
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const [status, setStatus] = useState('Starting native codec checks…');
  const [results, setResults] = useState<Result[]>([]);
  const [run, setRun] = useState(0);
  usePreventHideSplashScreen();
  const hideSplash = useHideSplashScreenCallback();
  useEffect(() => {
    let active = true;
    let current: VideoPlayer | null = null;
    let cancelSample: (() => void) | undefined;

    const finishPlayer = async () => {
      const video = current;current = null;
      if (active) setPlayer(null);
      if (video) {try {video.pause();await video.deinitialize();} catch { /* Reported by sample. */ }}
    };
    const background = AppState.addEventListener('change', state => {
      if (state === 'background') {active = false;cancelSample?.();void finishPlayer();}
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      active = false;cancelSample?.();void finishPlayer();setStatus('Checks stopped.');return true;
    });
    async function sample(base: string, fixture: Fixture): Promise<Result> {
      const video = new VideoPlayer();current = video;
      let played = false, seek = false, pauseResume = false, startTime = 0;
      let result: Result = {id: fixture.id, outcome: 'failed', seconds: 0, frames: 0, width: 0, height: 0, audioTracks: 0, seek: false, pauseResume: false};
      await video.initialize();
      if (!active) return result;
      setPlayer(video);setStatus(fixture.id);
      return new Promise(resolve => {
        let complete = false;
        const started = Date.now();
        const timers: Array<ReturnType<typeof setTimeout>> = [];
        const done = (error?: string) => {
          if (complete) return;complete = true;clearInterval(poll);timers.forEach(clearTimeout);
          try {
            result = {...result, seconds: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames,
              width: video.videoWidth, height: video.videoHeight, audioTracks: video.audioTracks.length, seek, pauseResume,
              outcome: error ? 'failed' : 'playing', ...(error ? {error} : {})};
          } catch (reason) {result.error = String(reason);}
          video.removeEventListener('playing', onPlaying);video.removeEventListener('error', onError);
          report(result);resolve(result);
        };
        const onError = () => done(`Media error ${video.error?.code}: ${video.error?.message || 'unknown'}`);
        const onPlaying = () => {played = true;};
        const poll = setInterval(() => {
          if (!active) {done('cancelled');return;}
          const elapsed = Date.now() - started;
          try {
            if (played && elapsed > 2500 && !seek && video.duration > 9) {
              startTime = video.currentTime;video.currentTime = 8;
              seek = true;
            }
            if (played && elapsed > 4000 && !pauseResume) {
              video.pause();
              const paused = video.paused;
              timers.push(setTimeout(() => {if (!complete) void video.play().then(() => {pauseResume = paused;}).catch(error => done(String(error)));}, 300));
              // Avoid scheduling another pause while the resume is pending.
              pauseResume = paused;
            }
            if (elapsed > 6500 && played && video.currentTime > 9) {
              seek = seek && video.currentTime > startTime + 2;done();
            } else if (elapsed > 20000) done('No advancing playback within 20 seconds');
          } catch (error) {done(String(error));}
        }, 250);
        cancelSample = () => done('cancelled');
        video.addEventListener('playing', onPlaying);video.addEventListener('error', onError);
        video.src = base + encodeURIComponent(fixture.file);
        void video.play().catch(error => done(String(error)));
      });
    }
    async function checks() {
      try {
        const base = 'http://127.0.0.1:18080/';hideSplash();
        const response = await fetch(base + 'fixtures.json');
        if (!response.ok) throw Error(`Fixtures unavailable (${response.status})`);
        const fixtures = await response.json() as Fixture[];
        setResults([]);
        for (const fixture of fixtures) {
          if (!active) break;
          try {
            const result = await sample(base, fixture);
            if (active) setResults(previous => [...previous, result]);
          } catch (error) {
            const result = {id: fixture.id, outcome: 'failed', error: String(error), seconds: 0, frames: 0, width: 0, height: 0, audioTracks: 0, seek: false, pauseResume: false};
            report(result);
            if (active) setResults(previous => [...previous, result]);
          } finally {await finishPlayer();}
        }
        if (active) {setStatus('Checks complete — audio still needs listening confirmation.');console.info('CODEC_CHECK_COMPLETE');}
      } catch (error) {if (active) setStatus(String(error));hideSplash();}
    }
    void checks();
    return () => {active = false;cancelSample?.();background.remove();back.remove();void finishPlayer();};
  }, [run, hideSplash]);
  return <View style={styles.root}>
    {player && <KeplerVideoView style={styles.video} videoPlayer={player} scalingmode="fit" showControls={false} />}
    <View style={styles.panel}>
      <Text style={styles.title}>Streamio4Fire · Native codec check</Text>
      <Text style={styles.text}>{status}</Text>
      <Text style={styles.text}>Generated moving pattern and quiet tone · 640 × 360 · test app only</Text>
      {results.slice(-5).map(result => <Text key={result.id} style={styles.text}>{result.id}: {result.outcome} · {result.seconds.toFixed(1)}s{result.error ? ` · ${result.error}` : ''}</Text>)}
      <TouchableOpacity style={styles.button} onPress={() => setRun(value => value + 1)} accessibilityRole="button"><Text style={styles.text}>Run again</Text></TouchableOpacity>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#101322'},
  video: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  panel: {position: 'absolute', top: 20, left: 24, right: 24, padding: 20, backgroundColor: '#101322dd'},
  title: {fontSize: 30, color: '#50dddd', marginBottom: 12},
  text: {fontSize: 22, color: 'white', marginBottom: 8},
  button: {backgroundColor: '#4b4382', padding: 12, width: 190, marginTop: 8},
});
