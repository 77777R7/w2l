#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { W2L } from '@w2l/sdk'
import { runRealTasks, writePhase4Report, type RealTaskSpec } from './phase4RealTask.js'

const manifestPath = process.env.W2L_PHASE4_MANIFEST ?? 'research/phase4_real_tasks.json'
const outputPath = process.env.W2L_PHASE4_OUTPUT ?? 'output/phase4/real-task-report.json'
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string; tasks: readonly RealTaskSpec[] }
const client = new W2L({ baseUrl: process.env.W2L_API_URL ?? 'http://127.0.0.1:8787' })
const report = await runRealTasks(client, manifest.tasks)
await writePhase4Report(outputPath, { ...report, manifestVersion: manifest.version })
console.log(`Phase 4 report: ${outputPath}`)
