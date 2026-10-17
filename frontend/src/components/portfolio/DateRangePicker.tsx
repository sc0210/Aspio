'use client';

import { useState, useRef, useEffect } from 'react';
import { CalendarIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { businessToday } from '@/lib/portfolio/businessDate';

/**
 * Every date in this picker is UTC midnight of the day it means (what
 * `new Date('YYYY-MM-DD')` gives), and is read back with `toISOString()`.
 * A `new Date()` at the local current time breaks that: before 08:00 in
 * Taipei its UTC day is yesterday.
 */
const businessTodayDate = (): Date => new Date(businessToday());

export interface DateRange {
    startDate: Date | null;
    endDate: Date | null;
}

interface DateRangePickerProps {
    value: DateRange;
    onChange: (range: DateRange) => void;
    minDate?: Date;
    maxDate?: Date;
    className?: string;
}

export const DateRangePicker = ({
    value,
    onChange,
    minDate,
    maxDate = businessTodayDate(),
    className,
}: DateRangePickerProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [tempRange, setTempRange] = useState<DateRange>(value);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close picker when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const formatDate = (date: Date | null) => {
        if (!date) return '';
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    };

    const handleApply = () => {
        onChange(tempRange);
        setIsOpen(false);
    };

    const handleClear = () => {
        const clearedRange = { startDate: null, endDate: null };
        setTempRange(clearedRange);
        onChange(clearedRange);
        setIsOpen(false);
    };

    const formatDateForInput = (date: Date | null) => {
        if (!date) return '';
        return date.toISOString().split('T')[0];
    };

    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value ? new Date(e.target.value) : null;
        setTempRange(prev => ({ ...prev, startDate: newDate }));
    };

    const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value ? new Date(e.target.value) : null;
        setTempRange(prev => ({ ...prev, endDate: newDate }));
    };

    const displayText = value.startDate && value.endDate
        ? `${formatDate(value.startDate)} - ${formatDate(value.endDate)}`
        : 'Custom Range';

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    'flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 min-h-[36px]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800',
                    isOpen || (value.startDate && value.endDate)
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-md border border-primary-500 dark:border-primary-400'
                        : 'bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-gray-200 dark:border-gray-700'
                )}
                aria-label="Select custom date range"
            >
                <CalendarIcon className="w-4 h-4" />
                <span className="whitespace-nowrap">{displayText}</span>
            </button>

            {isOpen && (
                <div className="absolute top-full mt-2 left-0 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4 min-w-[320px] animate-slide-down">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Select Date Range</h3>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                aria-label="Close"
                            >
                                <XMarkIcon className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label htmlFor="daterangep-start-date" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                                    Start Date
                                </label>
                                <input
                                    id="daterangep-start-date"
                                    type="date"
                                    value={formatDateForInput(tempRange.startDate)}
                                    onChange={handleStartDateChange}
                                    min={minDate ? formatDateForInput(minDate) : undefined}
                                    max={formatDateForInput(tempRange.endDate || maxDate)}
                                    className={cn(
                                        'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600',
                                        'bg-white dark:bg-gray-700 text-gray-900 dark:text-white',
                                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent',
                                        'transition-colors'
                                    )}
                                />
                            </div>

                            <div>
                                <label htmlFor="daterangep-end-date" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                                    End Date
                                </label>
                                <input
                                    id="daterangep-end-date"
                                    type="date"
                                    value={formatDateForInput(tempRange.endDate)}
                                    onChange={handleEndDateChange}
                                    min={formatDateForInput(tempRange.startDate ?? minDate ?? null)}
                                    max={formatDateForInput(maxDate)}
                                    className={cn(
                                        'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600',
                                        'bg-white dark:bg-gray-700 text-gray-900 dark:text-white',
                                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent',
                                        'transition-colors'
                                    )}
                                />
                            </div>
                        </div>

                        <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                            <button
                                onClick={handleClear}
                                className={cn(
                                    'flex-1 px-3 py-2 text-xs font-semibold rounded-lg',
                                    'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700',
                                    'hover:bg-gray-200 dark:hover:bg-gray-600',
                                    'transition-colors'
                                )}
                            >
                                Clear
                            </button>
                            <button
                                onClick={handleApply}
                                disabled={!tempRange.startDate || !tempRange.endDate}
                                className={cn(
                                    'flex-1 px-3 py-2 text-xs font-semibold rounded-lg',
                                    'text-white bg-primary-600 hover:bg-primary-700',
                                    'disabled:opacity-50 disabled:cursor-not-allowed',
                                    'transition-colors'
                                )}
                            >
                                Apply
                            </button>
                        </div>

                        {/* Quick Select Options */}
                        <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Quick Select</p>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { label: 'Last 7 days', days: 7 },
                                    { label: 'Last 30 days', days: 30 },
                                    { label: 'Last 90 days', days: 90 },
                                    { label: 'Last 6 months', days: 180 },
                                ].map(({ label, days }) => (
                                    <button
                                        key={days}
                                        onClick={() => {
                                            const end = businessTodayDate();
                                            const start = new Date(end);
                                            start.setUTCDate(start.getUTCDate() - days);
                                            setTempRange({ startDate: start, endDate: end });
                                        }}
                                        className={cn(
                                            'px-2 py-1.5 text-xs font-medium rounded-lg',
                                            'text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50',
                                            'hover:bg-gray-100 dark:hover:bg-gray-700',
                                            'transition-colors'
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
