'use client';

import React, { memo } from 'react';

// Optimized icon component that only loads used icons
interface IconProps {
  className?: string;
  'aria-hidden'?: boolean;
}

// SVG icons defined inline to avoid large icon library imports
export const MenuIcon = memo(({ className, ...props }: IconProps) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
));
MenuIcon.displayName = 'MenuIcon';

export const SunIcon = memo(({ className, ...props }: IconProps) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
));
SunIcon.displayName = 'SunIcon';

export const MoonIcon = memo(({ className, ...props }: IconProps) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
  </svg>
));
MoonIcon.displayName = 'MoonIcon';

export const ComputerIcon = memo(({ className, ...props }: IconProps) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
));
ComputerIcon.displayName = 'ComputerIcon';

const ChartBarIcon = memo(({ className, ...props }: IconProps) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
));
ChartBarIcon.displayName = 'ChartBarIcon';

const CalendarIcon = memo(({ className, ...props }: IconProps) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
));
CalendarIcon.displayName = 'CalendarIcon';

const FireIcon = memo(({ className, ...props }: IconProps) => (
  <svg
    className={className}
    fill="currentColor"
    viewBox="0 0 24 24"
    {...props}
  >
    <path fillRule="evenodd" d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.177A7.547 7.547 0 016.648 6.61a.75.75 0 00-1.152-.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 011.925-3.545 3.75 3.75 0 013.255 3.717z" clipRule="evenodd" />
  </svg>
));
FireIcon.displayName = 'FireIcon';

// Dynamic icon loader for rarely used icons
const DynamicIcon = memo(({ name, className, ...props }: IconProps & { name: string }) => {
  const iconMap: Record<string, React.ComponentType<IconProps>> = {
    menu: MenuIcon,
    sun: SunIcon,
    moon: MoonIcon,
    computer: ComputerIcon,
    'chart-bar': ChartBarIcon,
    calendar: CalendarIcon,
    fire: FireIcon,
  };

  const IconComponent = iconMap[name];

  if (!IconComponent) {
    console.warn(`Icon "${name}" not found in optimized icon set`);
    return null;
  }

  return <IconComponent className={className} {...props} />;
});
DynamicIcon.displayName = 'DynamicIcon';