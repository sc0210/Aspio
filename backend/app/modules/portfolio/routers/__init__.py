"""Portfolio sub-routers package.

The original ``portfolio/router.py`` was a single ~6.2k-line module with 57
route handlers. It has been split, behavior-preserving, into concern-focused
sub-routers in this package. Each sub-router exposes a ``router`` (APIRouter)
whose route paths are byte-for-byte identical to the originals.

The top-level ``portfolio/router.py`` aggregates all of these onto a single
``router`` object (with no extra prefix), so the public import used by
``app/main.py`` continues to work unchanged.
"""
