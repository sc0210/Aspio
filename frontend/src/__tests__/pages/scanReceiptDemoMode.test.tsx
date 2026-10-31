/**
 * /transactions/scan in demo mode.
 *
 * The page had no link to it until /transactions got a Scan button, so no demo
 * visitor could reach it. Now one click does, and a demo session has no token:
 * uploading the receipt could only come back 401. It must say so instead.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanReceiptPage from '@/app/transactions/scan/page';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { transactionService } from '@/services/transactionService';
import { ApiError } from '@/lib/api-client';
import toast from 'react-hot-toast';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/transactions/scan',
}));

jest.mock('@/hooks/useAppMode', () => ({
  useModeAwareUI: jest.fn(),
}));

jest.mock('@/services/transactionService', () => ({
  transactionService: { scanReceipt: jest.fn(), createTransaction: jest.fn() },
}));

jest.mock('@/lib/api-client', () => ({
  // The real class: the page tells a backend-written reason apart by instanceof.
  ApiError: jest.requireActual('@/lib/api-client').ApiError,
  apiClient: { post: jest.fn() },
}));

// A real-enough useMutation: mutate runs mutationFn, so the save path is exercised.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: (opts: { mutationFn: (d: unknown) => Promise<unknown>; onSuccess?: () => unknown }) => ({
    mutate: (d: unknown) => opts.mutationFn(d).then(() => opts.onSuccess?.()).catch(() => {}),
    isPending: false,
  }),
}));

jest.mock('@/hooks/useDataSynchronization', () => ({
  QUERY_KEYS: { TRANSACTIONS: 'transactions' },
  invalidateDashboardData: jest.fn(),
}));

jest.mock('react-hot-toast', () => {
  const fn = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
  return { __esModule: true, default: fn };
});

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k }),
}));

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const mockUseModeAwareUI = useModeAwareUI as jest.Mock;
const mockToast = toast as unknown as jest.Mock;
const mockScan = transactionService.scanReceipt as jest.Mock;
const mockCreate = transactionService.createTransaction as jest.Mock;

async function chooseReceiptAndProcess(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['x'], 'receipt.png', { type: 'image/png' }));
  await user.click(await screen.findByRole('button', { name: 'transactions:scan.process' }));
}

describe('ScanReceiptPage — demo mode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not upload the receipt, and says why', async () => {
    mockUseModeAwareUI.mockReturnValue({ isDemo: true });
    const user = userEvent.setup();
    render(<ScanReceiptPage />);

    await chooseReceiptAndProcess(user);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('transactions:scan.demoLocked', expect.anything()),
    );
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('uploads it when signed in', async () => {
    mockUseModeAwareUI.mockReturnValue({ isDemo: false });
    mockScan.mockResolvedValue({ data: { amount: 120, merchant_name: 'Shop' } });
    const user = userEvent.setup();
    render(<ScanReceiptPage />);

    await chooseReceiptAndProcess(user);

    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(1));
  });

  it('saves a scanned receipt through the transaction service, in the shape it maps', async () => {
    // The page used to post its own object straight to /transactions/ — a Date
    // under `date`, camelCase paymentMethod — which the backend rejected.
    mockUseModeAwareUI.mockReturnValue({ isDemo: false });
    mockScan.mockResolvedValue({ data: { amount: 120, merchant_name: 'Shop', date: '2026-09-13' } });
    mockCreate.mockResolvedValue({ success: true, data: { id: 'tx-1' } });
    const user = userEvent.setup();
    render(<ScanReceiptPage />);

    await chooseReceiptAndProcess(user);
    await user.click(await screen.findByRole('button', { name: 'transactions:scan.addTransaction' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const sent = mockCreate.mock.calls[0][0];
    expect(sent).toMatchObject({ type: 'expense', amount: 120, currency: 'TWD', walletType: 'life' });
    expect(sent.date).toBeInstanceOf(Date);
    expect(sent.paymentMethod).toBeUndefined();
  });

  it('sends a payment method typed into the form in the spelling the backend accepts', async () => {
    // OCR never extracts one, but the form's Payment Method field is editable;
    // this is the path the mapping exists for.
    mockUseModeAwareUI.mockReturnValue({ isDemo: false });
    mockScan.mockResolvedValue({ data: { amount: 120, merchant_name: 'Shop', date: '2026-09-13' } });
    mockCreate.mockResolvedValue({ success: true, data: { id: 'tx-1' } });
    const user = userEvent.setup();
    render(<ScanReceiptPage />);

    await chooseReceiptAndProcess(user);
    await user.type(await screen.findByLabelText('transactions:fields.paymentMethod'), 'GCash');
    await user.click(screen.getByRole('button', { name: 'transactions:scan.addTransaction' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0].paymentMethod).toBe('gcash');
  });
});

describe('ScanReceiptPage — a failed scan says why', () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the server's reason when the upload is rejected", async () => {
    // Every failure used to read "automatic reading isn't available yet", so a
    // wrong file type looked exactly like OCR not existing.
    mockUseModeAwareUI.mockReturnValue({ isDemo: false });
    mockScan.mockRejectedValue(new ApiError('Unsupported file type. Use JPG, PNG, or PDF', 400));
    const user = userEvent.setup();
    render(<ScanReceiptPage />);

    await chooseReceiptAndProcess(user);

    expect(await screen.findByText('Unsupported file type. Use JPG, PNG, or PDF')).toBeInTheDocument();
    expect(screen.queryByText('transactions:scan.failedBody')).not.toBeInTheDocument();
  });

  it('shows generic copy, not the raw string, when the request never reached the backend', async () => {
    mockUseModeAwareUI.mockReturnValue({ isDemo: false });
    mockScan.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<ScanReceiptPage />);

    await chooseReceiptAndProcess(user);

    expect(await screen.findByText('transactions:scan.error')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    // Not the no-total advice either: OCR never ran.
    expect(screen.queryByText('transactions:scan.failedBody')).not.toBeInTheDocument();
  });

  it('gives photo advice when OCR ran but found no total', async () => {
    mockUseModeAwareUI.mockReturnValue({ isDemo: false });
    mockScan.mockResolvedValue({ data: { amount: null, merchant_name: null, confidence: 0 } });
    const user = userEvent.setup();
    render(<ScanReceiptPage />);

    await chooseReceiptAndProcess(user);

    expect(await screen.findByText('transactions:scan.failedBody')).toBeInTheDocument();
  });
});
