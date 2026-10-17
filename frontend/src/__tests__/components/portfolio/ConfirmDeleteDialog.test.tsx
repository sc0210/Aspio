import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConfirmDeleteDialog } from '@/components/portfolio/ConfirmDeleteDialog';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('ConfirmDeleteDialog — Fix 8', () => {
  const defaultProps = {
    isOpen: true,
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders when isOpen is true', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<ConfirmDeleteDialog {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking confirm button calls onConfirm', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('portfolio:confirmDelete.confirm'));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('clicking cancel button calls onCancel', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('portfolio:confirmDelete.cancel'));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('has aria-modal attribute', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
