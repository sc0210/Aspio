'use client';

import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n';

interface I18nProviderProps {
  children: React.ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  useEffect(() => {
    // Set HTML lang attribute (i18n is already initialized in lib/i18n.ts)
    const currentLang = i18n.language || 'zh-TW';
    document.documentElement.lang = currentLang;

    // Listen for language changes
    const handleLanguageChange = (lng: string) => {
      document.documentElement.lang = lng;
      
      // Update document title if needed
      const title = document.title;
      if (title.includes('Aspiro')) {
        // Keep the same title structure but could be localized in the future
        document.title = title;
      }
    };

    i18n.on('languageChanged', handleLanguageChange);

    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      {children}
    </I18nextProvider>
  );
}