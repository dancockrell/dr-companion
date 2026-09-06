"""Prove tools/sign-in-test.mjs can actually go red.

    python tools/sign-in-break-check.py

A suite that cannot fail is indistinguishable from one that passes, and the
credential property this guards is the kind nobody re-derives by hand. So each
case damages the real source on purpose, runs the suite, and requires the
*named* check to be the one that goes red.

Four properties this file has that a bare "break it and see" does not:

  * **A gate before any sabotage.** The unmodified suite must be green first.
    Without it, a fix that stops the suite importing at all reads exactly like
    a fix that works - both give a non-zero exit for every case.
  * **A sabotage that changes nothing is a hard abort**, never a pass. If an
    anchor drifts, the file is rewritten unchanged, the suite passes, and the
    output would otherwise read "this check is not needed" when it means "the
    test did nothing".
  * **The named check has to be the one that fails.** A sabotage that breaks
    something else has not demonstrated the check under test; and a sabotage
    that breaks *more* than expected is a finding too, so every red line is
    printed rather than only the count.
  * **Restore is verified by md5**, and the suite must be green again at the
    end. These cases edit a file that ships.

# Why this is not in tools/test-suites.json

It writes to `src/lib/lichLogin.ts`. Several sessions edit this repository at
once, and a suite that mutates tracked source is a suite that can collide with
somebody's unsaved work. It is run deliberately, by a person, when the checks
it defends have changed - not on every `npm test`.

Case 1 is the one worth reading: its first version sabotaged `rememberSignIn`
and was caught by the wrong check, because `SignIn` never hands that function a
password. The realistic regression is a "remember me" bolted onto the call path,
which is what it damages now.
"""
import hashlib
import io
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def md5(path):
    with open(path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def run():
    p = subprocess.run(
        [os.environ.get('NODE', 'node'), '--experimental-strip-types', 'tools/sign-in-test.mjs'],
        cwd=ROOT, capture_output=True, text=True)
    return p.returncode, p.stdout


CASES = [
    # (file, find, replace, the check that must go red)
    #
    # The realistic regression: a "remember me" added on the call path itself,
    # so a whole sign-in persists the password without `rememberSignIn` ever
    # being handed one. This is the shape the main-flow check has to catch, and
    # the first version of this case did not produce it - it was caught by the
    # shape check below instead, which is a different guarantee.
    ('src/lib/lichLogin.ts',
     "  if (usingFakeBackend()) return await fakeListCharacters(args)",
     "  savePrefs({ lichAccount: args.account, lichPassword: args.password } as never)  // SABOTAGE\n"
     "  if (usingFakeBackend()) return await fakeListCharacters(args)",
     'the password string is nowhere in the persisted prefs'),
    ('src/lib/lichLogin.ts',
     "  if (fields.account !== undefined) next.lichAccount = fields.account",
     "  if (fields.account !== undefined) next.lichAccount = fields.account\n"
     "  ;(next as Record<string, unknown>).lichPassword = (fields as Record<string, unknown>).password  // SABOTAGE",
     'rememberSignIn cannot be talked into storing a password'),
    ('src/lib/lichLogin.ts',
     "  'account_locked',\n",
     "",
     # Stated as a prefix, because the number in that check's label is derived
     # from REQUIRED_KINDS and moved from 5 to 7 the day N1's enum landed two
     # more. A hardcoded 5 here would have silently stopped matching.
     'the kind set is the required'),
    ('src/lib/lichLogin.ts',
     "  account_locked:\n    'Play.net has locked this account. Sign in on the Play.net website to unlock it, then come back.',",
     "  account_locked: '',",
     'account_locked has a sentence a player can act on'),
]

# The gate: unmodified code must be green before any sabotage result counts.
code, out = run()
if code != 0:
    print(out)
    sys.exit('REFUSING TO REPORT: the suite is not green on unmodified code')
print('gate: unmodified suite is green\n')

bad = 0
for i, (rel, find, repl, expect) in enumerate(CASES, 1):
    path = os.path.join(ROOT, rel)
    backup = path + '.n5bak'
    shutil.copyfile(path, backup)
    before = md5(path)
    raw = io.open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in raw else '\n'
    needle = find.replace('\n', eol)
    if needle not in raw:
        os.remove(backup)
        sys.exit('ABORT case %d: the sabotage anchor is not in %s, so nothing was damaged '
                 'and a green run below would mean nothing' % (i, rel))
    io.open(path, 'w', encoding='utf-8', newline='').write(
        raw.replace(needle, repl.replace('\n', eol), 1))
    after = md5(path)
    if after == before:
        shutil.move(backup, path)
        sys.exit('ABORT case %d: the file is unchanged after the edit' % i)

    code, out = run()
    red_lines = [l for l in out.splitlines() if l.startswith('FAIL')]
    named = [l for l in red_lines if expect in l]
    print('case %d  %s' % (i, expect))
    print('        exit=%d  red=%d  named=%s' % (code, len(red_lines), bool(named)))
    for l in red_lines:
        print('        %s' % l.rstrip())
    if code == 0 or not named:
        bad += 1
        print('        !! this sabotage was NOT caught')
    print()

    shutil.move(backup, path)
    if md5(path) != before:
        sys.exit('ABORT: %s was not restored to its original bytes' % rel)

code, out = run()
if code != 0:
    print(out)
    sys.exit('REFUSING TO REPORT: the suite is not green again after restoring')
print('all %d files restored by md5, suite green again' % len(CASES))
sys.exit(1 if bad else 0)
