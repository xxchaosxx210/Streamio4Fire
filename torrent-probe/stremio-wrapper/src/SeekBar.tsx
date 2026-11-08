import React, {useRef, useState} from 'react';
import {findNodeHandle, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {timelineClock, TRACK_INSET} from './timeline';

type Props = {
  position: number; duration: number; preview: number | null; focused: boolean; preferred: boolean;
  onFocus: () => void; onBlur: () => void; onCommit: () => void; onCancel: () => void;
  onDrag: (x: number, width: number) => void; onStep: (direction: number) => void;
};
export function SeekBar(props: Props) {
  const ref = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const width = useRef(0);
  const dragging = useRef(false);
  const [tag, setTag] = useState<number | undefined>();
  const proportion = (time: number) => Math.max(0, Math.min(100, props.duration > 0 ? time / props.duration * 100 : 0));
  const target = props.preview ?? props.position;
  return <View onStartShouldSetResponderCapture={() => true}
    onResponderGrant={event => {dragging.current = true;props.onDrag(event.nativeEvent.locationX, width.current);}}
    onResponderMove={event => {if (dragging.current) props.onDrag(event.nativeEvent.locationX, width.current);}}
    onResponderRelease={() => {if (dragging.current) {dragging.current = false;props.onCommit();}}}
    onResponderTerminate={() => {dragging.current = false;props.onCancel();}}>
    <TouchableOpacity ref={ref} activeOpacity={1} hasTVPreferredFocus={props.preferred}
    nextFocusLeft={tag} nextFocusRight={tag}
    accessibilityRole="adjustable" accessibilityLabel="Playback timeline"
    accessibilityHint="Use Left or Right to preview a time. Hold to move faster. Select to seek. Back to cancel."
    accessibilityValue={{min: 0, max: props.duration, now: target, text: timelineClock(target)}}
    accessibilityActions={[{name: 'increment'}, {name: 'decrement'}, {name: 'activate'}]}
    onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'activate') props.onCommit();else {props.onStep(event.nativeEvent.actionName === 'increment' ? 1 : -1);props.onCommit();}}}
    onLayout={event => {width.current = event.nativeEvent.layout.width;setTag(findNodeHandle(ref.current) ?? undefined);}}
    onFocus={props.onFocus} onBlur={() => {dragging.current = false;props.onBlur();}}
    onPress={props.onCommit}
    style={[styles.root, props.focused && styles.focus]}>
    <View pointerEvents="none" style={styles.labels}>
      <Text style={styles.time}>{timelineClock(props.position)}</Text>
      <Text style={styles.preview}>{props.preview === null ? '' : `Jump to ${timelineClock(props.preview)}`}</Text>
      <Text style={styles.time}>{timelineClock(props.duration)}</Text>
    </View>
    <View pointerEvents="none" style={styles.track}>
      <View style={[styles.played, {width: `${proportion(props.position)}%`}]} />
      {props.preview !== null && <View style={[styles.current, {left: `${proportion(props.position)}%`}]} />}
      <View style={[styles.thumb, {left: `${proportion(target)}%`}]} />
    </View>
    <Text pointerEvents="none" style={[styles.hint, {opacity: props.focused || props.preview !== null ? 1 : 0}]}>Left/Right: scrub · Hold: faster · Select: jump · Back: cancel</Text>
  </TouchableOpacity></View>;
}
const styles = StyleSheet.create({
  root: {borderWidth: 2, borderColor: 'transparent', borderRadius: 12, paddingHorizontal: TRACK_INSET - 2, paddingVertical: 10, marginBottom: 14},
  focus: {borderColor: '#4ce0df', backgroundColor: '#28314c'},
  labels: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14},
  time: {fontSize: 23, color: 'white'}, preview: {fontSize: 23, color: '#73f4e8'},
  track: {height: 8, backgroundColor: '#58627a', borderRadius: 4, marginBottom: 14},
  played: {height: 8, backgroundColor: '#6297ed', borderRadius: 4},
  thumb: {position: 'absolute', top: -7, width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: '#4ce0df', borderWidth: 2, borderColor: 'white'},
  current: {position: 'absolute', top: -1, width: 10, height: 10, marginLeft: -5, borderRadius: 5, backgroundColor: 'white'},
  hint: {fontSize: 18, color: '#d9e1f2', textAlign: 'center'},
});
