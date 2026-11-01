// "Entire: Check connection" walks every link the plugin depends on and reports one line per link.
export function connectionReport(orca, snapshot) {
  return [`Orca host API ${orca.api.major}.${orca.api.minor} · Node ${process.version} on ${process.platform}`, ...reportLines(snapshot)].join('\n')
}

export function reportLines({ workspace, problem, steps }) {
  const lines = []
  if (workspace?.where) lines.push(`✓ ${workspace.name} on ${workspace.server?.branch ?? workspace.branch} → ${workspace.where} (via ${workspace.via})`)
  if (problem) lines.push(`✗ ${problem}`)
  for (const step of steps) {
    const mark = step.ok ? '✓' : step.optional ? '·' : '✗'
    lines.push(`${mark} ${step.label}: ${step.text}${step.ok ? ` (${step.ms} ms)` : ''}`)
  }
  return lines
}

// Orca's notifications take a title of up to 120 characters and a body of up to 1000.
export function connectionNotice(report) {
  const [, ...details] = report.split('\n')
  const ok = !details.some((line) => line.startsWith('✗'))
  return {
    title: ok ? 'Entire: connected' : 'Entire: connection problem',
    body: details.join('\n').slice(0, 1000)
  }
}
