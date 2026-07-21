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
] as const;

export const HOME_TEXT_SIZES = [
  'extra-small',
  'small',
  'medium',
  'large',
  'extra-large',
  'huge',
] as const;

export const HOME_STYLE_MODES = ['classic', 'modern', 'fun'] as const;

export type HomeAccent = (typeof HOME_ACCENTS)[number];
export type HomeTextSize = (typeof HOME_TEXT_SIZES)[number];
export type HomeStyleMode = (typeof HOME_STYLE_MODES)[number];
export type HomeTheme = 'light' | 'dark';
export type HomeDisplaySettingsSource =
  | 'default'
  | 'home-url'
  | 'home-bridge'
  | 'home-event';
export type HomeDisplaySettingsAvailability =
  | 'available'
  | 'partial'
  | 'unavailable'
  | 'malformed';

export type HomeDisplaySettings = {
  theme: HomeTheme;
  accent: HomeAccent;
  textScale: HomeTextSize;
  language: string;
  styleMode: HomeStyleMode;
  source: HomeDisplaySettingsSource;
  availability: HomeDisplaySettingsAvailability;
};

export type HomeDisplayEnvironment = {
  prefersDark: boolean;
  preferredLanguages: readonly string[];
};

export type HomeSettingsRequest = (
  payload: Record<string, unknown>
) => Promise<unknown> | unknown;

type RootDisplayTarget = {
  dataset: DOMStringMap;
  dir: string;
  lang: string;
  style: Pick<CSSStyleDeclaration, 'colorScheme'>;
};

const APP_LANGUAGES = ['en'] as const;
const OBSOLETE_THEME_STORAGE_KEY = 'forum-theme-mode';

export const DEFAULT_HOME_DISPLAY_SETTINGS: HomeDisplaySettings = {
  theme: 'light',
  accent: 'green',
  textScale: 'medium',
  language: 'en',
  styleMode: 'classic',
  source: 'default',
  availability: 'unavailable',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const includes = <T extends string>(
  values: readonly T[],
  value: unknown
): value is T => typeof value === 'string' && values.includes(value as T);

export const getHomeDisplayEnvironment = (): HomeDisplayEnvironment => ({
  prefersDark:
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  preferredLanguages:
    typeof navigator === 'undefined'
      ? ['en']
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language || 'en'],
});

export const normalizeAppLanguage = (
  value: unknown,
  environment: HomeDisplayEnvironment
) => {
  const candidates =
    value === 'system' || value === undefined
      ? environment.preferredLanguages
      : typeof value === 'string'
        ? [value]
        : [];

  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    const base = normalized.split('-')[0];
    if (APP_LANGUAGES.includes(base as (typeof APP_LANGUAGES)[number])) {
      return base;
    }
  }

  return DEFAULT_HOME_DISPLAY_SETTINGS.language;
};

const resolveTheme = (
  value: unknown,
  environment: HomeDisplayEnvironment
): HomeTheme | null => {
  if (value === 'system') {
    return environment.prefersDark ? 'dark' : 'light';
  }
  return value === 'light' || value === 'dark' ? value : null;
};

type CandidateKey = 'theme' | 'accent' | 'textScale' | 'language' | 'styleMode';

const candidateValue = (value: Record<string, unknown>, key: CandidateKey) => {
  if (key === 'textScale') return value.textSize ?? value.textScale;
  if (key === 'language') return value.language ?? value.lang;
  if (key === 'styleMode') return value.ui ?? value.uiStyle ?? value.styleMode;
  return value[key];
};

export const normalizeHomeDisplaySettings = (
  value: unknown,
  fallback: HomeDisplaySettings = DEFAULT_HOME_DISPLAY_SETTINGS,
  source: HomeDisplaySettingsSource = 'home-bridge',
  environment: HomeDisplayEnvironment = getHomeDisplayEnvironment()
): HomeDisplaySettings => {
  if (!isRecord(value)) {
    return {
      ...fallback,
      source,
      availability:
        value === undefined || value === null ? 'unavailable' : 'malformed',
    };
  }

  const keys: CandidateKey[] = [
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
    if (candidateValue(value, key) !== undefined) supplied += 1;
  }

  const theme = resolveTheme(themeValue, environment);
  if (themeValue !== undefined && theme === null) invalid += 1;
  const accent = includes(HOME_ACCENTS, accentValue)
    ? accentValue
    : fallback.accent;
  if (accentValue !== undefined && !includes(HOME_ACCENTS, accentValue))
    invalid += 1;
  const textScale = includes(HOME_TEXT_SIZES, textScaleValue)
    ? textScaleValue
    : fallback.textScale;
  if (
    textScaleValue !== undefined &&
    !includes(HOME_TEXT_SIZES, textScaleValue)
  )
    invalid += 1;
  const styleMode = includes(HOME_STYLE_MODES, styleModeValue)
    ? styleModeValue
    : fallback.styleMode;
  if (
    styleModeValue !== undefined &&
    !includes(HOME_STYLE_MODES, styleModeValue)
  )
    invalid += 1;
  const language = normalizeAppLanguage(languageValue, environment);
  if (
    languageValue !== undefined &&
    languageValue !== 'system' &&
    (typeof languageValue !== 'string' ||
      language !== languageValue.toLowerCase().split('-')[0])
  ) {
    unsupported += 1;
  }

  return {
    theme: theme ?? fallback.theme,
    accent,
    textScale,
    language,
    styleMode,
    source,
    availability:
      invalid > 0
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

export const readHomeDisplaySettingsFromUrl = (
  search: string,
  environment: HomeDisplayEnvironment = getHomeDisplayEnvironment()
) => {
  const params = new URLSearchParams(search);
  return normalizeHomeDisplaySettings(
    {
      theme: params.get('theme') ?? undefined,
      accent: params.get('accent') ?? undefined,
      textSize: params.get('textSize') ?? undefined,
      language: params.get('lang') ?? undefined,
      uiStyle: params.get('uiStyle') ?? undefined,
    },
    DEFAULT_HOME_DISPLAY_SETTINGS,
    'home-url',
    environment
  );
};

export const loadHomeDisplaySettings = async (
  fallback: HomeDisplaySettings,
  request: HomeSettingsRequest = (payload) => requestQortium(payload),
  environment: HomeDisplayEnvironment = getHomeDisplayEnvironment()
) => {
  try {
    const response = await request({ action: 'GET_HOME_SETTINGS' });
    return normalizeHomeDisplaySettings(
      response,
      fallback,
      'home-bridge',
      environment
    );
  } catch {
    return fallback.source === 'default'
      ? { ...fallback, availability: 'unavailable' as const }
      : fallback;
  }
};

export const preferLiveHomeDisplaySettings = (
  current: HomeDisplaySettings,
  loaded: HomeDisplaySettings
) => (current.source === 'home-event' ? current : loaded);

export const getHomeDisplayUpdate = (
  data: unknown,
  current: HomeDisplaySettings,
  environment: HomeDisplayEnvironment = getHomeDisplayEnvironment()
): HomeDisplaySettings | null => {
  if (!isRecord(data)) return null;

  if (data.type === 'qortium:home-settings-changed') {
    return normalizeHomeDisplaySettings(
      data.detail,
      current,
      'home-event',
      environment
    );
  }

  const actionCandidates: Record<string, Record<string, unknown>> = {
    THEME_CHANGED: { theme: data.theme },
    LANGUAGE_CHANGED: { language: data.language },
    TEXT_SIZE_CHANGED: { textSize: data.textSize },
    ACCENT_CHANGED: { accent: data.accent },
    UI_STYLE_CHANGED: { uiStyle: data.uiStyle },
  };
  if (typeof data.action !== 'string' || !actionCandidates[data.action]) {
    return null;
  }

  return normalizeHomeDisplaySettings(
    actionCandidates[data.action],
    current,
    'home-event',
    environment
  );
};

export const isTrustedHomeDisplayEvent = (
  eventSource: MessageEventSource | null,
  currentWindow: Window
) => eventSource === currentWindow.parent || eventSource === currentWindow.top;

export const applyHomeDisplaySettings = (
  settings: HomeDisplaySettings,
  target: RootDisplayTarget
) => {
  target.dataset.theme = settings.theme;
  target.dataset.accent = settings.accent;
  target.dataset.textSize = settings.textScale;
  target.dataset.uiStyle = settings.styleMode;
  target.lang = settings.language;
  target.dir = 'ltr';
  target.style.colorScheme = settings.theme;
};

export const removeObsoleteDisplayOverrides = (
  storage: Pick<Storage, 'removeItem'>
) => {
  storage.removeItem(OBSOLETE_THEME_STORAGE_KEY);
};
