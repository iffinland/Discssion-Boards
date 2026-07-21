import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import i18n from './i18n/index.js';
import RootApp from './RootApp';
import {
  applyHomeDisplaySettings,
  readHomeDisplaySettingsFromUrl,
} from './services/qortium/homeDisplaySettings';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const initialDisplaySettings = readHomeDisplaySettingsFromUrl(
  window.location.search
);
applyHomeDisplaySettings(initialDisplaySettings, document.documentElement);
if (i18n.language !== initialDisplaySettings.language) {
  void i18n.changeLanguage(initialDisplaySettings.language);
}

createRoot(rootElement).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
);
