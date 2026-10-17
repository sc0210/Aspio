'use client';

import { useTranslation } from 'react-i18next';
import { SunIcon, MoonIcon, ComputerIcon } from './OptimizedIcons';
import { Button } from './Button';
import { cn } from '@/utils/cn';
import { useTheme, type Theme } from '@/contexts/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  variant?: 'button' | 'dropdown';
  showLabel?: boolean;
  iconOnly?: boolean;
}

export function ThemeToggle({ 
  className, 
  variant = 'button', 
  showLabel = false,
  iconOnly = false
}: ThemeToggleProps) {
  const { t } = useTranslation('common');
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(nextTheme);
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return <SunIcon className="w-4 h-4" />;
      case 'dark':
        return <MoonIcon className="w-4 h-4" />;
      case 'system':
        return <ComputerIcon className="w-4 h-4" />;
    }
  };

  const getThemeLabel = () => {
    switch (theme) {
      case 'light':
        return t('theme.light');
      case 'dark':
        return t('theme.dark');
      case 'system':
        return t('theme.system');
    }
  };

  const changeTheme = (newTheme: Theme) => {
    setTheme(newTheme);
  };

  if (variant === 'dropdown') {
    return (
      <div className={cn('relative', className)}>
        <div className="flex flex-col space-y-1">
          {(['light', 'dark', 'system'] as Theme[]).map((themeOption) => (
            <button
              key={themeOption}
              onClick={() => changeTheme(themeOption)}
              className={cn(
                'flex items-center space-x-2 px-3 py-2 rounded-lg text-sm transition-colors',
                theme === themeOption
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900 dark:text-primary-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
              )}
            >
              {themeOption === 'light' && <SunIcon className="w-4 h-4" />}
              {themeOption === 'dark' && <MoonIcon className="w-4 h-4" />}
              {themeOption === 'system' && <ComputerIcon className="w-4 h-4" />}
              <span>
                {themeOption === 'light' && t('theme.light')}
                {themeOption === 'dark' && t('theme.dark')}
                {themeOption === 'system' && t('theme.system')}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleTheme}
      className={cn(
        'relative flex items-center text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 touch-manipulation',
        !iconOnly && 'space-x-2',
        className
      )}
      title={`${t('theme.toggle')}: ${getThemeLabel()}`}
      aria-label={`${t('theme.toggle')}: ${getThemeLabel()}`}
    >
      {getThemeIcon()}
      {showLabel && !iconOnly && <span className="text-sm">{getThemeLabel()}</span>}
    </Button>
  );
}