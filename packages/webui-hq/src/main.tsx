import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/manrope';
import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-mono';
import '@xyflow/react/dist/style.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HqApp } from './app.js';
import { scrubTokenFromUrl } from './lib/auth.js';
import { getHqClient } from './lib/hq-ws-client.js';
import { useHqStore } from './store.js';

const container = document.getElementById('root');
if (container !== null) {
  scrubTokenFromUrl();
  const client = getHqClient();
  client.onStateChange((connectionState) => {
    useHqStore.getState()._setConnected(connectionState === 'connected');
  });
  client.on((msg) => {
    if (msg.type === 'hq.snapshot') {
      useHqStore.getState()._onSnapshot(msg.snapshot);
    } else if (msg.type === 'hq.event') {
      useHqStore.getState()._onEvent(msg.event);
    } else if (msg.type === 'hq.alert') {
      useHqStore.getState()._onAlert(msg);
    }
  });
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <HqApp />
    </React.StrictMode>,
  );
}
