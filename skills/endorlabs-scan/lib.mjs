// Pure helper functions for endorlabs-scan.
// The skill uses MCP tools directly (no network calls here).
// This module exists so the filtering, mapping, and validation logic can be tested.

// Endorlabs level strings map to the skill's severity argument
export const SEVERITY_LEVELS = {
  critical: ['CRITICAL'],
  high:     ['CRITICAL', 'HIGH'],
  medium:   ['CRITICAL', 'HIGH', 'MEDIUM'],
  all:      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
};

const VALID_SEVERITIES = Object.keys(SEVERITY_LEVELS);

export function validateSeverity(severity) {
  return VALID_SEVERITIES.includes(severity);
}

// Filter raw Endorlabs findings by the resolved severity level list
export function filterFindings(findings, severity) {
  const levels = SEVERITY_LEVELS[severity] ?? SEVERITY_LEVELS.high;
  return findings.filter(f => {
    const level = (f.spec?.level ?? '').toUpperCase();
    return levels.includes(level);
  });
}

// Map a raw Endorlabs finding to a clean output row
export function buildFindingRow(finding) {
  const spec = finding.spec ?? {};
  const meta = finding.meta ?? {};
  return {
    uuid:         finding.uuid ?? null,
    name:         meta.name ?? null,
    type:         spec.finding_type ?? null,
    level:        spec.level ?? null,
    summary:      spec.summary ?? null,
    remediation:  spec.remediation ?? null,
    fixAvailable: Boolean(spec.remediation),
  };
}

// Assemble the final scan result from filtered findings
export function buildResult({ namespace, repo, severity, findings }) {
  const filtered = filterFindings(findings, severity);
  const rows     = filtered.map(buildFindingRow);
  return {
    namespace,
    repo,
    severity,
    findings: rows,
    summary: {
      total:   rows.length,
      fixable: rows.filter(r => r.fixAvailable).length,
    },
  };
}
