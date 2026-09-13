# Dependency remediation — 2026-09-13

The published baseline used Next 16.1.6 and Prisma 7.3.0. The initial npm audit reported 31 findings (1 critical, 19 high, 10 moderate, 1 low), including Next server/middleware advisories and vulnerable transitive tooling. Counts describe the dependency graph, not independently demonstrated application exploits.

Changes:

- Next and eslint-config-next are pinned together at 16.3.5; the Prisma client, PostgreSQL adapter and CLI are pinned together at stable 7.10.0.
- The Prisma CLI is a development dependency; runtime uses the generated client and PostgreSQL adapter. npm may still classify the CLI tree through the client's optional peer, so simply moving it does not remove advisories.
- Prisma 7.10 pins `mysql2` 3.15.3 and its config pins `deepmerge-ts` 7.1.5. Scoped overrides select patched mysql2 3.24.4 and deepmerge-ts 8.0.2. Prisma config uses the latter's exported `deepmerge` function; both ESM and CJS exports remain available. Config loading, generation, schema validation and migration are verified with these overrides. This app uses PostgreSQL, and MySQL behavior is not tested. Remove overrides when upstream versions incorporate the fixes.
- Vitest 4.1.11 replaces 3.2.7 to address its mocker path-traversal advisory. The complete unit and real PostgreSQL suite must pass on the updated runner.
- Compatible transitive patches were refreshed in `package-lock.json`. Docker now uses `npm ci` and that lockfile instead of an unpinned install/fallback command. The stale Bun lockfile was removed and database scripts use the installed npm toolchain. No `npm audit fix --force` was used.

Use `npm audit --json` and `npm audit --omit=dev --json` for a current check. A zero-advisory result only reflects the advisory database at that time; it is not a proof that the application has no vulnerabilities. This change does not establish deployment of any dependency update.
