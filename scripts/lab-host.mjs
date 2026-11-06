/**
 * True when this build is the lab host and must not be indexed.
 * Cloudflare Pages git builds set CF_PAGES_BRANCH. GitHub Actions sets GITHUB_REF_NAME.
 */
export function isLabSeoBuild(env = process.env) {
  const site = String(env.PUBLIC_SITE_URL || '').toLowerCase();
  const ref = String(env.GITHUB_REF || '');
  const refName = String(env.GITHUB_REF_NAME || '');
  const branch = String(env.CF_PAGES_BRANCH || '');
  return env.PUBLIC_LAB_MODE === 'true'
    || site.includes('lab.nexttrain')
    || branch === 'lab'
    || ref === 'refs/heads/lab'
    || refName === 'lab';
}
