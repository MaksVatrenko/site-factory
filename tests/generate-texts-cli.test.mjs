import { describe, it, expect } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
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

  // A misspelt --layout is a mistake in what was *typed*, exactly like the two refusals above, so
  // it belongs to the same category: stderr and exit 1, before anything is paid for. The pull the
  // other way is real — everything that goes wrong *inside* a run (no key, a broken template) is
  // deliberately a stdout line and exit 0 here, because generateSite never throws and half a
  // written folder is still worth looking at — and following that rule for --layout too would turn
  // a typo into a run that starts, writes nothing and reports success. The name has to be echoed
  // back: "раскладка не найдена" alone leaves the reader guessing which of the two words they
  // typed the shell mangled.
  it('refuses a --layout that names no real layout', () => {
    const out = 'texts-cli-bad-layout';
    rmSync(join('data', 'sites', out), { recursive: true, force: true });
    try {
      const result = runCli('--out', out, '--brand', 'Acme', '--layout', 'no-such-layout');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('no-such-layout');
      // The other half of "before anything is paid for": refused at the argument stage, the run
      // never starts, so no half-made site folder is left behind for the owner to wonder about.
      expect(existsSync(join('data', 'sites', out))).toBe(false);
    } finally {
      rmSync(join('data', 'sites', out), { recursive: true, force: true });
    }
  });

  // The other side of that check, and the reason it cannot simply refuse every --layout it does
  // not recognise as a flag: a layout that really is on disk must reach generateSite untouched.
  // Without this, "refuse an unknown layout" could be satisfied by refusing all of them.
  it('lets a real --layout through to the run itself', () => {
    const out = 'texts-cli-layout-fixture';
    rmSync(join('data', 'sites', out), { recursive: true, force: true });
    try {
      const result = runCli('--out', out, '--brand', 'Acme', '--layout=long-review');
      // Same "got this far" reasoning as the --flag=value test above: no key behind
      // OPENAI_ENV_FILE, so a run that passed the argument checks stops at generateSite's own
      // "no key" line and exits cleanly, without touching the network.
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ключ');
    } finally {
      rmSync(join('data', 'sites', out), { recursive: true, force: true });
    }
  });
});
