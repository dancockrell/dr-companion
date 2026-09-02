const values = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  },
})

const dataset: Record<string, string> = {}
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { documentElement: { dataset } },
})
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: new EventTarget(),
})

const { initSkin, setSkin } = await import('../src/lib/skin.ts')

let failures = 0
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (!condition) failures++
}

check('missing preference initializes the default skin', initSkin() === 'elanthian-bronze')
check('initialization applies the skin before rendering', dataset.skin === 'elanthian-bronze')

values.set('drc.skin.v1', 'moonlit-iron')
check('a saved skin is restored', initSkin() === 'moonlit-iron')
check('the restored skin reaches the document root', dataset.skin === 'moonlit-iron')

values.set('drc.skin.v1', 'not-a-skin')
check('an unknown persisted value falls back safely', initSkin() === 'elanthian-bronze')

const saved = setSkin('ember-court')
check('a selection reports successful persistence', saved.ok)
check('a selection is applied immediately', dataset.skin === 'ember-court')
check('a selection survives through the documented key', values.get('drc.skin.v1') === 'ember-court')

const storage = globalThis.localStorage
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
const unavailable = setSkin('moonlit-iron')
check('the session still changes when storage is unavailable', dataset.skin === 'moonlit-iron')
check('an unavailable persistent store is reported', !unavailable.ok && unavailable.kind === 'unavailable')
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

if (failures) process.exitCode = 1
else console.log('\nall passed')
