import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddLoanModal } from '@/components/loans/AddLoanModal';

const mockMutateAsync = jest.fn().mockResolvedValue({});

jest.mock('@/hooks/useLoans', () => ({
  useCreateLoan: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, _opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'addModal.title': 'Add Loan',
        'addModal.loanNameRequired': 'Loan Name *',
        'addModal.loanNamePlaceholder': 'e.g. Home Mortgage',
        'addModal.lender': 'Lender',
        'addModal.lenderPlaceholder': 'e.g. CTBC Bank',
        'addModal.typeRequired': 'Type *',
        'addModal.principalAmount': 'Principal Amount (TWD) *',
        'addModal.currentBalance': 'Current Balance (TWD)',
        'addModal.currentBalancePlaceholder': 'Defaults to principal',
        'addModal.interestRate': 'Annual Interest Rate (%) *',
        'addModal.minPayment': 'Monthly Min Payment (TWD) *',
        'addModal.dueDay': 'Due Day *',
        'addModal.termMonths': 'Term (months)',
        'addModal.startDate': 'Start Date *',
        'addModal.notes': 'Notes',
        'addModal.notesPlaceholder': 'Optional notes',
        'addModal.cancel': 'Cancel',
        'addModal.creating': 'Creating…',
        'addModal.add': 'Add Loan',
        'accountTypes.personal_loan': 'Personal Loan',
        'accountTypes.mortgage': 'Mortgage',
        'accountTypes.auto_loan': 'Auto Loan',
        'accountTypes.student_loan': 'Student Loan',
        'accountTypes.credit_card': 'Credit Card',
        'accountTypes.other': 'Other',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

beforeEach(() => jest.clearAllMocks());

describe('AddLoanModal', () => {
  it('renders the modal title', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    expect(screen.getByRole('heading', { name: 'Add Loan' })).toBeInTheDocument();
  });

  it('renders Loan Name field', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    expect(screen.getByLabelText('Loan Name *')).toBeInTheDocument();
  });

  it('renders Principal Amount field', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    expect(screen.getByLabelText('Principal Amount (TWD) *')).toBeInTheDocument();
  });

  it('renders Annual Interest Rate field', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    expect(screen.getByLabelText('Annual Interest Rate (%) *')).toBeInTheDocument();
  });

  it('renders Monthly Min Payment field', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    expect(screen.getByLabelText('Monthly Min Payment (TWD) *')).toBeInTheDocument();
  });

  it('renders account type options', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('Personal Loan')).toBeInTheDocument();
    expect(screen.getByText('Credit Card')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<AddLoanModal onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits form and calls onClose on success', async () => {
    const onClose = jest.fn();
    render(<AddLoanModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Loan Name *'), { target: { value: 'My Loan' } });
    fireEvent.change(screen.getByLabelText('Principal Amount (TWD) *'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByLabelText('Annual Interest Rate (%) *'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Monthly Min Payment (TWD) *'), { target: { value: '30000' } });
    fireEvent.change(screen.getByLabelText('Due Day *'), { target: { value: '15' } });

    fireEvent.submit(screen.getByRole('button', { name: 'Add Loan' }).closest('form')!);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('submit button shows add text when not pending', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    const btn = screen.getByRole('button', { name: 'Add Loan' });
    expect(btn).not.toBeDisabled();
  });

  it('has required attribute on Loan Name input', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    expect(screen.getByLabelText('Loan Name *')).toBeRequired();
  });

  it('has required attribute on Principal Amount input', () => {
    render(<AddLoanModal onClose={jest.fn()} />);
    expect(screen.getByLabelText('Principal Amount (TWD) *')).toBeRequired();
  });
});
