/**
 * The sign-in page's "Try Demo" enters the client-side demo, and clears any
 * session first.
 *
 * A session outranks the demo cookie (AuthContext), so a lingering one (a
 * pending Google sign-up still holds one) would have landed in that account
 * under a "welcome to the demo" toast.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const calls: string[] = [];
const mockSignOut = jest.fn(async () => { calls.push('signOut'); });
const mockEnableDemo = jest.fn(() => { calls.push('enableDemo'); });

jest.mock('next-auth/react', () => ({ signIn: jest.fn(), signOut: () => mockSignOut() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ enableDemo: mockEnableDemo }) }));
jest.mock('@/hooks/useGoogleSignIn', () => ({ useGoogleSignIn: () => false }));
jest.mock('@/components/auth/DevSignIn', () => ({ DevSignIn: () => null }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

import SignInPage from '@/app/auth/signin/page';

describe('sign-in Try Demo', () => {
  beforeEach(() => { calls.length = 0; mockSignOut.mockClear(); mockEnableDemo.mockClear(); });

  const clickDemo = async () => {
    render(<SignInPage />);
    fireEvent.click(await screen.findByRole('button', { name: /demo/i }));
    await waitFor(() => expect(mockEnableDemo).toHaveBeenCalled());
  };

  it('signs any session out before entering the demo', async () => {
    await clickDemo();
    expect(calls).toEqual(['signOut', 'enableDemo']);
  });

  it('still enters the demo when signing out fails', async () => {
    mockSignOut.mockImplementationOnce(async () => { throw new Error('offline'); });
    await clickDemo();
    expect(mockEnableDemo).toHaveBeenCalled();
  });
});
