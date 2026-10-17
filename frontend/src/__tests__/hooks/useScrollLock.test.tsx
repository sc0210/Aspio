import React from 'react';
import { render } from '@testing-library/react';
import { useScrollLock } from '@/hooks/useScrollLock';

function Locker({ locked }: { locked: boolean }) {
  useScrollLock(locked);
  return null;
}

/**
 * The app shell is h-[100dvh] and <main id="main-content"> carries the
 * overflow, so a lock that only touches body does nothing. These cover the
 * regression that made the mobile drawer's lock a no-op.
 */
describe('useScrollLock', () => {
  let main: HTMLElement;

  beforeEach(() => {
    main = document.createElement('main');
    main.id = 'main-content';
    main.style.overflow = 'auto';
    document.body.appendChild(main);
  });

  afterEach(() => {
    main.remove();
    document.body.style.overflow = '';
  });

  it('locks the real scroll container, not just body', () => {
    render(<Locker locked />);
    expect(main.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('does nothing while unlocked', () => {
    render(<Locker locked={false} />);
    expect(main.style.overflow).toBe('auto');
  });

  it('restores the previous overflow on unmount', () => {
    const { unmount } = render(<Locker locked />);
    expect(main.style.overflow).toBe('hidden');
    unmount();
    expect(main.style.overflow).toBe('auto');
  });

  it('reference-counts so an inner dialog closing keeps the outer lock', () => {
    const outer = render(<Locker locked />);
    const inner = render(<Locker locked />);
    expect(main.style.overflow).toBe('hidden');

    inner.unmount();
    expect(main.style.overflow).toBe('hidden'); // outer is still open

    outer.unmount();
    expect(main.style.overflow).toBe('auto');
  });

  it('survives a missing scroll container', () => {
    main.remove();
    expect(() => render(<Locker locked />)).not.toThrow();
  });
});
