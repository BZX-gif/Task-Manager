#!/usr/bin/env node
/**
 * Bundles the UI integration tests (which use JSX and jsdom) into plain ESM so
 * `node --test` can run them. Pure-logic tests under tests/unit run directly via
 * Node's TypeScript stripping and do not need this step.
 */
import { build } from 'esbuild'
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'tests', 'integration')
const outdir = path.join(root, 'tests', '.tmp')

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const files = (await readdir(source)).filter((file) => file.endsWith('.test.tsx'))
if (files.length === 0) {
  console.error('✖ no integration tests found')
  process.exit(1)
}

await build({
  entryPoints: files.map((file) => path.join(source, file)),
  outdir,
  outbase: source,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsx: 'automatic',
  packages: 'external',
  logLevel: 'warning',
  sourcemap: 'inline',
})

console.log(`✔ integration tests bundled (${files.length} file${files.length === 1 ? '' : 's'})`)
