import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PendingInviteBanner from '@/components/compare/PendingInviteBanner';
import { apiClient } from '@/lib/api-client';
import type { PeerConnectionOut } from '@/shared/types';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    respondToPeerInvite: jest.fn(),
  },
}));

const mockedRespond = apiClient.respondToPeerInvite as jest.Mock;

const makeInvite = (id: string, name: string, username: string | null = null): PeerConnectionOut => ({
  id,
  other_user: { id: `user-${id}`, name, username, avatar_url: null },
  status: 'pending',
  direction: 'received',
  created_at: '2026-05-01T00:00:00Z',
});

describe('PendingInviteBanner', () => {
  const onRespond = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when invites array is empty', () => {
    const { container } = render(<PendingInviteBanner invites={[]} onRespond={onRespond} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders each invite with the peer name', () => {
    const invites = [makeInvite('conn-1', 'Charlie'), makeInvite('conn-2', 'Diana')];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Diana')).toBeInTheDocument();
  });

  it('renders the @username when present', () => {
    const invites = [makeInvite('conn-1', 'Charlie', 'charlie99')];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    expect(screen.getByText('(@charlie99)')).toBeInTheDocument();
  });

  it('does not render @username section when username is null', () => {
    const invites = [makeInvite('conn-1', 'Charlie', null)];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    expect(screen.queryByText(/^@/)).toBeNull();
  });

  it('renders Accept and Decline buttons for each invite', () => {
    const invites = [makeInvite('conn-1', 'Charlie'), makeInvite('conn-2', 'Diana')];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    expect(screen.getAllByText('Accept')).toHaveLength(2);
    expect(screen.getAllByText('Decline')).toHaveLength(2);
  });

  it('calls respondToPeerInvite with "accept" action when Accept clicked', async () => {
    mockedRespond.mockResolvedValue({});
    const invites = [makeInvite('conn-7', 'Charlie')];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(mockedRespond).toHaveBeenCalledWith('conn-7', 'accept'));
  });

  it('calls respondToPeerInvite with "decline" action when Decline clicked', async () => {
    mockedRespond.mockResolvedValue({});
    const invites = [makeInvite('conn-8', 'Diana')];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('Decline'));
    await waitFor(() => expect(mockedRespond).toHaveBeenCalledWith('conn-8', 'decline'));
  });

  it('calls onRespond after accepting', async () => {
    mockedRespond.mockResolvedValue({});
    const invites = [makeInvite('conn-7', 'Charlie')];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1));
  });

  it('calls onRespond after declining', async () => {
    mockedRespond.mockResolvedValue({});
    const invites = [makeInvite('conn-8', 'Diana')];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('Decline'));
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1));
  });

  it('shows per-invite error when API call fails', async () => {
    mockedRespond.mockRejectedValue(new Error('Network error'));
    const invites = [makeInvite('conn-9', 'Eve')];
    render(<PendingInviteBanner invites={invites} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
    expect(onRespond).not.toHaveBeenCalled();
  });
});
