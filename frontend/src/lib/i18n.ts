import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';

// Get saved language from localStorage or default to Traditional Chinese
const getSavedLanguage = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('aspiro-language') || localStorage.getItem('language') || 'zh-TW';
  }
  return 'zh-TW';
};

i18n
  .use(initReactI18next)
  .use(
    resourcesToBackend(
      (language: string, namespace: string) =>
        // webpackInclude is load-bearing, not an optimisation. A template-literal
        // dynamic import makes webpack build a lazy context over EVERY file
        // matching ../locales/*/*.json, so any stray directory under src/locales/
        // gets compiled into the client bundle as if it were a translation. That
        // is not hypothetical: a tool wrote logs to src/locales/logs/*.json and
        // 568KB of them were bundled as loadable chunks. Pinning the pattern to
        // the actual locale folders keeps the context to real translations.
        import(
          /* webpackInclude: /[\\/](en|zh-TW)[\\/][a-z]+\.json$/ */
          `../locales/${language}/${namespace}.json`
        ),
    ),
  )
  .init({
    lng: getSavedLanguage(),
    fallbackLng: 'en',

    interpolation: {
      escapeValue: false,
    },

    // Namespace configuration — loaded on demand, not all at startup
    defaultNS: 'common',
    ns: ['common', 'dashboard', 'transactions', 'portfolio', 'goals', 'auth', 'loans', 'groups', 'admin'],

    // Only preload the namespaces actually used on first paint
    preload: [],

    react: {
      useSuspense: false,
    },

    saveMissing: false,
    missingKeyHandler: false,
    debug: false,
  });

export default i18n;

// Language configuration
export const languages = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸',
    currency: 'USD',
    locale: 'en-US',
  },
  {
    code: 'zh-TW',
    name: 'Traditional Chinese',
    nativeName: '繁體中文',
    flag: '🇹🇼',
    currency: 'TWD',
    locale: 'zh-TW',
  },
];

// Get language by code
export const getLanguageByCode = (code: string) => {
  return languages.find(lang => lang.code === code) || languages[1];
};
// Get locale by language
export const getLocaleByLanguage = (languageCode: string) => {
  const language = getLanguageByCode(languageCode);
  return language.locale;
};
