#!/usr/bin/env node
/** Remove stale production assets before Vite copies the current public shell. */
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await rm(path.join(root, 'dist'), { recursive: true, force: true })
