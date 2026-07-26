import { requestQortium } from './qortiumClient.js';
export const HOME_ACCENTS = [
    'green',
    'blue',
    'orange',
    'purple',
    'red',
    'teal',
    'cyan',
    'pink',
    'yellow',
];
export const HOME_TEXT_SIZES = [
    'extra-small',
    'small',
    'medium',
    'large',
    'extra-large',
    'huge',
];
export const HOME_STYLE_MODES = ['classic', 'modern', 'fun'];
const APP_LANGUAGES = ['en'];
const OBSOLETE_THEME_STORAGE_KEY = 'forum-theme-mode';
export const DEFAULT_HOME_DISPLAY_SETTINGS = {
    theme: 'light',
    accent: 'green',
    textScale: 'medium',
    language: 'en',
    styleMode: 'classic',
    source: 'default',
    availability: 'unavailable',
};
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const includes = (values, value) => typeof value === 'string' && values.includes(value);
export const getHomeDisplayEnvironment = () => ({
    prefersDark: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false,
    preferredLanguages: typeof navigator === 'undefined'
        ? ['en']
        : navigator.languages?.length
            ? navigator.languages
            : [navigator.language || 'en'],
});
export const normalizeAppLanguage = (value, environment) => {
    const candidates = value === 'system' || value === undefined
        ? environment.preferredLanguages
        : typeof value === 'string'
            ? [value]
            : [];
    for (const candidate of candidates) {
        const normalized = candidate.trim().toLowerCase();
        const base = normalized.split('-')[0];
        if (APP_LANGUAGES.includes(base)) {
            return base;
        }
    }
    return DEFAULT_HOME_DISPLAY_SETTINGS.language;
};
const resolveTheme = (value, environment) => {
    if (value === 'system') {
        return environment.prefersDark ? 'dark' : 'light';
    }
    return value === 'light' || value === 'dark' ? value : null;
};
const candidateValue = (value, key) => {
    if (key === 'textScale')
        return value.textSize ?? value.textScale;
    if (key === 'language')
        return value.language ?? value.lang;
    if (key === 'styleMode')
        return value.ui ?? value.uiStyle ?? value.styleMode;
    return value[key];
};
export const normalizeHomeDisplaySettings = (value, fallback = DEFAULT_HOME_DISPLAY_SETTINGS, source = 'home-bridge', environment = getHomeDisplayEnvironment()) => {
    if (!isRecord(value)) {
        return {
            ...fallback,
            source,
            availability: value === undefined || value === null ? 'unavailable' : 'malformed',
        };
    }
    const keys = [
        'theme',
        'accent',
        'textScale',
        'language',
        'styleMode',
    ];
    let supplied = 0;
    let invalid = 0;
    let unsupported = 0;
    const themeValue = candidateValue(value, 'theme');
    const accentValue = candidateValue(value, 'accent');
    const textScaleValue = candidateValue(value, 'textScale');
    const languageValue = candidateValue(value, 'language');
    const styleModeValue = candidateValue(value, 'styleMode');
    for (const key of keys) {
        if (candidateValue(value, key) !== undefined)
            supplied += 1;
    }
    const theme = resolveTheme(themeValue, environment);
    if (themeValue !== undefined && theme === null)
        invalid += 1;
    const accent = includes(HOME_ACCENTS, accentValue)
        ? accentValue
        : fallback.accent;
    if (accentValue !== undefined && !includes(HOME_ACCENTS, accentValue))
        invalid += 1;
    const textScale = includes(HOME_TEXT_SIZES, textScaleValue)
        ? textScaleValue
        : fallback.textScale;
    if (textScaleValue !== undefined &&
        !includes(HOME_TEXT_SIZES, textScaleValue))
        invalid += 1;
    const styleMode = includes(HOME_STYLE_MODES, styleModeValue)
        ? styleModeValue
        : fallback.styleMode;
    if (styleModeValue !== undefined &&
        !includes(HOME_STYLE_MODES, styleModeValue))
        invalid += 1;
    const language = normalizeAppLanguage(languageValue, environment);
    if (languageValue !== undefined &&
        languageValue !== 'system' &&
        (typeof languageValue !== 'string' ||
            language !== languageValue.toLowerCase().split('-')[0])) {
        unsupported += 1;
    }
    return {
        theme: theme ?? fallback.theme,
        accent,
        textScale,
        language,
        styleMode,
        source,
        availability: invalid > 0
            ? 'malformed'
            : unsupported > 0
                ? 'partial'
                : supplied === keys.length
                    ? 'available'
                    : supplied > 0
                        ? 'partial'
                        : 'unavailable',
    };
};
export const readHomeDisplaySettingsFromUrl = (search, environment = getHomeDisplayEnvironment()) => {
    const params = new URLSearchParams(search);
    return normalizeHomeDisplaySettings({
        theme: params.get('theme') ?? undefined,
        accent: params.get('accent') ?? undefined,
        textSize: params.get('textSize') ?? undefined,
        language: params.get('lang') ?? undefined,
        uiStyle: params.get('uiStyle') ?? undefined,
    }, DEFAULT_HOME_DISPLAY_SETTINGS, 'home-url', environment);
};
export const loadHomeDisplaySettings = async (fallback, request = (payload) => requestQortium(payload), environment = getHomeDisplayEnvironment()) => {
    try {
        const response = await request({ action: 'GET_HOME_SETTINGS' });
        return normalizeHomeDisplaySettings(response, fallback, 'home-bridge', environment);
    }
    catch {
        return fallback.source === 'default'
            ? { ...fallback, availability: 'unavailable' }
            : fallback;
    }
};
export const preferLiveHomeDisplaySettings = (current, loaded) => (current.source === 'home-event' ? current : loaded);
export const getHomeDisplayUpdate = (data, current, environment = getHomeDisplayEnvironment()) => {
    if (!isRecord(data))
        return null;
    if (data.type === 'qortium:home-settings-changed') {
        return normalizeHomeDisplaySettings(data.detail, current, 'home-event', environment);
    }
    const actionCandidates = {
        THEME_CHANGED: { theme: data.theme },
        LANGUAGE_CHANGED: { language: data.language },
        TEXT_SIZE_CHANGED: { textSize: data.textSize },
        ACCENT_CHANGED: { accent: data.accent },
        UI_STYLE_CHANGED: { uiStyle: data.uiStyle },
    };
    if (typeof data.action !== 'string' || !actionCandidates[data.action]) {
        return null;
    }
    return normalizeHomeDisplaySettings(actionCandidates[data.action], current, 'home-event', environment);
};
export const isTrustedHomeDisplayEvent = (eventSource, currentWindow) => eventSource === currentWindow.parent || eventSource === currentWindow.top;
export const applyHomeDisplaySettings = (settings, target) => {
    target.dataset.theme = settings.theme;
    target.dataset.accent = settings.accent;
    target.dataset.textSize = settings.textScale;
    target.dataset.uiStyle = settings.styleMode;
    target.lang = settings.language;
    target.dir = 'ltr';
    target.style.colorScheme = settings.theme;
};
export const removeObsoleteDisplayOverrides = (storage) => {
    storage.removeItem(OBSOLETE_THEME_STORAGE_KEY);
};
