/**
 * The old global React Query stub, now opt-in.
 *
 * jest.setup.js used to install this for every suite, which erased caching
 * behaviour everywhere and hid two real bugs (see the note in jest.setup.js).
 * A couple of suites legitimately want it: they drive `useQuery` by queryKey to
 * exercise presentation logic, and have no interest in the cache.
 *
 * Those suites now say so themselves:
 *
 *   jest.mock('@tanstack/react-query', () =>
 *     require('../utils/reactQueryStub').createReactQueryStub());
 *
 * Prefer a real client (queryWrapper.tsx) for anything that touches fetching,
 * invalidation or cache keys — a stub cannot fail those tests.
 */

export const createReactQueryStub = () => ({
    // An idle result rather than undefined: `const { data } = useQuery(...)`
    // otherwise throws before the component renders at all.
    useQuery: jest.fn(() => ({
        data: undefined,
        isLoading: false,
        isFetching: false,
        isError: false,
        isSuccess: false,
        error: null,
        refetch: jest.fn(),
    })),
    useMutation: jest.fn(() => ({
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue(undefined),
        isPending: false,
        isError: false,
        isSuccess: false,
        error: null,
        reset: jest.fn(),
    })),
    useQueryClient: jest.fn(() => ({
        invalidateQueries: jest.fn(),
        setQueryData: jest.fn(),
        getQueryData: jest.fn(),
    })),
    QueryClient: jest.fn(),
    QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
});
