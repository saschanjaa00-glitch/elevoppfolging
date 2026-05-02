// One-time script: fetches all fagkoder from UDIR and writes src/fagkodeLookup.ts
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'fagkodeLookup.ts')

console.log('Fetching fagkoder from data.udir.no...')
const res = await fetch('https://data.udir.no/kl06/v201906/fagkoder')
if (!res.ok) throw new Error(`HTTP ${res.status}`)
const data = await res.json()

console.log(`Got ${data.length} entries`)

const lookup = {}
for (const entry of data) {
  const kode = entry.kode
  if (!kode) continue
  const titler = entry.tittel ?? []
  const nob = titler.find(t => t.spraak === 'nob')?.verdi
  const def = titler.find(t => t.spraak === 'default')?.verdi
  const navn = nob ?? def ?? ''
  if (navn) lookup[kode] = navn
}

const sorted = Object.keys(lookup).sort()
const lines = sorted.map(k => `  '${k}': '${lookup[k].replace(/'/g, "\\'")}',`)

const ts = `// Auto-generated from https://data.udir.no/kl06/v201906/fagkoder
// Do not edit manually — re-run scripts/generateFagkodeLookup.mjs to update
export const fagkodeLookup: Record<string, string> = {
${lines.join('\n')}
}

export function getFagnavn(fagkode: string): string {
  return fagkodeLookup[fagkode?.trim()] ?? fagkode
}
`

writeFileSync(OUT, ts, 'utf8')
console.log(`Written ${sorted.length} entries to src/fagkodeLookup.ts`)
