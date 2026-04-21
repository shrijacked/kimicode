# Releasing Kimicode

Kimicode releases are versioned from the workspace root and published package-by-package in dependency order.

## Local release flow

1. Bump versions and roll the changelog:

   ```bash
   pnpm release:version patch
   ```

2. Run the full verification gate:

   ```bash
   pnpm release:check
   ```

3. Dry-run the npm publish path:

   ```bash
   pnpm publish:packages --dry-run
   ```

4. Commit the release metadata:

   ```bash
   git add package.json apps packages CHANGELOG.md
   git commit -m "chore: release vX.Y.Z"
   ```

5. Create the git tag:

   ```bash
   pnpm release:tag
   ```

6. Push the branch and tag:

   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

## GitHub release workflow

- `.github/workflows/release.yml` runs on `v*` tags and on manual dispatch
- it runs `pnpm release:check`
- if `NPM_TOKEN` is configured, it publishes the workspace packages
- for tag pushes, it also creates a GitHub release with generated notes
