import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import i18n from '../i18n/index.js';
import {
  applyHomeDisplaySettings,
  getHomeDisplayUpdate,
  isTrustedHomeDisplayEvent,
  loadHomeDisplaySettings,
  preferLiveHomeDisplaySettings,
  readHomeDisplaySettingsFromUrl,
  removeObsoleteDisplayOverrides,
} from '../services/qortium/homeDisplaySettings';
import { DisplaySettingsContext } from './displaySettingsContextValue';

const initialSettings = () =>
  typeof window === 'undefined'
    ? readHomeDisplaySettingsFromUrl('')
    : readHomeDisplaySettingsFromUrl(window.location.search);

export const DisplaySettingsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [settings, setSettings] = useState(initialSettings);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
    applyHomeDisplaySettings(settings, document.documentElement);
    if (i18n.language !== settings.language) {
      void i18n.changeLanguage(settings.language);
    }
  }, [settings]);

  useEffect(() => {
    removeObsoleteDisplayOverrides(window.localStorage);

    let active = true;
    void loadHomeDisplaySettings(settingsRef.current).then((loaded) => {
      if (!active) return;
      setSettings((current) => {
        const next = preferLiveHomeDisplaySettings(current, loaded);
        settingsRef.current = next;
        return next;
      });
    });

    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedHomeDisplayEvent(event.source, window)) return;
      setSettings((current) => {
        const updated = getHomeDisplayUpdate(event.data, current);
        if (!updated) return current;
        settingsRef.current = updated;
        return updated;
      });
    };
    window.addEventListener('message', handleMessage);

    return () => {
      active = false;
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const value = useMemo(() => settings, [settings]);
  return (
    <DisplaySettingsContext.Provider value={value}>
      {children}
    </DisplaySettingsContext.Provider>
  );
};
