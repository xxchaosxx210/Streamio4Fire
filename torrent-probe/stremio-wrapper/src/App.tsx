import {WebView} from '@amazon-devices/webview';
import * as React from 'react';
import {useEffect, useRef, useState} from 'react';
import {VegaTransport} from '@amazon-devices/vegatransport';
import {addonInstallRoute} from './addonLinks';
import {AppState, Text, View, StyleSheet} from 'react-native';
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
  const [engineReady, setEngineReady] = useState(false);
  const [engineUrl, setEngineUrl] = useState('');
  const [webUrl, setWebUrl] = useState('');
  const [engineError, setEngineError] = useState<string | null>(null);
  useEffect(() => {
    const start = () => {
      try {
        const url = VegaTransport.start();
        console.info('EMBEDDED_TORRENT_READY', url);
        setEngineUrl(url);
        setWebUrl(current => current || url);
        setEngineError(null);
        setEngineReady(true);
      } catch (error) {
        setEngineError(String(error));
      }
    };
    start();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') {
        setEngineReady(false);
        VegaTransport.stop();
      } else if (state === 'active') {
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
    if (engineError) hideSplashScreenCallback();
  }, [engineError, hideSplashScreenCallback]);
  return (
    <View style={styles.container}>
      {!engineReady && <Text style={{color: 'white', fontSize: 28, padding: 40}}>
        {engineError ?? 'Starting local streaming engine...'}
      </Text>}
      {engineReady && <WebView
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
          console.info('Page loading completed...');
          // Hide the splash screen
          hideSplashScreenCallback();
        }}
        onLoadStart={(_event: WebViewNavigationEvent) => {
          console.info('Page loading started...');
        }}
        onError={({
          nativeEvent: {code, url, description},
        }: WebViewErrorEvent) => {
          console.error(`[onError]: (${code}: ${url}) ${description}`);
        }}
        onHttpError={({
          nativeEvent: {url, statusCode: code, description, isMainFrame},
        }: WebViewHttpErrorEvent) => {
          console.error(`[onHttpError]: (${code}: ${url}) ${description}`);
          console.error(`[onHttpError]: isMainFrame: ${isMainFrame}`);
        }}
        onSslError={({code, url, description}: SslErrorData) => {
          console.error(`[onSslError]: (${code}: ${url}) ${description}`);
        }}
      />}
    </View>
  );
};

// Styles for layout, which are necessary for proper focus behavior
const styles = StyleSheet.create({
  container: {flex: 1},
  webview: {backgroundColor: '#000000'},
});
