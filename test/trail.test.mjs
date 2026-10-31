import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { trailSummary } from '../src/worker/trail.mjs'

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
// Trail #1 on plugin-scaffold, right after it was created: open, not yet reviewed or approved.
const created = await fixture('trail-show.json')
// Trail #367's endo.chat_backend change, reached through its branch after review, approval and merge.
const merged = await fixture('trail-367-show.json')
const mergedFindings = await fixture('trail-367-findings.json')

test('a trail keeps what the panel shows and drops ids and accounts', () => {
  const summary = trailSummary(created)
  assert.deepEqual(
    { number: summary.number, title: summary.title, status: summary.status, type: summary.type, priority: summary.priority },
    { number: 1, title: 'Entire for Orca: plugin scaffold and panel', status: 'open', type: 'feature', priority: null }
  )
  assert.deepEqual(
    { repository: summary.repository, change: summary.change, branch: summary.branch },
    { repository: 'orca-entire-extension', change: 1, branch: 'plugin-scaffold' }
  )
  assert.ok(!JSON.stringify(summary).includes(created.authorAccountId))
})

test('an unreviewed change shows each gate with its short summary', () => {
  const { merge } = trailSummary(created)
  assert.equal(merge.mergeable, false)
  assert.deepEqual(
    merge.gates.map(({ key, status, summary, people }) => ({ key, status, summary, people })),
    [
      { key: 'approvals', status: 'failed', summary: '0 of 1', people: [] },
      { key: 'findings', status: 'pending', summary: 'Not evaluated yet', people: [] },
      { key: 'up_to_date', status: 'passed', summary: null, people: [] }
    ]
  )
  assert.deepEqual(merge.review, { status: 'pending', verdict: 'not_run', inFlight: false, reviewers: [], severity: { high: 0, medium: 0, low: 0 } })
})

test('a review that found anything fails, even when the findings gate passes', async () => {
  // Trail #1 after Code review reported two medium findings; the gate blocks only on high ones.
  const summary = trailSummary(await fixture('trail-1-reviewed-show.json'), { findings: await fixture('trail-1-reviewed-findings.json') })
  const gate = summary.merge.gates.find((g) => g.key === 'findings')
  assert.deepEqual([gate.status, gate.summary], ['passed', 'None blocking'])
  assert.equal(summary.merge.review.verdict, 'fail')
  assert.deepEqual(summary.merge.review.severity, { high: 0, medium: 2, low: 0 })
  assert.deepEqual(
    summary.findings.items.map(({ severity, status }) => [severity, status]),
    [
      ['medium', 'open'],
      ['medium', 'open']
    ]
  )
})

test('a review that found nothing passes', () => {
  assert.equal(trailSummary(merged, { findings: mergedFindings }).merge.review.verdict, 'pass')
})

test('a reviewed, approved change shows checks, approvers and the review', () => {
  const summary = trailSummary(merged, { findings: mergedFindings, diff: { files: 3, additions: 458, deletions: 20 } })
  assert.deepEqual(
    { change: summary.change, changeStatus: summary.changeStatus, base: summary.base, author: summary.author, diff: summary.diff },
    { change: 153, changeStatus: 'merged', base: 'main', author: 'petercr', diff: { files: 3, additions: 458, deletions: 20 } }
  )
  assert.deepEqual(
    summary.merge.gates.map(({ key, status, summary: text, people }) => [key, status, text, people]),
    [
      ['approvals', 'passed', '1 of 1', ['petercr']],
      ['checks', 'passed', '2 of 2 passed', []],
      ['findings', 'passed', 'None blocking', []],
      ['up_to_date', 'passed', null, []]
    ]
  )
  assert.deepEqual(
    summary.merge.review.reviewers.map(({ name, status, blocking }) => [name, status, blocking]),
    [
      ['Code review', 'completed', 0],
      ['Trail Review', 'completed', 0]
    ]
  )
  assert.deepEqual(summary.findings, { open: 0, high: 0, medium: 0, low: 0, resolved: 0, dismissed: 0, stale: 0, items: [] })
})

test('findings keep their text, confidence, status and how they were resolved, open ones first', () => {
  const { findings } = trailSummary(created, {
    findings: {
      counts: { Open: 1, OpenHigh: 1, Resolved: 1 },
      findings: [
        {
          title: null,
          body: 'The median drops ordinary-turn timing. It should use every landed play.',
          severity: 'medium',
          confidence: 0.94,
          status: 'resolved',
          statusReason: 'Line 51 now uses every landed play.',
          staleOutcome: 'stale',
          location: { filePath: 'apps/jumpIns.ts', startLine: 50, endLine: 54 }
        },
        { title: 'Token logged in plain text', body: 'detail', severity: 'high', confidence: 0.9, status: 'open', location: { filePath: 'src/a.mjs', startLine: 12 } }
      ]
    }
  })
  assert.deepEqual(
    findings.items.map(({ title, status, confidence, reason, stale, file, line, endLine }) => ({ title, status, confidence, reason, stale, file, line, endLine })),
    [
      { title: 'Token logged in plain text', status: 'open', confidence: 0.9, reason: null, stale: false, file: 'src/a.mjs', line: 12, endLine: null },
      {
        title: 'The median drops ordinary-turn timing.',
        status: 'resolved',
        confidence: 0.94,
        reason: 'Line 51 now uses every landed play.',
        stale: true,
        file: 'apps/jumpIns.ts',
        line: 50,
        endLine: 54
      }
    ]
  )
  assert.equal(findings.high, 1)
  assert.equal(findings.resolved, 1)
})

test('a trail without changes or mergeability still summarizes', () => {
  const summary = trailSummary({ number: 2, title: 'Intent only', status: 'open', body: 'x'.repeat(1000) })
  assert.deepEqual(summary.changes, [])
  assert.equal(summary.merge, null)
  assert.equal(summary.findings, null)
  assert.equal(summary.body.length, 400)
})
