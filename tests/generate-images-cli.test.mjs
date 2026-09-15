import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// These runs only ever reach cases that need no Runware request — a bad folder name, or a site
// whose pictures are all in place — because the script reads the project's real .env.
function runCli(...args) {
  return spawnSync(process.execPath, [join('scripts', 'generate-images.mjs'), ...args], {
    encoding: 'utf8',
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
});
