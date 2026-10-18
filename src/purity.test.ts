// The library must be a pure function of its inputs. This checks that the ESLint guard catches
// every way we know of to read the outside world or depend on the machine.
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

async function problems(code: string, filePath = 'src/arith.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.map((m) => m.ruleId);
}

describe('the purity guard', () => {
  const impure: [string, string][] = [
    ['a Node import', `import { readFileSync } from 'node:fs';\nexport const f = readFileSync;`],
    ['a dynamic import', `export const f = () => import('node:fs');`],
    ['randomness', `export const r = Math.random();`],
    ['the clock', `export const d = Date.now();`],
    ['the network', `export const t = () => fetch('https://example.org');`],
    ['locale-dependent sorting', `export const s = ['b', 'a'].sort((x, y) => x.localeCompare(y));`],
    ['locale-dependent formatting', `export const n = (1000).toLocaleString();`],
    ['Intl', `export const c = new Intl.Collator();`],
    ['eval', `export const e = eval('1');`],
  ];

  for (const [what, code] of impure) {
    it(`refuses ${what} in library code`, async () => {
      expect((await problems(code)).length).toBeGreaterThan(0);
    });
  }

  it('allows plain computation', async () => {
    expect(await problems('export const add = (a: number, b: number): number => a + b;\n')).toEqual(
      [],
    );
  });

  it('lets the CLI read files', async () => {
    const code = `import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n`;
    expect(await problems(code, 'src/cli/main.ts')).not.toContain('no-restricted-imports');
  });
}, 60_000);
