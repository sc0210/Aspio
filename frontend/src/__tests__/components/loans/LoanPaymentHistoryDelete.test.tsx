/**
 * Deleting a loan payment goes through the in-app confirm (it used
 * window.confirm until 2026-10-29), and the payment is only deleted once the
 * confirm is accepted. Real i18next in zh-TW, so a key missing from that
 * locale shows up as its English fallback and fails here.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { LoanPaymentHistory } from '@/components/loans/LoanPaymentHistory';
import loansZh from '@/locales/zh-TW/loans.json';
import commonZh from '@/locales/zh-TW/common.json';

const mockMutate = jest.fn();

jest.mock('@/hooks/useLoans', () => ({
  usePaymentHistory: (loanId: string | null) => ({
    payments: loanId
      ? [{
          transaction_id: 'txn-1',
          payment_date: '2026-10-01',
          amount: 10000,
          principal_portion: 9000,
          interest_portion: 1000,
        }]
      : [],
    isLoading: false,
  }),
  useDeletePayment: () => ({ mutate: mockMutate, isPending: false }),
  useUpdatePayment: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  lng: 'zh-TW',
  ns: ['loans', 'common'],
  defaultNS: 'loans',
  resources: { 'zh-TW': { loans: loansZh, common: commonZh } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const openConfirm = () => {
  render(
    <I18nextProvider i18n={i18n}>
      <LoanPaymentHistory loanId="loan-1" currency="TWD" />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Payment History/ }));
  fireEvent.click(screen.getByTitle('Delete payment'));
};

describe('LoanPaymentHistory delete', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    // useDialog defers its initial focus by a frame
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('asks in the reader\'s language and deletes only once confirmed', () => {
    openConfirm();
    expect(screen.getByRole('dialog', { name: loansZh.paymentHistory.deleteTitle })).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: commonZh.common.delete }));

    expect(mockMutate).toHaveBeenCalledWith({ loanId: 'loan-1', transactionId: 'txn-1' });
  });

  it('does not delete on cancel', () => {
    openConfirm();
    fireEvent.click(screen.getByRole('button', { name: commonZh.common.cancel }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
