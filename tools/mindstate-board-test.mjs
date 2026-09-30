import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
registerHooks({ load(url, context, next) {
  if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText }
  return next(url, context)
} })
const { MindstateBoard } = await import('../src/components/shared/MindstateBoard.tsx')
function render(props) { return new JSDOM(renderToStaticMarkup(createElement(MindstateBoard, props))).window.document }
let checks = 0
function check(label, run) { run(); checks++; console.log(`OK   ${label}`) }
const skills = [{ name: 'Evasion', skillset: 'Armor', ranks: 123.9, mindstate: 0 }]
const empty = render({ skills, skillsReady: true })
check('rank is readable without hover', () => assert.equal(empty.querySelector('[aria-label="Evasion rank 123"]').textContent, '123'))
check('pool shows denominator instead of an unexplained zero', () => assert.match(empty.body.textContent, /0\/34/))
check('all empty pools explain ranks versus learning', () => assert.match(empty.querySelector('[role="status"]').textContent, /permanent skill levels/))
check('mind lock is explained alongside the board', () => assert.match(empty.body.textContent, /34 = mind lock/))
const waiting = render({ skills, skillsReady: false })
check('startup does not present placeholder skills as observed zeros', () => assert.match(waiting.body.textContent, /Waiting for skills from the game/))
check('startup suppresses unconfirmed ranks', () => assert.equal(waiting.body.textContent.includes('123'), false))
const training = render({ skills: [{ ...skills[0], mindstate: 34 }] })
check('mind lock displays full pool honestly', () => assert.match(training.body.textContent, /34\/34/))
check('training does not show the empty-pool explanation', () => assert.equal(training.body.textContent.includes('All learning pools are empty'), false))
check('no data has its own empty state', () => assert.match(render({ skills: [] }).body.textContent, /No skills reported yet/))
check('main app passes readiness through to experience strip', () => assert.match(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), /<ExperienceStrip[^>]*skillsReady=\{character\?\.skillsReady\}/))
console.log(`mindstate board: ${checks} checks passed`)
