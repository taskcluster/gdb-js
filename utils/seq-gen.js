#!/usr/bin/env node

import fs from 'fs'
import { spawn } from 'child_process'

let seq = []

let gdb = spawn('stdbuf', ['-i0', '-o0', '-e0',
  'gdb', '--interpreter=mi', process.argv[2]])

gdb.stdout.on('data', (data) => {
  seq.push({ type: 'stdout', data: data.toString() })
  process.stdout.write(data)
})

gdb.stderr.on('data', (data) => {
  seq.push({ type: 'stderr', data: data.toString() })
  process.stderr.write(data)
})

process.stdin.on('data', (data) => {
  seq.push({ type: 'stdin', data: data.toString() })
  gdb.stdin.write(data)
})

gdb.on('close', () => {
  fs.writeFileSync(process.argv[3], JSON.stringify(seq, null, 2))
  process.exit()
})
