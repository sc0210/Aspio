'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { Button } from './Button';
import { cn } from '@/utils/cn';
import { languages, getLanguageByCode } from '@/lib/i18n';

interface LanguageSwitcherProps {
  className?: string;
  variant?: 'dropdown' | 'inline';
  showFlag?: boolean;
  showNativeName?: boolean;
  showGlobe?: boolean;
  compact?: boolean;
  dropUp?: boolean;
}

export function LanguageSwitcher({
  className,
  variant = 'dropdown',
  showFlag = true,
  showNativeName = true,
  showGlobe = true,
  compact = false,
  dropUp = false,
}: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const currentLanguage = getLanguageByCode(i18n.language);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleLanguageChange = async (languageCode: string) => {
    try {
      await i18n.changeLanguage(languageCode);
      setIsOpen(false);
      
      // Store preference in localStorage
      localStorage.setItem('aspiro-language', languageCode);
      
      // Update HTML lang attribute. setAttribute (not `.lang =`) so the compiler
      // doesn't flag a direct property mutation (react-hooks/immutability).
      document.documentElement.setAttribute('lang', languageCode);
      
    } catch (error) {
      console.error('Failed to change language:', error);
    }
  };

  if (variant === 'inline') {
    return (
      <div className={cn("flex gap-2", className)}>
        {languages.map((language) => (
          <Button
            key={language.code}
            variant={language.code === i18n.language ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => handleLanguageChange(language.code)}
            className="flex items-center space-x-1"
          >
            {showFlag && <span className="text-sm">{language.flag}</span>}
            <span className="text-xs">
              {showNativeName ? language.nativeName : language.name}
            </span>
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`${currentLanguage.nativeName} — change language`}
        className={cn(
          "flex items-center",
          compact ? "space-x-1 px-2 py-2" : "space-x-2 px-3 py-2"
        )}
        title={compact ? currentLanguage.nativeName : undefined}
      >
        {showGlobe && <GlobeAltIcon className="w-4 h-4" />}
        {showFlag && <span className="text-sm">{currentLanguage.flag}</span>}
        {!compact && (
          <span className="text-sm whitespace-nowrap">
            {showNativeName ? currentLanguage.nativeName : currentLanguage.name}
          </span>
        )}
        <ChevronDownIcon className="w-4 h-4" />
      </Button>

      {isOpen && (
          <div
            role="listbox"
            aria-label="Select language"
            className={cn(
              "absolute right-0 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50",
              dropUp ? "bottom-full mb-2" : "top-full mt-2"
            )}
          >
            {languages.map((language) => (
              <button
                key={language.code}
                role="option"
                aria-selected={language.code === i18n.language}
                onClick={() => handleLanguageChange(language.code)}
                className={cn(
                  "w-full px-4 py-2 min-h-[44px] text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center space-x-3 transition-colors focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700",
                  language.code === i18n.language && "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                )}
              >
                <span className="text-lg">{language.flag}</span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{language.nativeName}</span>
                  <span className="text-xs text-gray-500">{language.name}</span>
                </div>
                {language.code === i18n.language && (
                  <div className="ml-auto w-2 h-2 bg-primary-500 rounded-full" />
                )}
              </button>
            ))}
          </div>
      )}
    </div>
  );
}