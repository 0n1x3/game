'use client';

import { TonConnectUIProvider, THEME } from '@tonconnect/ui-react';
import type { UIWallet } from '@tonconnect/ui-react';
import { useState, useEffect } from 'react';
import { APP_URL } from '@/config';

const twaReturnUrl = APP_URL as `${string}://${string}`;

export function TonProvider({ children }: { children: React.ReactNode }) {
  const [manifestUrl, setManifestUrl] = useState<string>('');

  useEffect(() => {
    const manifestFile = process.env.NODE_ENV === 'production'
      ? 'tonconnect-manifest.prod.json'
      : 'tonconnect-manifest.dev.json';
    
    setManifestUrl(`${APP_URL}/${manifestFile}`);
  }, []);

  useEffect(() => {
    if (manifestUrl) {
      console.log('Manifest URL:', manifestUrl);
      console.log('Environment:', process.env.NODE_ENV);
      
      fetch(manifestUrl)
        .then(res => {
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          return res.text();
        })
        .then(text => {
          console.log('Raw response:', text);
          try {
            return JSON.parse(text);
          } catch (e) {
            console.error('JSON parse error:', e);
            throw e;
          }
        })
        .then(data => {
          console.log('Manifest loaded:', data);
          if (!data.url || !data.manifestVersion) {
            throw new Error('Invalid manifest structure');
          }
        })
        .catch(err => {
          console.error('Manifest load error:', err);
          console.error('Full error details:', err.stack);
        });
    }
  }, [manifestUrl]);

  if (!manifestUrl) return null;

  const tonkeeper: UIWallet = {
    appName: 'tonkeeper',
    name: 'Tonkeeper',
    imageUrl: 'https://tonkeeper.com/assets/tonconnect-icon.png',
    aboutUrl: 'https://tonkeeper.com',
    universalLink: 'https://app.tonkeeper.com/ton-connect',
    bridgeUrl: 'https://bridge.tonapi.io/bridge',
    jsBridgeKey: 'tonkeeper',
    platforms: ['ios', 'android', 'chrome', 'firefox', 'safari']
  };

  return (
    <TonConnectUIProvider 
      manifestUrl={manifestUrl}
      actionsConfiguration={{
        twaReturnUrl,
        skipRedirectToWallet: 'never'
      }}
      walletsListConfiguration={{
        includeWallets: [tonkeeper]
      }}
      uiPreferences={{
        theme: 'SYSTEM',
        colorsSet: {
          LIGHT: {
            connectButton: {
              background: '#2196F3',
              foreground: '#FFFFFF'
            }
          },
          DARK: {
            connectButton: {
              background: '#2196F3',
              foreground: '#FFFFFF'
            }
          }
        }
      }}
    >
      {children}
    </TonConnectUIProvider>
  );
} 
