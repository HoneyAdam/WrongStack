import React from 'react';
import { createRoot } from 'react-dom/client';
import { HqApp } from './app.js';
import { getHqClient } from './lib/hq-ws-client.js';

const container = document.getElementById('root');
if (container !== null) {
  // Open the WS connection; the app subscribes via useHqStore.
  getHqClient();
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <HqApp />
    </React.StrictMode>,
  );
}
