import { createContext } from 'react';

import type { HomeDisplaySettings } from '../services/qortium/homeDisplaySettings';

export const DisplaySettingsContext = createContext<HomeDisplaySettings | null>(
  null
);
