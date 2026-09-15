import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The script runs against a .env that does not exist, so tests never see the owner's real key
// and can never reach Runware.
function runCli(...args) {
  return spawnSync(process.execPath, [join('scripts', 'generate-images.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, RUNWARE_ENV_FILE: join(tmpdir(), 'site-factory-no-such-dir', '.env') },
  });
}

describe('npm run generate:images', () => {
  it('asks for a site folder when none is given', () => {
    const result = runCli();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Укажите папку сайта');
  });

  it('refuses a folder that is not in data/sites', () => {
    const result = runCli('../../etc');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('не найдена');
  });

  it('says so when every picture of the site is already in images.json', () => {
    const siteId = 'cli-images-fixture';
    const siteDir = join('data', 'sites', siteId);
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(
      join(siteDir, 'home.json'),
      JSON.stringify({ title: 'Home', blocks: [{ type: 'hero', content: [{ image: 'hero' }] }] }),
    );
    writeFileSync(join(siteDir, 'images.json'), JSON.stringify({ hero: { src: '/images/hero.webp', alt: 'Hero' } }));
    try {
      const result = runCli(siteId);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('все метки уже есть в images.json');
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('reports error when site folder has site.json but no page files', () => {
    const siteId = 'cli-images-unreadable-fixture';
    const siteDir = join('data', 'sites', siteId);
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(siteDir, 'site.json'), JSON.stringify({ brand: { name: 'X' } }));
    try {
      const result = runCli(siteId);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Картинки: не удалось прочитать сайт');
      expect(result.stdout).not.toContain('все метки уже есть');
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
    }
  });
});
