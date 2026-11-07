import {WebView} from '@amazon-devices/webview';
import * as React from 'react';
import {useEffect, useRef, useState} from 'react';
import {VegaTransport} from '@amazon-devices/vegatransport';
import {addonInstallRoute} from './addonLinks';
import {AppState, Text, TouchableOpacity, View, StyleSheet} from 'react-native';
import {
  useHideSplashScreenCallback,
  usePreventHideSplashScreen,
} from '@amazon-devices/react-native-kepler';
import {
  SslErrorData,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigationEvent,
} from '@amazon-devices/webview/dist/types/WebViewTypes';

export const App = () => {
  const webRef = useRef(null);
  const pageRequestUrl = useRef('');
  const loadFailure = useRef<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineUrl, setEngineUrl] = useState('');
  const [webUrl, setWebUrl] = useState('');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [pageAttempt, setPageAttempt] = useState(0);
  useEffect(() => {
    const start = () => {
      try {
        const url = VegaTransport.start();
        console.info('EMBEDDED_TORRENT_READY', url);
        setEngineUrl(url);
        setWebUrl(current => current || url);
        setEngineError(null);
        setPageError(null);
        setPageLoaded(false);
        setPageAttempt(attempt => attempt + 1);
        setEngineReady(true);
      } catch (error) {
        setEngineError(String(error));
      }
    };
    start();
    let backgrounded = false;
    const subscription = AppState.addEventListener('change', state => {
      console.info('APP_STATE_CHANGE', state);
      if (state === 'background') {
        backgrounded = true;
        setEngineReady(false);
        VegaTransport.stop();
      } else if (state === 'active' && backgrounded) {
        backgrounded = false;
        start();
      }
    });
    return () => {
      subscription.remove();
      VegaTransport.stop();
    };
  }, []);
  // By default splash screen is shown in app launch, as the splash
  // screen images are bundled in this app (assets/raw/ folder)
  // Declare that application wants to extend splash screen lifecycle
  usePreventHideSplashScreen();
  const hideSplashScreenCallback = useHideSplashScreenCallback();
  useEffect(() => {
    if (engineReady || engineError) hideSplashScreenCallback();
  }, [engineReady, engineError, hideSplashScreenCallback]);
  useEffect(() => {
    if (!engineReady || pageLoaded || pageError) return;
    const timeout = setTimeout(() => {
      setPageError(loadFailure.current ?? 'The app page did not finish loading. Please retry.');
      hideSplashScreenCallback();
    }, 20000);
    return () => clearTimeout(timeout);
  }, [engineReady, pageLoaded, pageError, pageAttempt, hideSplashScreenCallback]);
  const retryPage = () => {
    loadFailure.current = null;
    setPageError(null);
    setPageLoaded(false);
    setWebUrl(engineUrl);
    setPageAttempt(attempt => attempt + 1);
  };
  return (
    <View style={styles.container}>
      {engineReady && pageError && <View style={styles.failure}>
        <Text style={styles.failureText}>{pageError}</Text>
        <TouchableOpacity hasTVPreferredFocus activeOpacity={0.85} onPress={retryPage} style={styles.retry} accessibilityRole="button">
          <Text style={styles.failureText}>Retry loading</Text>
        </TouchableOpacity>
      </View>}
      {!engineReady && <Text style={{color: 'white', fontSize: 28, padding: 40}}>
        {engineError ?? 'Starting local streaming engine...'}
      </Text>}
      {engineReady && !pageError && <WebView
        key={pageAttempt}
        ref={webRef}
        style={styles.webview}
        allowSystemKeyEvents
        allowsDefaultMediaControl
        domStorageEnabled
        hasTVPreferredFocus
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="compatibility"
        // thirdPartyCookiesEnabled
        // userAgent={''}
        source={{
          // headers: {},
          uri: webUrl || engineUrl,
        }}
        onShouldStartLoadWithRequest={request => {
          if (!/^stremio:/i.test(request.url)) return true;
          const destination = addonInstallRoute(request.url, engineUrl);
          if (destination) setWebUrl(destination);
          return false;
        }}
        onLoad={(_event: WebViewNavigationEvent) => {
          loadFailure.current = null;
          setPageLoaded(true);
          console.info('Page loading completed...');
          // Hide the splash screen
          hideSplashScreenCallback();
        }}
        onLoadStart={(_event: WebViewNavigationEvent) => {
          pageRequestUrl.current = _event.nativeEvent.url;
          loadFailure.current = null;
          setPageLoaded(false);
          console.info('Page loading started...');
        }}
        onError={({
          nativeEvent: {code, url, description},
        }: WebViewErrorEvent) => {
          if (!pageLoaded && url.split('#')[0] === pageRequestUrl.current.split('#')[0]) {
            // Some renderer errors are transient or come from an old navigation.
            // Keep the page alive; only show Retry if loading actually stalls.
            loadFailure.current = `The app page could not load (${code}). Please retry.`;
          }
          console.error(`[onError]: (${code}: ${url}) ${description}`);
        }}
        onHttpError={({
          nativeEvent: {url, statusCode: code, description, isMainFrame},
        }: WebViewHttpErrorEvent) => {
          if (isMainFrame) {
            setPageError(`The app page could not load (HTTP ${code}). Please retry.`);
            hideSplashScreenCallback();
          }
          console.error(`[onHttpError]: (${code}: ${url}) ${description}`);
          console.error(`[onHttpError]: isMainFrame: ${isMainFrame}`);
        }}
        onSslError={({code, url, description}: SslErrorData) => {
          console.error(`[onSslError]: (${code}: ${url}) ${description}`);
        }}
      />}
      {engineReady && !pageLoaded && !pageError && <View pointerEvents="none" style={styles.loading}>
        <Text style={styles.failureText}>Loading Streamio4Fire…</Text>
      </View>}
    </View>
  );
};

// Styles for layout, which are necessary for proper focus behavior
const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#171727'},
  webview: {flex: 1, backgroundColor: '#000000'},
  failure: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 48},
  failureText: {color: 'white', fontSize: 28, textAlign: 'center'},
  retry: {backgroundColor: '#6252bb', borderColor: '#50d8ff', borderWidth: 3, padding: 20, marginTop: 24, borderRadius: 12},
  loading: {position: 'absolute', top: 24, left: 24, padding: 16, backgroundColor: '#171727'},
});
