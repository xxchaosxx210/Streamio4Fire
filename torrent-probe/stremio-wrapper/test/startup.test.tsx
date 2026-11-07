import * as React from 'react';
import renderer, {act} from 'react-test-renderer';

const mockHideSplash = jest.fn();
let mockAppStateChange: (state: string) => void;
const mockStart = jest.fn(() => 'http://127.0.0.1:11470/app/');
const mockStop = jest.fn();
jest.mock('react-native', () => ({
  AppState: {addEventListener: (_event: string, listener: (state: string) => void) => {
    mockAppStateChange = listener; return {remove: jest.fn()};
  }},
  Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: {create: (styles: unknown) => styles},
}));
jest.mock('@amazon-devices/webview', () => ({WebView: 'WebView'}));
jest.mock('@amazon-devices/vegatransport', () => ({
  VegaTransport: {start: (...args: []) => mockStart(...args), stop: () => mockStop()},
}));
jest.mock('@amazon-devices/react-native-kepler', () => ({
  usePreventHideSplashScreen: jest.fn(),
  useHideSplashScreenCallback: () => mockHideSplash,
}));
import {App} from '../src/App';

let tree: renderer.ReactTestRenderer;
beforeEach(() => {
  mockStart.mockClear();mockStop.mockClear();
  jest.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {tree = renderer.create(<App />);});
});
test('keyboard focus and duplicate active events keep the current page', () => {
  act(() => web().props.onLoad({}));
  const currentPage = web();
  act(() => {mockAppStateChange('inactive');mockAppStateChange('active');mockAppStateChange('active');});
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockStop).not.toHaveBeenCalled();
  expect(web()).toBe(currentPage);
  act(() => jest.advanceTimersByTime(25000));
  expect(web()).toBe(currentPage);
});
test('a genuine background return restarts the engine once', () => {
  act(() => mockAppStateChange('background'));
  expect(mockStop).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType('WebView' as any)).toHaveLength(0);
  act(() => {mockAppStateChange('active');mockAppStateChange('active');});
  expect(mockStart).toHaveBeenCalledTimes(2);
  expect(web()).toBeDefined();
});
afterEach(() => {act(() => tree.unmount());jest.useRealTimers();});
const web = () => tree.root.findByType('WebView' as any);

test('a stalled page shows Retry and retry remounts the local page', () => {
  expect(web()).toBeDefined();
  act(() => jest.advanceTimersByTime(20000));
  expect(tree.root.findAllByType('WebView' as any)).toHaveLength(0);
  const retry = tree.root.findByType('TouchableOpacity' as any);
  act(() => retry.props.onPress());
  expect(web().props.source.uri).toBe('http://127.0.0.1:11470/app/');
  expect(tree.root.findAllByType('TouchableOpacity' as any)).toHaveLength(0);
});
test('a loaded page does not later time out', () => {
  const url = 'http://127.0.0.1:11470/app/';
  act(() => web().props.onLoadStart({nativeEvent: {url}}));
  act(() => web().props.onError({nativeEvent: {code: -29, url, description: 'transient'}}));
  act(() => web().props.onLoad({}));
  act(() => jest.advanceTimersByTime(25000));
  expect(web()).toBeDefined();
  expect(tree.root.findAllByType('TouchableOpacity' as any)).toHaveLength(0);
});
test('only main-frame HTTP errors replace the page with Retry', () => {
  act(() => web().props.onHttpError({nativeEvent: {statusCode: 404, isMainFrame: false}}));
  expect(web()).toBeDefined();
  act(() => web().props.onHttpError({nativeEvent: {statusCode: 503, isMainFrame: true}}));
  expect(tree.root.findByType('TouchableOpacity' as any)).toBeDefined();
});
test('a failed auxiliary resource does not replace the page', () => {
  const url = 'http://127.0.0.1:11470/app/';
  act(() => web().props.onLoadStart({nativeEvent: {url}}));
  act(() => web().props.onError({nativeEvent: {code: -29, url: 'https://example.invalid/helper.js', description: 'failed'}}));
  expect(web()).toBeDefined();
  act(() => web().props.onError({nativeEvent: {code: -29, url, description: 'failed'}}));
  expect(web()).toBeDefined();
  act(() => jest.advanceTimersByTime(20000));
  expect(tree.root.findByType('TouchableOpacity' as any)).toBeDefined();
});
