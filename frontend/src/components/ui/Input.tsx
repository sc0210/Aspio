import React, { useId } from 'react';
import { cn } from '@/utils/cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  helpText?: string;
  success?: boolean;
  loading?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ 
    className, 
    label, 
    error, 
    leftIcon, 
    rightIcon, 
    helpText, 
    success,
    loading,
    id, 
    ...props 
  }, ref) => {
    // useId, not Math.random: the id is rendered into htmlFor/aria-describedby, so a
    // value that differs between server and client is a hydration mismatch.
    const generatedId = useId();
    const inputId = id || generatedId;

    return (
      <div className="w-full">
        {/* The label used `className="label"`, which no stylesheet in this repo
            defines, so every label this component rendered was unstyled. Nothing
            caught it because no caller passes `label` — plausibly because the
            first person who tried got an unstyled label and hand-rolled one
            instead. This is the spelling those 60-odd hand-rolled labels use. */}
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            {label}
            {props.required && <span className="text-error-500 ml-1">*</span>}
          </label>
        )}
        
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              {leftIcon}
            </div>
          )}
          
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'input',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              // `input-error` is undefined too, so an invalid field looked
              // identical to a valid one. Mirrors the success line below it.
              error && 'border-error-500 focus-visible:ring-error-500',
              success && 'border-success-500 focus-visible:ring-success-500',
              loading && 'cursor-wait',
              'min-h-[48px]', // Better touch target for mobile
              className
            )}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${inputId}-error` : helpText ? `${inputId}-help` : undefined}
            {...props}
          />
          
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              {rightIcon}
            </div>
          )}
        </div>
        
        {error && (
          <p id={`${inputId}-error`} className="mt-1 text-sm text-error-600" role="alert">
            {error}
          </p>
        )}
        
        {helpText && !error && (
          <p id={`${inputId}-help`} className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {helpText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';