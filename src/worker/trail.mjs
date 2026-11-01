// What the panel shows of a trail, from `entire trail show --json` and `entire trail finding list --json`
// (shapes in test/fixtures/trail-*.json): the change this branch is, its merge gates and review, and
// its open findings. Entire's text is untrusted; the panel renders it as text only.
const BODY_LIMIT = 400
const FINDING_LIMIT = 20
const TEXT_LIMIT = 200
const LIST_LIMIT = 30

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
    gates: gates.map((gate) => ({
      key: gate.gate_key ?? gate.gate_type ?? 'gate',
      type: gate.gate_type ?? null,
      blocking: Boolean(gate.blocking),
      status: gate.status ?? 'unknown',
      evaluated: gate.state !== 'not_run',
      rationale: text(gate.rationale),
      summary: gateSummary(gate, base),
      people: gate.gate_type === 'approvals' ? approvers(gate) : [],
      at: gate.completed_at ?? null,
      sha: gate.evaluated_at_sha ? String(gate.evaluated_at_sha).slice(0, 7) : null,
      // Evaluated on an earlier commit than the change's head.
      outdated: Boolean(gate.evaluated_at_sha && gate.head_sha && gate.evaluated_at_sha !== gate.head_sha),
      staleReason: gate.stale_reason ? text(gate.stale_reason) : null,
      detail: gateDetail(gate, mergeability)
    })),
    review: findingsGate ? reviewSummary(findingsGate) : null
  }
}

function text(value) {
  return String(value ?? '').slice(0, TEXT_LIMIT)
}

// What the panel shows when a gate is opened: who approved, each check run, the review behind the
// findings gate, or how far behind the base the branch is.
function gateDetail(gate, mergeability) {
  const value = gate.value ?? {}
  const config = value.config ?? {}
  if (gate.gate_type === 'approvals') {
    return {
      approved: value.approved ?? 0,
      required: value.required ?? config.min_reviewers ?? 0,
      changesRequested: Boolean(value.changes_requested),
      staleDismissed: value.stale_dismissed ?? 0,
      selfExcluded: Boolean(value.self_excluded),
      selfApproval: config.allow_self_approval ?? null,
      dismissStale: config.dismiss_stale_approvals_on_push ?? null,
      reviewers: gateReviewers(gate)
    }
  }
  if (gate.gate_type === 'checks') {
    // The change's own runs carry the app and timing; the gate's copy is the fallback.
    const runs = mergeability.checks?.runs?.length ? mergeability.checks.runs : (value.checks ?? [])
    return {
      requireAll: config.require_all_success ?? null,
      required: (config.required_checks ?? []).slice(0, LIST_LIMIT).map((check) => text(check?.name ?? check)),
      total: value.total_count ?? runs.length,
      runs: runs.slice(0, LIST_LIMIT).map((run) => ({
        name: text(run.name ?? 'check'),
        app: run.app_name ? text(run.app_name) : null,
        status: run.conclusion ?? run.status ?? 'unknown',
        startedAt: run.started_at ?? null,
        completedAt: run.completed_at ?? null
      }))
    }
  }
  if (gate.gate_type === 'findings') {
    if (gate.state === 'not_run' || !gate.value) return null
    const review = reviewSummary(gate)
    return {
      minSeverity: config.agent_findings_min_severity ?? null,
      blocking: value.agent_blocking_findings ?? gate.finding_count ?? 0,
      reviewedHead: value.reviewed_head ?? null,
      inFlight: review.inFlight,
      reviewers: review.reviewers.slice(0, LIST_LIMIT),
      severity: review.severity
    }
  }
  if (gate.gate_type === 'up_to_date') {
    if (gate.state === 'not_run' || !gate.value) return null
    return {
      behindBy: value.behind_by ?? 0,
      compare: value.compare_status ?? null,
      allowBehind: config.allow_behind_if_mergeable ?? null
    }
  }
  return null
}

// Everyone who reviewed, once each, with where they landed.
function gateReviewers(gate) {
  const seen = new Set()
  return [gate.reviewers, gate.value?.reviewers]
    .flat()
    .filter((reviewer) => reviewer?.login && !seen.has(reviewer.login) && seen.add(reviewer.login))
    .slice(0, LIST_LIMIT)
    .map((reviewer) => ({
      login: text(reviewer.login),
      state: reviewer.state ?? 'unknown',
      reason: reviewer.reason ? text(reviewer.reason) : null,
      outdated: Boolean(reviewer.reviewed_head_sha && gate.head_sha && reviewer.reviewed_head_sha !== gate.head_sha)
    }))
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
