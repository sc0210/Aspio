/**
 * Badge colours and labels for a transaction row.
 *
 * Lifted out of `TransactionList` when the row became its own component, so
 * the two files share one copy rather than the row importing back out of the
 * list it lives inside.
 */

export const getPaymentMethodColor = (method: string) => {
  switch (method?.toLowerCase()) {
    case 'cash':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    case 'credit card':
    case 'credit_card':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'debit card':
    case 'debit_card':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
    case 'bank transfer':
    case 'bank_transfer':
      return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300';
    case 'digital wallet':
    case 'digital_wallet':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
    case 'mobile payment':
    case 'mobile_payment':
      return 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300';
    case 'check':
    case 'cheque':
      return 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300';
    default:
      return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300';
  }
};

export const getWalletTypeBadge = (walletType?: string) => {
  switch (walletType?.toLowerCase()) {
    case 'life':
      return { icon: '💳', label: 'Life', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' };
    case 'emergency':
      return { icon: '🚨', label: 'Emergency', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' };
    default:
      return { icon: '💳', label: 'Life', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' };
  }
};
