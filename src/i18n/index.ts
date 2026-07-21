import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './resources/en.js';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    initImmediate: false,
    showSupportNotice: false,
  });
}

export default i18n;
