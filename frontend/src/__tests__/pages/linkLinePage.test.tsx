/**
 * /link-line used to confirm the link as soon as it loaded. The token is minted
 * by whoever ran /link in LINE and anyone can send its URL to someone else, so
 * opening a stranger's link bound the stranger's LINE account to the opener's
 * Aspiro account. The page now shows which LINE account it would attach and
 * links only on an explicit click.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('@/components/line/LineBotGate', () => ({
  LineBotGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const mockMode = { isAuthenticated: true, isLoading: false, user: { email: 'victim@example.com' } as { email: string } | null };
jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => mockMode }));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=11111111-1111-1111-1111-111111111111'),
}));
jest.mock('next-auth/react', () => ({ signIn: jest.fn() }));
const mockGoogle = jest.fn(() => true);
jest.mock('@/hooks/useGoogleSignIn', () => ({ useGoogleSignIn: () => mockGoogle() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import LinkLinePage from '@/app/link-line/page';

describe('/link-line', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue({ success: true, data: { line_display_name: 'Stranger', picture_url: null } });
    mockPost.mockReset().mockResolvedValue({ success: true, data: { display_name: 'victim' } });
  });

  it('shows the LINE account and links nothing until asked', async () => {
    render(<LinkLinePage />);

    expect(await screen.findByText('Stranger')).toBeInTheDocument();
    expect(screen.getByText('victim@example.com')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/line-bot/link-preview?token='));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('links on an explicit click', async () => {
    render(<LinkLinePage />);
    fireEvent.click(await screen.findByText('common:lineLink.confirmButton'));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/line-bot/link-confirm', {
      token: '11111111-1111-1111-1111-111111111111',
    }));
    expect(await screen.findByText('common:lineLink.linkedTitle')).toBeInTheDocument();
  });

  it('links nothing when cancelled', async () => {
    render(<LinkLinePage />);
    fireEvent.click(await screen.findByText('common:lineLink.cancel'));

    expect(screen.getByText('common:lineLink.cancelled')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  describe('signed out', () => {
    beforeEach(() => { mockMode.isAuthenticated = false; mockMode.user = null; });
    afterEach(() => { mockMode.isAuthenticated = true; mockMode.user = { email: 'victim@example.com' }; mockGoogle.mockReturnValue(true); });

    it('offers Google where it is configured, and email either way', async () => {
      render(<LinkLinePage />);
      expect(await screen.findByText('common:lineLink.continueGoogle')).toBeInTheDocument();
      expect(screen.getByText('common:lineLink.signInEmail')).toBeInTheDocument();
    });

    it('offers only email where Google is not configured', async () => {
      mockGoogle.mockReturnValue(false);
      render(<LinkLinePage />);
      expect(await screen.findByText('common:lineLink.signInEmail')).toBeInTheDocument();
      expect(screen.queryByText('common:lineLink.continueGoogle')).not.toBeInTheDocument();
    });
  });
});
