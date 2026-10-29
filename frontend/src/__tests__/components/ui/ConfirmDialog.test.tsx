import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('ConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    title: 'Delete Holding',
    message: 'This cannot be undone.',
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders the caller\'s title and message, named by the title', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('dialog', { name: 'Delete Holding' })).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<ConfirmDialog {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking confirm button calls onConfirm', () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('common.delete'));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses the caller\'s confirm label when given', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Replace" />);
    fireEvent.click(screen.getByText('Replace'));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('clicking cancel button calls onCancel', () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('common.cancel'));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('has aria-modal attribute', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
