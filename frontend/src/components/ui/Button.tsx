import React from 'react';
import { cn } from '@/utils/cn';
import { LoadingSpinner } from './LoadingSpinner';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'success' | 'warning' | 'error' | 'ghost' | 'prosperity' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  asChild = false,
  children,
  disabled,
  ...props
}, ref) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none touch-manipulation';

  const variantClasses = {
    primary: 'bg-primary-700 text-white hover:bg-primary-800 focus-visible:ring-primary-500 dark:bg-primary-500 dark:hover:bg-primary-600 dark:focus-visible:ring-primary-400',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus-visible:ring-gray-500 dark:bg-gray-600 dark:text-gray-100 dark:hover:bg-gray-500 dark:focus-visible:ring-gray-400 border border-gray-300 dark:border-gray-500',
    outline: 'bg-transparent text-gray-700 border border-gray-300 hover:bg-gray-50 focus-visible:ring-gray-400 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-800 dark:focus-visible:ring-gray-500',
    success: 'bg-success-700 text-white hover:bg-success-800 focus-visible:ring-success-500 dark:bg-success-500 dark:hover:bg-success-600 dark:focus-visible:ring-success-400',
    warning: 'bg-warning-700 text-white hover:bg-warning-800 focus-visible:ring-warning-500 dark:bg-warning-500 dark:hover:bg-warning-600 dark:focus-visible:ring-warning-400',
    error: 'bg-error-600 text-white hover:bg-error-700 focus-visible:ring-error-500 dark:bg-error-500 dark:hover:bg-error-600 dark:focus-visible:ring-error-400',
    ghost: 'text-gray-700 hover:text-gray-900 hover:bg-gray-100 focus-visible:ring-gray-500 dark:text-gray-200 dark:hover:text-gray-100 dark:hover:bg-gray-700 dark:focus-visible:ring-gray-400',
    prosperity: 'bg-prosperity-700 text-white hover:bg-prosperity-800 focus-visible:ring-prosperity-500 dark:bg-prosperity-500 dark:hover:bg-prosperity-600 dark:focus-visible:ring-prosperity-400',
    gold: 'bg-gold-600 text-white hover:bg-gold-700 focus-visible:ring-gold-500 dark:bg-gold-500 dark:hover:bg-gold-600 dark:focus-visible:ring-gold-400',
  };
  
  const sizeClasses = {
    sm: 'px-3 py-2 text-sm gap-1.5 min-h-[44px] min-w-[44px]', // Enhanced touch targets for mobile
    md: 'px-4 py-2.5 text-sm gap-2 min-h-[48px] min-w-[48px]', // Optimal touch target for mobile
    lg: 'px-6 py-3 text-base gap-2.5 min-h-[56px] min-w-[56px]', // Larger for primary actions (Asian market preference)
  };

  const classes = cn(
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && 'w-full',
    className
  );

  if (asChild && React.isValidElement(children)) {
    const iconBefore = isLoading ? (
      <LoadingSpinner size="sm" />
    ) : leftIcon ? (
      <span className="flex-shrink-0">{leftIcon}</span>
    ) : null;

    const iconAfter = !isLoading && rightIcon ? (
      <span className="flex-shrink-0">{rightIcon}</span>
    ) : null;

    const childProps = children.props as Record<string, unknown>;
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      ...props,
      className: cn(classes, childProps.className as string | undefined),
      children: (
        <>
          {iconBefore}
          {childProps.children as React.ReactNode}
          {iconAfter}
        </>
      ),
    });
  }

  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <LoadingSpinner size="sm" />
      ) : leftIcon ? (
        <span className="flex-shrink-0">{leftIcon}</span>
      ) : null}

      {children}

      {!isLoading && rightIcon && (
        <span className="flex-shrink-0">{rightIcon}</span>
      )}
    </button>
  );
});

Button.displayName = 'Button';