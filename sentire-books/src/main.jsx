import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { initErrorTracking } from './lib/observability.js';

// No-op unless VITE_SENTRY_DSN is configured.
initErrorTracking();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
