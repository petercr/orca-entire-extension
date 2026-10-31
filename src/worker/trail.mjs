// What the panel shows of a trail, from `entire trail show --json` and `entire trail finding list --json`
// (shapes in test/fixtures/trail-*.json): the change this branch is, its merge gates and review, and
// its open findings. Entire's text is untrusted; the panel renders it as text only.
const BODY_LIMIT = 400
const FINDING_LIMIT = 20
const TEXT_LIMIT = 200

export function trailSummary(trail, { findings = null, diff = null } = {}) {
  const changes = Array.isArray(trail.changes) ? trail.changes : []
  const current = changes.find((change) => change.current) ?? changes.find((change) => change.mergeability) ?? null
  const about = findings?.trail ?? {}
  return {
    number: trail.number ?? null,
    title: trail.title ?? '',
    status: trail.status ?? null,
    type: trail.type ?? null,
    priority: trail.priority && trail.priority !== 'none' ? trail.priority : null,
    body: typeof trail.body === 'string' ? trail.body.slice(0, BODY_LIMIT) : '',
    repository: current?.repository ?? null,
    change: current?.number ?? null,
    changeStatus: current?.status ?? null,
    branch: current?.branch ?? about.branch ?? null,
    base: about.base ?? null,
    author: about.author?.login ?? null,
    createdAt: trail.createdAt ?? null,
    mergedAt: about.mergedAt ?? null,
    diff,
    changes: changes.map((change) => ({
      repository: change.repository ?? '',
      branch: change.branch ?? '',
      status: change.status ?? null,
      current: change === current
    })),
    merge: current?.mergeability ? mergeSummary(current.mergeability, about.base) : null,
    findings: findings ? findingsSummary(findings) : null
  }
}

function mergeSummary(mergeability, base) {
  const gates = mergeability.gates ?? []
  const findingsGate = gates.find((gate) => gate.gate_type === 'findings')
  return {
    mergeable: Boolean(mergeability.mergeable),
    conflicts: mergeability.conflict_status && !['clean', 'unknown'].includes(mergeability.conflict_status) ? mergeability.conflict_status : null,
    checks: (mergeability.checks?.runs ?? []).map((run) => ({
      name: run.name ?? 'check',
      status: run.conclusion ?? run.status ?? 'unknown'
    })),
    gates: gates.map((gate) => ({
      key: gate.gate_key ?? gate.gate_type ?? 'gate',
      blocking: Boolean(gate.blocking),
      status: gate.status ?? 'unknown',
      rationale: gate.rationale ?? '',
      summary: gateSummary(gate, base),
      people: gate.gate_type === 'approvals' ? approvers(gate) : []
    })),
    review: findingsGate ? reviewSummary(findingsGate) : null
  }
}

// The short phrase Entire's web view puts beside each gate, such as "2 of 2 passed".
function gateSummary(gate, base) {
  const value = gate.value ?? {}
  if (gate.state === 'not_run') return 'Not evaluated yet'
  if (gate.gate_type === 'approvals') return `${value.approved ?? 0} of ${value.required ?? 0}`
  if (gate.gate_type === 'checks') {
    const runs = value.checks ?? []
    const total = value.total_count ?? runs.length
    if (!total) return 'No checks'
    return `${runs.filter((run) => run.conclusion === 'success').length} of ${total} passed`
  }
  if (gate.gate_type === 'findings') {
    const blocking = value.agent_blocking_findings ?? gate.finding_count ?? 0
    return blocking ? `${blocking} blocking` : 'None blocking'
  }
  if (gate.gate_type === 'up_to_date' && value.behind_by > 0) return `${value.behind_by} behind ${base ?? 'base'}`
  return null
}

function approvers(gate) {
  const reviewers = [gate.reviewers, gate.value?.reviewers].flat().filter(Boolean)
  return reviewers.filter((reviewer) => reviewer.state === 'approved' && reviewer.login).map((reviewer) => reviewer.login)
}

// The findings gate carries the review: which reviewers ran and what they found, by severity.
function reviewSummary(gate) {
  const value = gate.value ?? {}
  const reviewers = (value.reviewers ?? []).map((reviewer) => ({
    name: reviewer.name ?? 'Reviewer',
    kind: reviewer.kind ?? null,
    status: reviewer.status ?? 'unknown',
    blocking: reviewer.blocking_findings ?? 0,
    nonBlocking: reviewer.non_blocking_findings ?? 0
  }))
  return {
    status: gate.status ?? 'unknown',
    verdict: reviewVerdict(value, reviewers),
    inFlight: Boolean(value.review_in_flight),
    reviewers,
    severity: {
      high: value.agent_findings?.high ?? 0,
      medium: value.agent_findings?.medium ?? 0,
      low: value.agent_findings?.low ?? 0
    }
  }
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

// Open findings first, then by severity, as the web view lists them.
// A review agent's signal is true, a fail in Entire's web view, when it reports any defect, blocking
// or not. The findings gate is a separate question: it fails only on findings at its minimum severity.
function reviewVerdict(value, reviewers) {
  if (value.review_in_flight) return 'running'
  const done = reviewers.filter((reviewer) => reviewer.status === 'completed')
  if (!done.length) return 'not_run'
  return done.some((reviewer) => reviewer.blocking + reviewer.nonBlocking > 0) ? 'fail' : 'pass'
}

function findingsSummary({ counts = {}, findings = [] }) {
  const ordered = [...findings].sort(
    (a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
  )
  return {
    open: counts.Open ?? 0,
    high: counts.OpenHigh ?? 0,
    medium: counts.OpenMedium ?? 0,
    low: counts.OpenLow ?? 0,
    resolved: counts.Resolved ?? 0,
    dismissed: counts.Dismissed ?? 0,
    stale: counts.Stale ?? 0,
    items: ordered.slice(0, FINDING_LIMIT).map((finding) => {
      const location = finding.location ?? {}
      const body = String(finding.body ?? '')
      return {
        // Agents often leave the title empty and lead the body with the defect.
        title: (finding.title || body.split(/(?<=[.!?])\s|\n/)[0] || '').slice(0, TEXT_LIMIT),
        body: body.slice(0, BODY_LIMIT * 2),
        severity: finding.severity ?? null,
        confidence: typeof finding.confidence === 'number' ? finding.confidence : null,
        status: finding.status ?? null,
        reason: finding.statusReason ? String(finding.statusReason).slice(0, BODY_LIMIT) : null,
        stale: finding.staleOutcome === 'stale',
        file: location.filePath ?? location.file_path ?? null,
        line: location.startLine ?? location.start_line ?? null,
        endLine: location.endLine ?? location.end_line ?? null
      }
    })
  }
}
