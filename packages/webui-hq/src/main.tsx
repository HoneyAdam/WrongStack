import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono';
import '@xyflow/react/dist/style.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HqApp } from './app.js';
import { scrubTokenFromUrl } from './lib/auth.js';
import { getHqClient } from './lib/hq-ws-client.js';

const container = document.getElementById('root');
if (container !== null) {
  // Persist a ?token= into sessionStorage and drop it from the address bar
  // BEFORE the WS client captures its URL — every consumer reads the token
  // through lib/auth.ts, so nothing downstream needs the query param.
  scrubTokenFromUrl();
  // Open the WS connection; the app subscribes via useHqStore.
  getHqClient();
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <HqApp />
    </React.StrictMode>,
  );
}
