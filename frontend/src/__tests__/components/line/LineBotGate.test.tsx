import { render, screen } from '@testing-library/react';

const mockFeatures = { lineBot: false, isLoading: false, isError: false };
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => mockFeatures }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

import { LineBotGate } from '@/components/line/LineBotGate';

const page = <LineBotGate><p>group page</p></LineBotGate>;

describe('LineBotGate', () => {
  beforeEach(() => {
    mockFeatures.lineBot = false;
    mockFeatures.isLoading = false;
    mockFeatures.isError = false;
  });

  it('renders the page when the answer failed, rather than claim the bot is off', () => {
    mockFeatures.isError = true;
    render(page);
    expect(screen.getByText('group page')).toBeInTheDocument();
  });

  it('renders the page when the bot is configured', () => {
    mockFeatures.lineBot = true;
    render(page);
    expect(screen.getByText('group page')).toBeInTheDocument();
  });

  it('explains the bot is off instead of rendering a page that would 404', () => {
    render(page);
    expect(screen.queryByText('group page')).not.toBeInTheDocument();
    expect(screen.getByText('lineLink.unavailableTitle')).toBeInTheDocument();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('shows neither while the answer is loading', () => {
    mockFeatures.isLoading = true;
    render(page);
    expect(screen.queryByText('group page')).not.toBeInTheDocument();
    expect(screen.queryByText('lineLink.unavailableTitle')).not.toBeInTheDocument();
  });

  it('renders standalone pages outside the app shell', () => {
    render(<LineBotGate standalone><p>link page</p></LineBotGate>);
    expect(screen.queryByTestId('layout')).not.toBeInTheDocument();
    expect(screen.getByText('lineLink.unavailableTitle')).toBeInTheDocument();
  });
});
