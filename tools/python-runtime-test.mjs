import { readFileSync } from 'node:fs'
import { findPython, pythonCandidates, pythonNotCheckedMessage } from './find-python.mjs'

let failures = 0
function check(label, value, detail = '') {
  console.log(`${value ? 'OK  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!value) failures++
}

const previous = process.env.DRC_PYTHON
process.env.DRC_PYTHON = 'chosen-python'
check('DRC_PYTHON is authoritative', JSON.stringify(pythonCandidates()) === JSON.stringify(['chosen-python']))
if (previous == null) delete process.env.DRC_PYTHON
else process.env.DRC_PYTHON = previous

check('the resolver chooses the first interpreter that actually works', findPython(['broken', 'working', 'later'], (candidate) => candidate === 'working') === 'working')
check('the resolver reports null when no candidate works', findPython(['broken'], () => false) === null)
check('a missing runtime is explicitly not a pass', /NOT CHECKED:.*This is not a pass/s.test(pythonNotCheckedMessage('example.py')))

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const suites = JSON.parse(readFileSync('tools/test-suites.json', 'utf8'))
const pythonSuites = ['test:drtask', 'test:sight-picture', 'test:flow', 'test:routine', 'test:runner', 'test:framing']
check('every Python suite uses the shared runner', pythonSuites.every((name) => pkg.scripts[name]?.startsWith('node tools/python-test.mjs ')))
check('the resolver test is part of the canonical suite', suites.includes('test:python-runtime'))

if (failures) process.exit(1)
console.log('\nall Python runtime checks passed')
