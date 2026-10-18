'use client';

import { useState } from 'react';
import { QuestionMarkCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useDialog } from '@/hooks/useDialog';

/**
 * Financial Terms Help Component
 * 
 * Provides in-app explanation of financial terminology used in Aspiro.
 * Can be used as a modal or inline help section.
 * 
 * See docs/FINANCIAL_TERMINOLOGY.md for complete documentation.
 */

interface FinancialTermsHelpProps {
    variant?: 'modal' | 'inline';
    className?: string;
}

export function FinancialTermsHelp({ variant = 'modal', className = '' }: FinancialTermsHelpProps) {
    const [isOpen, setIsOpen] = useState(false);
    const { panelRef, dialogProps } = useDialog({ isOpen, onClose: () => setIsOpen(false) });

    const terms = [
        {
            icon: '💎',
            term: 'Total Asset',
            shortDesc: 'Your complete net worth across all 3 wallets',
            longDesc: 'The sum of all 3 wallets: Life Wallet + Portfolio Wallet + Emergency Fund. This is your true financial picture — every dollar you own, in everyday cash, invested assets, or emergency reserves.',
            example: 'NT$163k life cash + NT$145k portfolio value + NT$22k emergency fund = NT$330k Total Asset',
            usage: 'Net Worth card on the Dashboard — the headline number'
        },
        {
            icon: '💰',
            term: 'Life Wallet',
            shortDesc: 'Everyday cash — income, expenses, savings',
            longDesc: 'Your primary cash account balance reflecting daily life: salary income flows in, living expenses flow out. Tracks your month‑to‑month savings and spending health.',
            example: 'Monthly salary NT$90k − living expenses NT$55k = NT$163k accumulated life wallet balance',
            usage: 'Dashboard wallet card (sky blue) + Cash Flow card'
        },
        {
            icon: '📈',
            term: 'Portfolio Wallet',
            shortDesc: 'Current market value of your invested holdings',
            longDesc: 'The live market value of all your invested assets — stocks, ETFs, crypto, funds. This number moves daily with market prices and reflects how much your investments are worth right now.',
            example: 'AAPL worth NT$80k + TSLA worth NT$40k + ETF worth NT$25k = NT$145k Portfolio Wallet',
            usage: 'Dashboard wallet card (violet) + Investments card + Portfolio page'
        },
        {
            icon: '🛡️',
            term: 'Emergency Fund',
            shortDesc: 'Liquid reserve for unexpected needs',
            longDesc: 'Assets set aside specifically as a safety buffer — typically low‑risk and liquid so you can access them quickly. A healthy emergency fund covers 3–6 months of living expenses.',
            example: 'Short-term bond ETF NT$22k tagged as emergency = NT$22k Emergency Fund (covers ~5 months)',
            usage: 'Dashboard wallet card (amber) — shows runway months based on monthly expenses'
        },
    ];

    if (variant === 'inline') {
        return (
            <div className={`bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 ${className}`}>
                <div className="flex items-start gap-3">
                    <QuestionMarkCircleIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">Financial Terms Quick Reference</h4>
                        <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
                            {terms.map((term) => (
                                <div key={term.term} className="flex items-start gap-2">
                                    <span className="text-lg">{term.icon}</span>
                                    <div>
                                        <strong>{term.term}:</strong> {term.shortDesc}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Modal variant
    return (
        <>
            {/* Help Button */}
            <button
                onClick={() => setIsOpen(true)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors ${className}`}
                aria-label="View financial terms help"
            >
                <QuestionMarkCircleIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Terms Help</span>
            </button>

            {/* Modal */}
            {isOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div
                        ref={panelRef}
                        {...dialogProps}
                        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                                    <QuestionMarkCircleIcon className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Financial Terms Guide</h2>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">Understanding key metrics in Aspiro</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                                aria-label="Close help dialog"
                            >
                                <XMarkIcon className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                            <div className="space-y-6">
                                {/* Visual Diagram */}
                                <div className="bg-gradient-to-br from-primary-50 via-white to-blue-50 dark:from-gray-800 dark:via-gray-900 dark:to-gray-800 rounded-xl p-6 border border-primary-200 dark:border-gray-700">
                                    <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-4">💎 Total Asset = All 3 Wallets Combined</h3>
                                    <div className="grid grid-cols-3 gap-3 mb-4">
                                        <div className="text-center p-3 bg-sky-50 dark:bg-sky-900/30 rounded-lg border border-sky-200 dark:border-sky-800">
                                            <div className="text-2xl mb-1">💰</div>
                                            <div className="text-xs font-medium text-sky-600 dark:text-sky-400">Life Wallet</div>
                                            <div className="text-sm font-bold text-gray-900 dark:text-white">Daily Cash</div>
                                        </div>
                                        <div className="text-center p-3 bg-violet-100 dark:bg-violet-900/30 rounded-lg border-2 border-violet-500 dark:border-violet-600">
                                            <div className="text-2xl mb-1">📈</div>
                                            <div className="text-xs font-medium text-violet-700 dark:text-violet-300">Portfolio Wallet</div>
                                            <div className="text-sm font-bold text-violet-900 dark:text-violet-100">Investments</div>
                                        </div>
                                        <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/30 rounded-lg border border-amber-200 dark:border-amber-800">
                                            <div className="text-2xl mb-1">🛡️</div>
                                            <div className="text-xs font-medium text-amber-600 dark:text-amber-400">Emergency Fund</div>
                                            <div className="text-sm font-bold text-gray-900 dark:text-white">Safety Net</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                                        <span className="font-semibold text-violet-600 dark:text-violet-400">Portfolio Wallet 📈</span>
                                        <span>=</span>
                                        <span>Live market value of your holdings (fluctuates daily)</span>
                                    </div>
                                </div>

                                {/* Terms Explanation */}
                                <div className="space-y-4">
                                    {terms.map((term) => (
                                        <div
                                            key={term.term}
                                            className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700"
                                        >
                                            <div className="flex items-start gap-3">
                                                <span className="text-3xl flex-shrink-0">{term.icon}</span>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-bold text-lg text-gray-900 dark:text-white mb-1">{term.term}</h4>
                                                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{term.longDesc}</p>

                                                    <div className="bg-white dark:bg-gray-900 rounded-lg p-3 mb-2 border border-gray-200 dark:border-gray-700">
                                                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Example:</p>
                                                        <p className="text-sm text-gray-800 dark:text-gray-200">{term.example}</p>
                                                    </div>

                                                    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                                        <span className="font-semibold">Where you see it:</span>
                                                        <span>{term.usage}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Quick Tips */}
                                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                                    <h4 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">💡 Quick Tips</h4>
                                    <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
                                        <li>• <strong>Total Asset</strong> is your full net worth — all 3 wallets combined</li>
                                        <li>• <strong>Portfolio Wallet</strong> moves daily with market prices — don&apos;t be alarmed by short-term swings</li>
                                        <li>• <strong>Life Wallet</strong> health is tracked by Cash Flow — aim for a positive savings rate each month</li>
                                        <li>• <strong>Emergency Fund</strong> runway is shown in months — target 3–6 months of living expenses</li>
                                        <li>• The allocation donut on the dashboard shows how your wealth is split across all 3 wallets</li>
                                    </ul>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
