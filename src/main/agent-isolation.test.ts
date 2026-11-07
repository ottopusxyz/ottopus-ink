import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = resolve(import.meta.dirname, '..')

/** Code an agent can reach, or that handles what an agent sends. It must never reach signing code. */
const AGENT_FACING = ['shim', 'main/agents', 'main/mcp', 'main/external']

const isSigning = (file: string) => relative(src, file).startsWith('signer/') || relative(src, file).startsWith('main/vault/') || file.endsWith('/signer-host.ts')

/** Every kind of import, static or not, in one source file. */
function importsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8')
  const found = code.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]([^'"`]+)['"`]/g)
  return [...found].map(([, specifier]) => specifier ?? '')
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

/** Every file reachable from the given ones, through relative imports. */
function reachableFrom(files: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...files]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) continue
      const target = resolveRelative(file, specifier)
      if (target) queue.push(target)
    }
  }
  return seen
}

function sourceFiles(folder: string): string[] {
  return readdirSync(join(src, folder), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
    .map((name) => join(src, folder, name))
}

describe('what an agent can reach', () => {
  it('finds code to check, so the rule below cannot pass by checking nothing', () => {
    for (const folder of AGENT_FACING) expect(sourceFiles(folder).length).toBeGreaterThan(0)
  })

  it.each(AGENT_FACING)('src/%s cannot reach signing code, directly or through anything it imports', (folder) => {
    const reached = [...reachableFrom(sourceFiles(folder))].filter(isSigning)
    expect(reached.map((file) => relative(src, file))).toEqual([])
  })

  it('would notice: main itself does reach the signer host', () => {
    expect([...reachableFrom([join(src, 'main/index.ts')])].filter(isSigning).length).toBeGreaterThan(0)
  })

  it('the shim imports nothing but Node', () => {
    for (const file of sourceFiles('shim')) {
      expect(importsOf(file).filter((specifier) => !specifier.startsWith('node:'))).toEqual([])
    }
  })
})
