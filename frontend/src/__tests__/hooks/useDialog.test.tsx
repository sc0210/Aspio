import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useDialog } from '@/hooks/useDialog';
import { Modal } from '@/components/ui/Modal';

function Dialog({ isOpen, onClose, closeOnEscape }: {
  isOpen: boolean; onClose: () => void; closeOnEscape?: boolean;
}) {
  const { panelRef, dialogProps } = useDialog({ isOpen, onClose, closeOnEscape });
  if (!isOpen) return null;
  return (
    <div ref={panelRef} {...dialogProps} aria-label="Test dialog">
      <button>first</button>
      <button>last</button>
    </div>
  );
}

/** Mirrors a search dialog: close button first in the DOM, field after it. */
function DialogWithPreferredFocus({ isOpen }: { isOpen: boolean }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { panelRef, dialogProps } = useDialog({
    isOpen,
    onClose: jest.fn(),
    initialFocus: inputRef,
  });
  if (!isOpen) return null;
  return (
    <div ref={panelRef} {...dialogProps} aria-label="Search dialog">
      <button>Close</button>
      <input ref={inputRef} aria-label="Search" />
    </div>
  );
}

describe('useDialog', () => {
  beforeEach(() => {
    // the hook defers the initial focus by a frame
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('marks the panel as a modal dialog', () => {
    render(<Dialog isOpen onClose={jest.fn()} />);
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(dlg).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus into the panel on open', () => {
    render(<Dialog isOpen onClose={jest.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    render(<Dialog isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape when closeOnEscape is false', () => {
    const onClose = jest.fn();
    render(<Dialog isOpen onClose={onClose} closeOnEscape={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Dialog isOpen onClose={jest.fn()} />);
    const [first, last] = screen.getAllByRole('button');
    act(() => last.focus());
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control back to the last', () => {
    render(<Dialog isOpen onClose={jest.fn()} />);
    const [first, last] = screen.getAllByRole('button');
    act(() => first.focus());
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('focuses the control the caller names, not the first one', () => {
    // Without initialFocus the close button wins on DOM order, so a dialog built
    // around one field announces "Close" before the field it exists for. Callers
    // used to work around it with their own delayed focus(), which then raced
    // this hook and left focus unstable for the first frames.
    render(<DialogWithPreferredFocus isOpen />);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }));
  });

  it('still falls back to the first control when none is named', () => {
    render(<Dialog isOpen onClose={jest.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('returns focus to whatever opened it', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<Dialog isOpen onClose={jest.fn()} />);
    expect(document.activeElement).not.toBe(trigger);

    rerender(<Dialog isOpen={false} onClose={jest.fn()} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('gives Escape to the innermost dialog only, so cancelling a confirm keeps its parent open', () => {
    const outerClose = jest.fn();
    const innerClose = jest.fn();
    const { rerender } = render(
      <>
        <Dialog isOpen onClose={outerClose} />
        <Dialog isOpen onClose={innerClose} />
      </>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();

    // once the inner one closes, the outer one owns Escape again
    rerender(
      <>
        <Dialog isOpen onClose={outerClose} />
        <Dialog isOpen={false} onClose={innerClose} />
      </>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the inner dialog on top when the outer one re-binds its keys', () => {
    const outerClose = jest.fn();
    const innerClose = jest.fn();
    const { rerender } = render(
      <>
        <Dialog isOpen onClose={outerClose} closeOnEscape />
        <Dialog isOpen onClose={innerClose} />
      </>
    );
    // a changed closeOnEscape re-runs the outer dialog's keydown effect
    rerender(
      <>
        <Dialog isOpen onClose={outerClose} closeOnEscape={false} />
        <Dialog isOpen onClose={innerClose} />
      </>
    );
    rerender(
      <>
        <Dialog isOpen onClose={outerClose} closeOnEscape />
        <Dialog isOpen onClose={innerClose} />
      </>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('leaves Escape to a Headless UI Modal opened over a hand-rolled overlay', () => {
    const overlayClose = jest.fn();
    const modalClose = jest.fn();
    render(
      <>
        <Dialog isOpen onClose={overlayClose} />
        <Modal isOpen onClose={modalClose} title="Inner modal"><button>inside</button></Modal>
      </>
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(modalClose).toHaveBeenCalledTimes(1);
    expect(overlayClose).not.toHaveBeenCalled();
  });

  it('keeps a Headless UI Modal open when a hand-rolled confirm over it takes Escape', () => {
    const modalClose = jest.fn();
    const confirmClose = jest.fn();
    render(
      <>
        <Modal isOpen onClose={modalClose} title="Outer modal"><button>inside</button></Modal>
        <Dialog isOpen onClose={confirmClose} />
      </>
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(confirmClose).toHaveBeenCalledTimes(1);
    expect(modalClose).not.toHaveBeenCalled();
  });
});
