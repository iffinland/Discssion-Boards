import i18n from '../src/i18n/index.js';
import {
  DEFAULT_HOME_DISPLAY_SETTINGS,
  applyHomeDisplaySettings,
  getHomeDisplayUpdate,
  loadHomeDisplaySettings,
  normalizeAppLanguage,
  normalizeHomeDisplaySettings,
  preferLiveHomeDisplaySettings,
  readHomeDisplaySettingsFromUrl,
  removeObsoleteDisplayOverrides,
  type HomeDisplayEnvironment,
} from '../src/services/qortium/homeDisplaySettings.js';
import { parseForumVideoInput } from '../src/services/forum/videoEmbed.js';

const environment: HomeDisplayEnvironment = {
  prefersDark: false,
  preferredLanguages: ['en-US'],
};
const darkEnvironment: HomeDisplayEnvironment = {
  prefersDark: true,
  preferredLanguages: ['fi-FI', 'en-US'],
};

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

let passed = 0;
const test = async (name: string, run: () => void | Promise<void>) => {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
};

await test('Home light theme applied', () => {
  const value = normalizeHomeDisplaySettings(
    { theme: 'light' },
    undefined,
    'home-bridge',
    environment
  );
  assert(value.theme === 'light', 'light theme was not applied');
});

await test('Home dark theme applied', () => {
  const value = normalizeHomeDisplaySettings(
    { theme: 'dark' },
    undefined,
    'home-bridge',
    environment
  );
  assert(value.theme === 'dark', 'dark theme was not applied');
});

await test('system theme resolves from the current environment', () => {
  const value = normalizeHomeDisplaySettings(
    { theme: 'system' },
    undefined,
    'home-bridge',
    darkEnvironment
  );
  assert(value.theme === 'dark', 'system theme did not resolve to dark');
});

await test('missing theme falls back safely', () => {
  const value = normalizeHomeDisplaySettings(
    {},
    DEFAULT_HOME_DISPLAY_SETTINGS,
    'home-bridge',
    environment
  );
  assert(
    value.theme === 'light' && value.availability === 'unavailable',
    'missing theme fallback failed'
  );
});

await test('Home accent applied', () => {
  const value = normalizeHomeDisplaySettings(
    { accent: 'purple' },
    undefined,
    'home-bridge',
    environment
  );
  assert(value.accent === 'purple', 'purple accent was not applied');
});

await test('invalid accent falls back and reports malformed input', () => {
  const value = normalizeHomeDisplaySettings(
    { accent: 'ultraviolet' },
    undefined,
    'home-bridge',
    environment
  );
  assert(
    value.accent === 'green' && value.availability === 'malformed',
    'accent fallback failed'
  );
});

await test('semantic color state is independent from accent application', () => {
  const dataset: DOMStringMap = { semantic: 'error' };
  const target = { dataset, dir: '', lang: '', style: { colorScheme: '' } };
  applyHomeDisplaySettings(
    { ...DEFAULT_HOME_DISPLAY_SETTINGS, accent: 'red' },
    target
  );
  assert(
    dataset.accent === 'red' && dataset.semantic === 'error',
    'accent changed semantic state'
  );
});

await test('text-size preference applied', () => {
  const value = normalizeHomeDisplaySettings(
    { textSize: 'large' },
    undefined,
    'home-bridge',
    environment
  );
  assert(value.textScale === 'large', 'large text was not applied');
});

await test('huge text uses the centralized root setting', () => {
  const dataset: DOMStringMap = {};
  applyHomeDisplaySettings(
    { ...DEFAULT_HOME_DISPLAY_SETTINGS, textScale: 'huge' },
    { dataset, dir: '', lang: '', style: { colorScheme: '' } }
  );
  assert(dataset.textSize === 'huge', 'huge text root attribute missing');
});

await test('Classic style is accepted', () => {
  const value = normalizeHomeDisplaySettings(
    { ui: 'classic' },
    undefined,
    'home-bridge',
    environment
  );
  assert(value.styleMode === 'classic', 'classic style missing');
});

await test('Modern style is accepted', () => {
  const value = normalizeHomeDisplaySettings(
    { uiStyle: 'modern' },
    undefined,
    'home-event',
    environment
  );
  assert(value.styleMode === 'modern', 'modern style missing');
});

await test('current Home fun style is accepted', () => {
  const value = normalizeHomeDisplaySettings(
    { ui: 'fun' },
    undefined,
    'home-bridge',
    environment
  );
  assert(value.styleMode === 'fun', 'fun style missing');
});

await test('Home English language preference applied', () => {
  const value = normalizeHomeDisplaySettings(
    { language: 'en' },
    undefined,
    'home-bridge',
    environment
  );
  assert(value.language === 'en', 'English was not applied');
});

await test('locale variant normalizes to an available base language', () => {
  assert(
    normalizeAppLanguage('en-US', environment) === 'en',
    'en-US did not normalize to en'
  );
});

await test('unsupported language falls back without misleading persistence', () => {
  const value = normalizeHomeDisplaySettings(
    { language: 'fi' },
    undefined,
    'home-bridge',
    environment
  );
  assert(
    value.language === 'en' && value.availability === 'partial',
    'unsupported language fallback failed'
  );
});

await test('missing translation falls back to its key', () => {
  assert(
    i18n.t('test.missing.translation') === 'test.missing.translation',
    'missing-key fallback changed'
  );
});

await test('i18next initializes deterministically', () => {
  assert(
    i18n.isInitialized && i18n.language === 'en',
    'i18next was not initialized synchronously'
  );
});

await test('Home settings unavailable falls back', async () => {
  const value = await loadHomeDisplaySettings(
    DEFAULT_HOME_DISPLAY_SETTINGS,
    async () => {
      throw new Error('unavailable');
    },
    environment
  );
  assert(
    value.theme === 'light' && value.availability === 'unavailable',
    'bridge fallback failed'
  );
});

await test('malformed settings do not break startup', () => {
  const value = normalizeHomeDisplaySettings(
    'not-an-object',
    undefined,
    'home-bridge',
    environment
  );
  assert(
    value.availability === 'malformed' && value.theme === 'light',
    'malformed fallback failed'
  );
});

await test('stale local theme is removed and cannot override Home', () => {
  const values = new Map([
    ['forum-theme-mode', 'dark-cyan'],
    ['board-sort', 'latest'],
  ]);
  removeObsoleteDisplayOverrides({ removeItem: (key) => values.delete(key) });
  assert(!values.has('forum-theme-mode'), 'obsolete theme survived');
  assert(
    values.get('board-sort') === 'latest',
    'app-specific setting was removed'
  );
});

await test('individual missing fields preserve a higher-quality Home fallback', () => {
  const url = readHomeDisplaySettingsFromUrl(
    '?theme=dark&accent=blue&textSize=large&lang=en&uiStyle=modern',
    environment
  );
  const bridge = normalizeHomeDisplaySettings(
    { theme: 'light' },
    url,
    'home-bridge',
    environment
  );
  assert(
    bridge.theme === 'light' && bridge.accent === 'blue',
    'field-level precedence failed'
  );
});

await test('reload yields the same effective settings', () => {
  const search =
    '?theme=dark&accent=teal&textSize=extra-large&lang=en-US&uiStyle=fun';
  const first = readHomeDisplaySettingsFromUrl(search, environment);
  const second = readHomeDisplaySettingsFromUrl(search, environment);
  assert(
    JSON.stringify(first) === JSON.stringify(second),
    'reload normalization was not deterministic'
  );
});

await test('qdn video link renders as a supported reference', () => {
  const reference = parseForumVideoInput('qdn://VIDEO/Example/clip');
  assert(
    reference?.service === 'VIDEO' && reference.name === 'Example',
    'qdn:// parsing failed'
  );
});

await test('obsolete qortal video scheme is not treated as active input', () => {
  assert(
    parseForumVideoInput('qortal://VIDEO/Example/clip') === null,
    'obsolete qortal:// input was accepted'
  );
});

await test('core user-facing flows exist in translation resources', () => {
  const keys = [
    'navigation.home',
    'topic.create',
    'thread.create',
    'post.publish',
    'moderation.forumRoles',
    'poll.submit',
    'tip.send',
    'attachment.uploadFailed',
    'search.noResults',
    'status.forumLoadFailed',
  ];
  assert(
    keys.every((key) => i18n.exists(key)),
    'a core translation key is missing'
  );
});

await test('bridge-unavailable message localizes with English fallback', () => {
  assert(
    i18n.t('bridge.unavailable').includes('Qortium Home'),
    'bridge message fallback missing'
  );
});

await test('access disclosure warning is localized', () => {
  assert(
    i18n.t('access.restrictedData').includes('QDN'),
    'access warning key missing'
  );
});

await test('consolidated Home live update is normalized', () => {
  const value = getHomeDisplayUpdate(
    {
      type: 'qortium:home-settings-changed',
      detail: {
        theme: 'dark',
        accent: 'pink',
        textSize: 'small',
        lang: 'en',
        uiStyle: 'modern',
      },
    },
    DEFAULT_HOME_DISPLAY_SETTINGS,
    environment
  );
  assert(
    value?.source === 'home-event' && value.accent === 'pink',
    'consolidated event failed'
  );
});

await test('legacy-compatible single-setting Home event is normalized', () => {
  const value = getHomeDisplayUpdate(
    { action: 'ACCENT_CHANGED', accent: 'yellow' },
    DEFAULT_HOME_DISPLAY_SETTINGS,
    environment
  );
  assert(
    value?.accent === 'yellow' && value.theme === 'light',
    'single-setting event failed'
  );
});

await test('back-to-back individual Home events preserve earlier updates', () => {
  const dark = getHomeDisplayUpdate(
    { action: 'THEME_CHANGED', theme: 'dark' },
    DEFAULT_HOME_DISPLAY_SETTINGS,
    environment
  );
  const accented = getHomeDisplayUpdate(
    { action: 'ACCENT_CHANGED', accent: 'purple' },
    dark ?? DEFAULT_HOME_DISPLAY_SETTINGS,
    environment
  );
  assert(
    accented?.theme === 'dark' && accented.accent === 'purple',
    'sequential events lost an earlier setting'
  );
});

await test('a slower bridge read cannot overwrite a newer live event', () => {
  const live = normalizeHomeDisplaySettings(
    { theme: 'dark' },
    DEFAULT_HOME_DISPLAY_SETTINGS,
    'home-event',
    environment
  );
  const loaded = normalizeHomeDisplaySettings(
    { theme: 'light' },
    DEFAULT_HOME_DISPLAY_SETTINGS,
    'home-bridge',
    environment
  );
  assert(
    preferLiveHomeDisplaySettings(live, loaded).theme === 'dark',
    'bridge response overwrote live state'
  );
});

await test('unknown frame messages are ignored', () => {
  assert(
    getHomeDisplayUpdate(
      { action: 'SOMETHING_ELSE' },
      DEFAULT_HOME_DISPLAY_SETTINGS,
      environment
    ) === null,
    'unknown message was accepted'
  );
});

console.log(`Qortium Home display/localization tests passed: ${passed}`);
