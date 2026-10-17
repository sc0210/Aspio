import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '@/components/ui/Modal';

describe('Modal — mobile UX fixes', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    title: 'Test Modal',
    children: <p>Modal content</p>,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the close button when title is provided', () => {
    render(<Modal {...defaultProps} />);
    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it('close button has aria-label="Close modal"', () => {
    render(<Modal {...defaultProps} />);
    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    expect(closeBtn).toHaveAttribute('aria-label', 'Close modal');
  });

  it('close button has min-w-[44px] class for 44px touch target', () => {
    render(<Modal {...defaultProps} />);
    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    expect(closeBtn.className).toContain('min-w-[44px]');
  });

  it('close button has min-h-[44px] class for 44px touch target', () => {
    render(<Modal {...defaultProps} />);
    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    expect(closeBtn.className).toContain('min-h-[44px]');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(<Modal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close modal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when isOpen is false', () => {
    render(<Modal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('button', { name: /close modal/i })).not.toBeInTheDocument();
  });

  it('does not render close button when title is omitted', () => {
    render(
      <Modal isOpen={true} onClose={jest.fn()}>
        <p>No title</p>
      </Modal>
    );
    expect(screen.queryByRole('button', { name: /close modal/i })).not.toBeInTheDocument();
  });
});
