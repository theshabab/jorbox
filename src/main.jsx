import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { registerOfflineSupport } from './utils/offline';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline play and home-screen install. Development builds skip it so stale
// cached files never hide local changes.
if (import.meta.env.PROD) registerOfflineSupport();
