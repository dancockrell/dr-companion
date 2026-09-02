/**
 * Resolve one Python interpreter for every Python-backed test suite.
 *
 * CI normally provides `python` or `python3`. The desktop development bundle
 * keeps Python beside its Node runtime without adding it to PATH. Keeping that
 * topology here avoids a machine-specific path while letting the same test
 * controller use the runtime it was launched with.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export function pythonCandidates() {
  if (process.env.DRC_PYTHON) return [process.env.DRC_PYTHON]

  const candidates = ['python', 'python3']
  const bundledCandidates = [
    resolve(dirname(process.execPath), '..', '..', 'python', 'python.exe'),
    resolve(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
  ]
  for (const bundled of bundledCandidates) {
    if (existsSync(bundled)) candidates.push(bundled)
  }
  return [...new Set(candidates)]
}

export function pythonWorks(executable) {
  try {
    const result = spawnSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    })
    return result.status === 0 && /^Python\s+\d/i.test(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  } catch {
    return false
  }
}

export function findPython(candidates = pythonCandidates(), probe = pythonWorks) {
  return candidates.find(probe) ?? null
}

export function pythonNotCheckedMessage(testFile) {
  return [
    `NOT CHECKED: no working Python found, so ${testFile} did not run.`,
    `             tried: ${pythonCandidates().join(', ')}`,
    `             set DRC_PYTHON to a Python executable to run it.`,
    `             This is not a pass. Nothing in ${testFile} was exercised.`,
  ].join('\n')
}
