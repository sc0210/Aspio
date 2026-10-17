#!/usr/bin/env node
/**
 * Refuses to start a host dev server while the Docker frontend is running.
 *
 * docker-compose.yml bind-mounts ./frontend/.next to /app/.next so that
 * `rm -rf frontend/.next` clears both. The cost of that convenience is that a
 * host `npm run dev` and the container write the same directory, and the loser
 * is whoever reads it next: the container ends up serving a client manifest the
 * host process wrote, and every page dies with
 *
 *   Could not find the module "/Users/<you>/.../app/portfolio/page.tsx#default"
 *   in the React Client Manifest
 *
 * followed by ChunkLoadError. It is a confusing failure to land on, because the
 * server keeps answering 200 — only the bundle handed to the browser is broken
 * — and the container's own log names host paths.
 *
 * Recovering means stopping the container (it owns files in .next, so a host
 * rm gets EACCES), clearing .next, and starting it again. Cheaper to refuse.
 *
 * Runs as `predev`, which npm invokes before `dev`. It never blocks CI or a
 * machine without Docker: anything other than a confirmed-running container
 * lets the dev server start.
 */

import { execFileSync } from 'node:child_process';

const CONTAINER = 'aspiro-frontend';

/** The container's status, or null when Docker cannot answer at all. */
function containerState() {
    try {
        return execFileSync(
            'docker',
            ['inspect', '-f', '{{.State.Running}}', CONTAINER],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
        ).trim();
    } catch {
        // No Docker binary, daemon down, or no such container — all fine.
        return null;
    }
}

if (containerState() === 'true') {
    process.stderr.write(
        `\n  The ${CONTAINER} container is already running.\n\n` +
            `  Both it and a host dev server write frontend/.next (bind-mounted in\n` +
            `  docker-compose.yml), and the collision corrupts the client manifest:\n` +
            `  pages then fail with "Could not find the module ... in the React Client\n` +
            `  Manifest" while the server still answers 200.\n\n` +
            `  Use the container that is already up:\n` +
            `      http://localhost:3000\n\n` +
            `  Or stop it first, if you really want a host dev server:\n` +
            `      docker stop ${CONTAINER}\n\n` +
            `  Already broken? Stop the container, delete frontend/.next, start it again.\n\n`
    );
    process.exit(1);
}
