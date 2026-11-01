# Contributing

Bug reports, fixes and small features are welcome. For anything larger than a bug fix, open an
issue first so we can agree on the approach before you write it.

## Reporting

- **Bugs and ideas:** [open an issue](https://github.com/sc0210/Aspio/issues). For a bug, include
  steps to reproduce, what you expected, and what happened. Say whether it happens in demo mode.
- **Security problems:** don't open a public issue. Use
  [private vulnerability reporting](https://github.com/sc0210/Aspio/security/advisories/new).

## Set up

Fork the repo, clone your fork, then follow [Run it locally](README.md#run-it-locally). Docker
runs the whole stack. You need Node 22 and Python 3.14 for running checks outside it.

You don't need an account to see the UI. Demo mode runs on fixture data: set a `demo-mode=true`
cookie on `localhost:3000`. Use `localhost`, not `127.0.0.1`, or sessions won't stick.

## Make a change

1. Branch from `main`: `git switch -c fix/short-description`.
2. Read the doc for the area you're touching. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the
   map. Money logic follows [docs/FINANCIAL_TERMINOLOGY.md](docs/FINANCIAL_TERMINOLOGY.md), UI
   follows [docs/UI_CONVENTIONS.md](docs/UI_CONVENTIONS.md), and tests follow
   [docs/TESTING.md](docs/TESTING.md).
3. Add or update tests for what you changed.
4. Run the checks below.
5. Open a pull request against `main`.

### Checks

CI runs these on every pull request, forks included, and all of them must pass before a merge.
Each job runs only when its part of the tree changed. Run the ones for the side you changed
first:

```bash
# backend
cd backend
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -m "not integration"

# frontend
cd frontend
npm ci
npm run lint && npm run type-check && npm run type-check:tests
npm test
npm run build

# self-host scripts (scripts/, docker-compose*, caddy/)
bash scripts/aspiro_test.sh
```

CI also builds the Docker images and smoke-tests them against a real Postgres, and checks that
an empty database migrates cleanly to the models. You rarely need those locally; read the logs
if they fail on your PR.

`python -m pytest` (not bare `pytest`) puts `backend/` on the import path. The backend suite
runs on in-memory SQLite and needs no services.

### Database changes

A schema change ships as two files, together:

- an Alembic migration in `backend/alembic/versions/`;
- an idempotent SQL script in `backend/scripts/prod_sql/` with the same change, because
  self-hosted instances apply schema changes by hand.

A new table also needs row-level security enabled in that script. CI fails if there's more than
one Alembic head, or if migrating an empty database doesn't match the models.

## Pull requests

- Keep one change per PR, and say what it does and why. Link the issue if there is one.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for titles, e.g.
  `fix(transactions): keep transfer legs in sync on edit`.
- Include a screenshot for a visible UI change; demo mode is fine.
- Never commit secrets or real financial data. `.env` files stay local, and tests use fixtures.
- `main` is protected, so changes land only through a reviewed PR with green checks.

## License

Aspiro is licensed under the [Apache License 2.0](LICENSE). By opening a pull request you agree
that your contribution is licensed under the same terms (section 5 of the license).
