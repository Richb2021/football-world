import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production deploy scripts', () => {
  it('routes deploys through the verified lftp uploader', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.deploy).toBe('bash scripts/deploy-lftp.sh');
    expect(pkg.scripts?.['build:deploy']).toBe('npm run build && npm run deploy');
  });

  it('keeps the verified deploy script compatible with macOS Bash 3', () => {
    const deploy = readFileSync(new URL('../deploy-lftp.sh', import.meta.url), 'utf8');

    expect(deploy).not.toContain('mapfile');
    expect(deploy).toContain('while IFS= read -r f; do');
  });

  it('verifies live deploy files using URL-encoded paths and header checks for hidden htaccess', () => {
    const deploy = readFileSync(new URL('../deploy-lftp.sh', import.meta.url), 'utf8');

    expect(deploy).toContain('urlencode_path()');
    expect(deploy).toContain('urllib.parse.quote');
    expect(deploy).toContain('encoded_f=$(urlencode_path "$f")');
    expect(deploy).toContain("! -name '.htaccess'");
    expect(deploy).toContain('verify_app_shell_headers');
    expect(deploy).not.toContain('$LIVE_BASE/$f?cb=');
  });

  it('keeps the legacy FTP uploader disabled and free of hard-coded credentials', () => {
    const legacy = readFileSync(new URL('../upload-ftp.py', import.meta.url), 'utf8');

    expect(legacy).toContain('scripts/deploy-lftp.sh');
    expect(legacy).not.toContain('pD@0*u:I*If?');
    expect(legacy).not.toMatch(/PASS\s*=\s*["'][^"']+["']/);
  });

  it('marks the production app shell as non-cacheable so PWA clients fetch new bundles', () => {
    const htaccess = readFileSync(new URL('../../public/.htaccess', import.meta.url), 'utf8');

    expect(htaccess).toContain('<Files "index.html">');
    expect(htaccess).toContain('Header set Cache-Control "no-cache, no-store, must-revalidate"');
  });
});
