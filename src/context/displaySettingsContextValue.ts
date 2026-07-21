import { createContext, useContext } from 'react';

import type { HomeDisplaySettings } from '../services/qortium/homeDisplaySettings';

export const DisplaySettingsContext = createContext<HomeDisplaySettings | null>(
  null
);

export const useDisplaySettings = () => {
  const settings = useContext(DisplaySettingsContext);
  if (!settings) {
    throw new Error(
      'useDisplaySettings must be used within DisplaySettingsProvider.'
    );
  }
  return settings;
};
