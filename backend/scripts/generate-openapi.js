// Writes docs/openapi.json from src/agent/openapi.js
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildOpenApi } from '../src/agent/openapi.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8'))
const out = path.join(here, '../../docs/openapi.json')
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(buildOpenApi(version), null, 2) + '\n')
console.log('wrote', out)
