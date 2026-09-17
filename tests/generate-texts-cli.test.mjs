import { describe, it, expect } from 'vitest';
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The script runs against a .env that does not exist, so tests never see the owner's real key
// and can never reach OpenAI — the same escape hatch generate-images-cli.test.mjs uses.
function runCli(...args) {
  return spawnSync(process.execPath, [join('scripts', 'generate-texts.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, OPENAI_ENV_FILE: join(tmpdir(), 'site-factory-no-such-dir', '.env') },
  });
}

describe('npm run generate:texts', () => {
  it('asks for --out and --brand when they are missing', () => {
    const result = runCli();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Использование');
  });

  // Finding 2: the old parser only understood `--flag value` (by position); given `--flag=value`
  // it stored the whole thing under one garbled key like `out=texts-cli-fixture` instead of
  // splitting on '='. So --out and --brand — read here through the CLI's own "are they present"
  // check, which runs before generateSite ever does and so needs no key and touches no network —
  // used to stay empty no matter what was typed after the '='. Mixing both forms in one command
  // proves each is read on its own terms, not merely that one form happens to still work.
  it('accepts --flag=value for every flag, mixed with the plain --flag value form', () => {
    const out = 'texts-cli-fixture';
    rmSync(join('data', 'sites', out), { recursive: true, force: true });
    try {
      const result = runCli(
        '--template=review',
        '--out',
        out,
        '--brand=Acme',
        '--geo=Bangladesh',
        '--locale=ru-RU',
        '--pages=home,casino',
      );
      // No key behind OPENAI_ENV_FILE, so a run that got this far (out/brand read as non-empty)
      // reaches generateSite's own "no key" line and exits cleanly — it never touches the network.
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ключ');
    } finally {
      rmSync(join('data', 'sites', out), { recursive: true, force: true });
    }
  });

  // The old parser also always "succeeded" — a flag with nothing after it, or immediately
  // followed by another flag, still got the next token (or '') as its value, no matter how
  // nonsensical. Refusing instead of guessing is the other half of finding 2.
  it('refuses a known flag with nothing after it, instead of guessing a default', () => {
    const result = runCli('--out', 'texts-cli-dangling', '--brand', 'Acme', '--pages');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--pages');
  });

  it('refuses a known flag immediately followed by another flag, not the flag as its value', () => {
    const result = runCli('--pages', '--brand', 'Acme', '--out', 'texts-cli-dangling2');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--pages');
  });

  // Finding 3: --out used to be joined straight onto data/sites with no containment check at
  // all, unlike its sibling generate-images.mjs's own --site. Same two shapes that script refuses.
  it('refuses a folder name with a path separator', () => {
    const result = runCli('--out', '../../etc', '--brand', 'Acme');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('недопустимо');
  });

  it('refuses a folder name that starts with a dot', () => {
    const result = runCli('--out', '.hidden', '--brand', 'Acme');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('недопустимо');
  });
});
