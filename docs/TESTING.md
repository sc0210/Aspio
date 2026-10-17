# Testing

Three suites, three jobs: pytest for the backend, Jest for frontend units, Playwright for
browser flows.

| Suite | Where | Size | Gated in CI |
|---|---|---|---|
| pytest | `backend/tests/` | 1412 collected | yes — everything except `integration` |
| Jest | `frontend/src/**/*.test.tsx` | 120 suites / 1544 tests | yes — assertions, dead suites *and* types |
| Playwright | `frontend/tests/` | 12 specs | no — run locally |

## Backend — pytest

```bash
cd backend && source .venv/bin/activate

python -m pytest                                        # everything
python -m pytest tests/test_foo.py::TestClass::test_x   # one test
python -m pytest -m unit                                # by marker
python -m pytest -m "not slow"
```

Use `python -m pytest`, not the bare `pytest` console script — the module form puts `backend/`
on `sys.path`, which `tests/conftest.py` needs to import `app`. The bare script fails at import.

Markers declared in `pytest.ini`: `slow · integration · unit · database · api · auth · demo ·
isolation`. `--strict-markers` is on, so an undeclared marker is an error, not a typo you find
later.

Tests run against in-memory SQLite (`tests/conftest.py`). Only `integration` tests need a real
Postgres or live market-data APIs.

`pytest.ini` sets `--cov-fail-under=35`. Coverage currently sits below that, so a plain
`pytest` run reports failure on the coverage gate even when every test passes — read the test
count, not just the exit code. CI sidesteps this with `-o "addopts="`.

### Mocks that hide bugs

Two patterns have each shipped a real production break past a green suite:

- **Bare `AsyncMock()`** accepts any call, including one to a repository method that does not
  exist. Pass `spec=` so the mock has the real object's surface.
- **Partial module mocks** clobber the global mock for the rest of the file, so later tests
  assert against a stub that no longer resembles the module.

## Frontend — Jest

```bash
cd frontend
npm test                  # all suites
npm run test:watch
npm run test:coverage
npx jest path/to/file      # one file
```

**The baseline is zero failures.** A red suite is your change, not pre-existing debt.

**The suite runs at Asia/Taipei**, pinned in `jest.global-setup.js` — the app's business day,
which decides which month a transaction belongs to. Without the pin a day assertion read the
runner rather than the code: a purchase stamped `2026-08-31T20:00Z` is Sep 1 here and Aug 31 on
CI, so the same assertion was correct on one machine and wrong on another. The pin overrides
`TZ`, so `TZ=... npx jest` cannot change what the suite means. To reproduce a viewer at another
offset on purpose, use `JEST_TZ=America/Los_Angeles npx jest`; it warns in the log, and rejects
an unknown zone rather than silently falling back to UTC.

Note this is the opposite convention to the backend, where `TZ` is a real knob —
`TZ=Pacific/Honolulu pytest` is how prod's UTC clock is reproduced against a Taipei business
day. There, the container's zone is part of what is under test.

CI runs two gates because they catch different failures. Jest's exit code catches failing
assertions. `scripts/check-dead-test-suites.mjs` catches what an exit code cannot see: a suite
that throws while *loading* runs zero assertions and still reports green — it looks like
coverage and provides none. Three such suites each sat on top of a real bug, one of them
account registration being broken end to end.

Keep both gates. If you add a suite, make sure it actually runs at least one test.

### Why there are two type-check commands

`tsconfig.json` excludes every `*.test.*` and `__tests__` path, so `next build` does not
typecheck test code. The side effect was that test files were never typechecked **at all** —
the compiler never saw them, and babel strips their types without checking, so a test could
assign a string to a number and stay green.

`npm run type-check:tests` (`tsconfig.test.json`) puts those paths back, and CI gates on it.
Turning it on the first time surfaced 127 errors, none of them stylistic; the recurring shape
was a test asserting against a contract the code no longer had — a prop the component had
stopped declaring, a fixture missing a field the type now required, an ISO string where the
prop was a `Date` and the component called `.getTime()` on it.

Playwright specs stay excluded: different environment, different globals, separate job.

## Frontend — Playwright

```bash
cd frontend
npm run test:playwright           # all
npm run test:playwright:headed    # watch it happen
npm run test:playwright:ui        # interactive
npm run test:playwright:debug

npm run test:crud                 # tests/crud/
npm run test:api                  # tests/api/
npm run test:e2e                  # tests/e2e/
npm run test:accessibility
npm run test:responsive
npm run test:mobile               # Mobile Chrome + Mobile Safari
```

Projects configured: `setup` (auth), chromium, firefox, webkit, Mobile Chrome, Mobile Safari,
Microsoft Edge, Google Chrome. `tests/auth.setup.ts` establishes the session the other projects
reuse.

Playwright needs the app running and is not part of the merge gate — run it before shipping
anything that changes a user flow.

Local dev only works on `localhost:3000`. On `127.0.0.1:3000` the session cookies are not sent
and the app hangs on a spinner, which looks like a test failure but is an origin mismatch.

## CI

`.github/workflows/ci.yml` runs on PRs and on main, in parallel jobs:

- **Frontend** — `npm ci` → lint → type-check → **type-check:tests** → Jest (+ dead-suite check) → `npm run build`
- **Backend** — `python -m pytest -m "not integration" -o "addopts=" -p no:cacheprovider -q`
- **Images · smoke test** — builds the production images and runs `scripts/ci/smoke_images.sh`:
  real Postgres, production settings, Alembic inside the image, then register → approve →
  log in → create/list a transaction → dashboard, and the frontend's sign-in, NextAuth and
  three demo-mode pages. The only check that runs the built artefacts; run it locally with the
  commands in the script's header.
  Its schema is built from the models (`create_all`), not from production's history, so it
  cannot catch a column that production lacks — the deploy's schema gate covers the
  migration side.

The backend selector matters. It used to be `-m unit`, which collected 3 of 976 tests — a green
check validating ~0.3% of the backend. `not integration`
is the whole suite minus tests needing real external services.

## Before calling something done

A green typecheck and a green suite are necessary, not sufficient — several runtime crashes in
this codebase compiled and tested clean. Drive the actual flow in the running app. For UI work,
preview the page with the `demo-mode=true` cookie set.
