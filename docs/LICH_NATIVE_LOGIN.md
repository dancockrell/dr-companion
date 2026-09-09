# Lich-native login — the protocol, the launch, and the credential

Written 6 September 2026 against `main` @ `1ad6771d`, Lich 5.20.1 as installed
at `C:\Ruby4Lich5\Lich5` (`lib/version.rb:3`), and the DR Companion tree in
this repository. It is the reference document for **Lane N** of
`docs/PLAN_TO_1_0.md`; the plan carries the increments, this carries the
evidence they are built on.

Dan's instruction, 6 Sep 2026: *"we aren't using genie anymore… you have to
implement correctly using lich."* DR Companion is the frontend. It signs the
player in, it starts Lich, and Lich talks to it. Nothing else is in the path.

Every claim about Lich below was read out of the installed source and is cited
`file:line`. Every claim about this app was read out of this tree. §7 separates
what was read from what is inferred, and nothing in §7's inferred column may be
built on without measuring it first.

---

## 1. What the app already does, and what Genie was actually for

The framing that made this look like a large job — "Genie is our frontend, we
must replace a frontend" — is wrong, and one read of `game_link.rs` settles it.

**The app is already a Lich frontend for game text.** `src-tauri/src/lich.rs:517`
(`launch_args`) starts Lich as:

```
lich.rbw --login <Character> --dragonrealms --stormfront --headless=11024 --start-scripts=companion_bridge
```

`--headless=11024` is not a Lich primitive. It is normalised, before anything
else parses ARGV, into the pair this design needs
(`lib/main/arg_normalization.rb:52-53`):

```ruby
argv[headless_index] = '--without-frontend'
argv.insert(headless_index + 1, "#{DETACHABLE_CLIENT_PREFIX}#{normalize_headless_target(port_token)}")
```

and refuses to be combined with an explicit `--detachable-client`
(`arg_normalization.rb:33-35`). Lich then opens a `TCPServer` on that port
(`lib/main/main.rb:842-857`) and the app dials it —
`src-tauri/src/game_link.rs:304`, `TcpStream::connect((host, port))`, port
`11024` from the single constant `src-tauri/src/lich.rs:107`
(`pub const DETACHABLE_PORT: u16 = 11024;`).

What comes down that socket is the **Lich-processed Simutronics XML stream**,
written by `send_to_client` (`lib/games.rb:1122-1130`), and
`src/lib/gameStream.ts` already parses it — its own header calls it "a
twenty-year-old tag soup" (`gameStream.ts:29-35`). Commands go back up the same
socket as bare lines, `game_link.rs:510-527`, CRLF-terminated.

So the game socket, the stream format and the parser are all in place and none
of them are Genie's.

**Genie supplied exactly one thing: the credential step.** `--login <Character>`
resolves a *saved* entry out of Lich's own store — `lib/main/main.rb:112-118`,
reading `data/entry.yaml` via `lib/common/authentication/cli.rb:192-204`. If
there is no saved entry, there is nothing to log in with, and Lich's own GTK
window cannot create one on this machine, which
`src-tauri/src/lich.rs:490-495` states in the status it returns:

> "…its own login window cannot complete on this machine: it only offers
> Wrayth, Wizard, Avalon and Saga, and none of those are installed. Genie is
> not one it can offer."

That is the whole hole, and the Genie instructions in
`src/components/shared/WaitingForCharacter.tsx:138-160` and
`src/components/shared/LichLauncher.tsx:263-285` are a workaround for it: they
tell the player to sign in through Genie, which performs the account login and
then hands Lich a connection.

**Lane N closes the hole directly.** The app performs the account login itself,
which is a documented protocol Lich implements in about two hundred lines of
Ruby, and hands Lich the result. Genie then has no job left.

---

## 2. The EAccess protocol, as read from Lich's source

All of §2 is `C:\Ruby4Lich5\Lich5\lib\common\authentication\eaccess.rb` unless
stated otherwise.

### 2.1 Transport

`eaccess.rb:65-77`:

```ruby
def self.socket(hostname = "eaccess.play.net", port = 7910)
  download_pem unless pem_exist?
  socket = TCPSocket.open(hostname, port)
  cert_store              = OpenSSL::X509::Store.new
  ssl_context             = OpenSSL::SSL::SSLContext.new
  ssl_context.cert_store  = cert_store
  ssl_context.verify_mode = OpenSSL::SSL::VERIFY_PEER
  cert_store.add_file(pem) if pem_exist?
  ssl_socket = OpenSSL::SSL::SSLSocket.new(socket, ssl_context)
  ssl_socket.sync_close = true
  EAccess.verify_pem(ssl_socket.connect)
  return ssl_socket
end
```

Host `eaccess.play.net`, port `7910`, TLS. The trust model is **self-signed
certificate pinning against a downloaded PEM**, not CA validation: the store
starts empty and is given only `File.join(DATA_DIR, "simu.pem")`
(`eaccess.rb:30`). That file exists on this machine (`C:\Ruby4Lich5\Lich5\data\simu.pem`).

Worth naming rather than copying: `verify_pem` (`eaccess.rb:53-62`) is
trust-on-every-use — on a mismatch it logs and re-downloads the pin, and the
`fail Exception` line is commented out at `:61`. That is a weaker check than it
looks, and Lane N does not reproduce it (see §3.1).

Reads are `conn.sysread(8192)` (`eaccess.rb:232-234`, `PACKET_SIZE = 8192` at
`:22`). Every send is `conn.puts "…\n"`.

**Corrected 6 Sep 2026 by N1, measured rather than reasoned.** This sentence
used to end "so each frame ends `\n\n`", and that is wrong: Ruby's `IO#puts`
does not add a newline to a string that already ends with one, so **each frame
ends with a single `\n`**. Measured with Lich's own interpreter,
`C:\Ruby4Lich5\4.0.6\bin\ruby.exe`, where `io.puts "K\n"` writes exactly
`[75, 10]`. `PLAN_TO_1_0.md`'s N1 `do:` repeats the old claim and is stale the
same way; N1's `done:` line records it. The check that keeps the code on the
measurement rather than on this document is
`eaccess::tests::frames_end_with_one_newline`.

### 2.2 The sequence

`eaccess.rb:101-174`, in order. `→` is client-to-server.

| # | Sent | Expected reply | Cite |
|---|---|---|---|
| 1 | `K\n` | the hashkey, raw bytes | `:106-107` |
| 2 | `A\t<account>\t<obscured password>\n` | must match `/KEY\t(?<key>.*)\t/`, else `AuthenticationError` carrying `response.split(/\s+/).last` | `:113-118` |
| 3 | `M\n` | must match `/^M\t/` | `:120-122` |
| 4 | `F\t<game_code>\n` | must match `/NORMAL\|PREMIUM\|TRIAL\|INTERNAL\|FREE/`; stored as `Account.subscription` | `:126, :134-136` |
| 5 | `G\t<game_code>\n` | discarded | `:141` |
| 6 | `P\t<game_code>\n` | discarded | `:144` |
| 7 | `C\n` | the character list; stored as `Account.members` | `:147-151` |
| 8 | `L\t<char_code>\tSTORM\n` | must begin `L\tOK\t` | `:154-160` |

`N\t<game>` is **not** in this path. It appears only in the legacy enumeration
branch used when neither a game code nor a character is supplied
(`eaccess.rb:180`, reached from `authenticator.rb:46-57`). Lane N always has
both, so `N` is never sent.

### 2.2a The `A` refusal vocabulary, and which token may cost a password

`eaccess.rb:115-118` is the whole of Lich's handling: if the `A` reply does not
match `/KEY\t(?<key>.*)\t/`, it takes the last whitespace-separated field as
`error_code` and raises `AuthenticationError` with it. It never interprets the
token.

One file does. `authenticator.rb:23` lists the codes that must not be retried,
and the comment above it (`authenticator.rb:20-22`) glosses each one — this is
**read**, not inferred, and it is the only written-down `A` vocabulary in the
tree:

```ruby
# REJECT = bad credentials, NORECORD = account not found, INVALID = invalid request
# PASSWORD = wrong password, CHARACTER_NOT_FOUND = character not in account
# GENERATOR_NOT_AVAILABLE = account not entitled to create a character on the instance
FATAL_ERROR_CODES = %w[REJECT NORECORD INVALID PASSWORD CHARACTER_NOT_FOUND GENERATOR_NOT_AVAILABLE].freeze
```

Read on 7 Sep 2026 from Lich 5.20.1 on this machine,
`C:/Ruby4Lich5/Lich5/lib/common/authentication/authenticator.rb`,
md5 `c47b25216ca6a9f0813eecd0792d5bfc`. `eaccess.rb` alongside it is
md5 `785de8dc72423f7896657af890ba005e`. The check, not the claim:

```bash
grep -n "FATAL_ERROR_CODES =" -B 4 /c/Ruby4Lich5/Lich5/lib/common/authentication/authenticator.rb
```

`eaccess.rs`'s `EAccessError::from_refusal_code` is the one place this app maps
a token to a variant:

| token | Lich's gloss | this app | stored password | what the player is told |
|---|---|---|---|---|
| `PASSWORD` | wrong password | `BadCredentials` | **forgotten** | That account name or password was not accepted. Check both and try again. |
| `REJECT` | bad credentials | `AccountRefused` | kept | Play.net refused the account name and password together. Check both. Your saved password has been kept. |
| `NORECORD` | account not found | `AccountRefused` | kept | No account with that name. Check the account name (not the character name). |
| `INVALID` | invalid request | `AccountRefused` | kept | Play.net called the request invalid. Try again; if it repeats, the login service may have changed. |
| `CHARACTER_NOT_FOUND` | character not in account | `AccountRefused` | kept | Play.net says that character is not on this account. Start the sign-in again to get a fresh character list. |
| `GENERATOR_NOT_AVAILABLE` | not entitled to the generator | `AccountRefused` | kept | Play.net answered as though this app had asked to make a new character. It never does, so this is worth reporting as a bug. |
| contains `LOCK`/`SUSPEND`/`EXPIRE`/`CLOSED`/`BANNED` | — (inferred shapes) | `AccountLockedOrExpired` | kept | Play.net has locked this account. Sign in on the Play.net website to unlock it, then come back. |
| anything else, `NEW` and `""` included | — | `AccountRefused` | kept | …gave a reason this app does not recognise… **and the raw token** |

**The sentence column is not maintained here.** The five `AccountRefused` rows
come from `login_error.rs`'s `REFUSAL_SENTENCES`, generated into
`src/lib/loginErrorFixtures.ts`, which is the table the webview renders; the
other rows are `LOGIN_ERROR_SENTENCES` in `src/lib/lichLogin.ts`. Where this
document and those disagree, they are right and this is stale. The check rather
than the claim:

```bash
node --experimental-strip-types tools/login-error-fixture-test.mjs
node --experimental-strip-types tools/sign-in-test.mjs
```

Issue #507 is why the column exists. Every `AccountRefused` row used to be told
Play.net "gave a reason this app does not recognise", and to go and check the
account on the Play.net website — one remedy for four causes, and a claim the
gloss column two cells to its left disproves. `NORECORD` is the sharp one: it
means the **account name** is wrong, which is a field on the screen in front of
the player, and they were sent to a website instead. The unrecognised-token
wording survives on the last row, which is the row it is true of, and now shows
the raw token so a bug report carries it.

`PASSWORD` is the only row that deletes anything, and that is the point of
issue #488. Until it, the classifier had two states and everything that was not
one of five lock words fell through to `BadCredentials` — which was harmless
prose until #459 made `BadCredentials` the trigger for erasing the Windows
Credential Manager entry. From that commit, the fallback for a token nobody has
ever observed was a destructive action, and the tokens it destroyed a
credential for included `NEW`, which `login_error.rs` shipped as its example of
a *locked* account.

`REJECT` is the near miss and is deliberately not in the forgetting row. Lich
glosses it "bad credentials", which is the pair — account name **or** password —
so a mistyped account name provokes it as readily as a stale secret. `PASSWORD`
is the only token that names the password alone.

`CHARACTER_NOT_FOUND` and `GENERATOR_NOT_AVAILABLE` are raised later in
`eaccess.rb` (`:226`, `:165`), after the `A` step, and never reach this
classifier: this module has its own `NoSuchCharacter` and never enters the
generator. They are in the table because a server could still send one at `A`,
and the row says what would happen if it did.

The empty string is a row of its own in practice: `response.split(/\s+/).last`
on a truncated reply yields `""`, and before #488 that deleted a stored
password too.

Every token above, plus the undocumented shapes #488's reviewer drove, is
`eaccess::test_support::REFUSAL_TOKENS`, and
`lich::tests::every_refusal_token_but_the_password_one_keeps_the_stored_password`
drives each one through the composed path — mock server, real handshake, real
classifier, real store — and asserts what happened to the secret. Not by
building a variant and asserting on it: that is how the `NEW` fixture came to
record a state the pipeline could not produce.

`lich::tests::every_refusal_token_reaches_the_sentence_written_for_its_cause`
(#507) drives the same population down the same path and asks the other
question: what the player is *told*. The token crosses the boundary as a field
on `LoginFailure` rather than inside the message, because reading a code back
out of prose is the parser #457 was about, one field along.

### 2.3 Password obscuring

`eaccess.rb:109-113`, verbatim:

```ruby
password = password.split('').map { |c| c.getbyte(0) }
hashkey = hashkey.split('').map { |c| c.getbyte(0) }
password.each_index { |i| password[i] = ((password[i] - 32) ^ hashkey[i]) + 32 }
password = password.map { |c| c.chr }.join
conn.puts "A\t#{account}\t#{password}\n"
```

Per byte `i`: `out[i] = ((pw[i] - 32) XOR key[i]) + 32`, on raw bytes, with the
result emitted as bytes. The hashkey is indexed positionally, so a password
longer than the hashkey would index past its end — Ruby yields `nil` there and
raises. The Rust port must reject that case explicitly rather than wrap or
truncate; see N1's sabotage.

### 2.4 The `C` response and the character code

`eaccess.rb:221-229`:

```ruby
def self.resolve_char_code(c_response, character)
  char_entry = c_response.sub(/^C\t[0-9]+\t[0-9]+\t[0-9]+\t[0-9]+[\t\n]/, '')
                         .scan(/[^\t]+\t[^\t\n]+/)
                         .find { |c| c.split("\t")[1] == character }

  raise AuthenticationError, "CHARACTER_NOT_FOUND" unless char_entry

  char_entry.split("\t")[0]
end
```

So the frame is `C\t<n1>\t<n2>\t<n3>\t<n4>\t<code1>\t<name1>\t<code2>\t<name2>…`:
four leading integers, then code/name pairs. The match on the name is
**case-sensitive `==`**. The code — not the name — is what goes into `L`. The
character generator uses the literal code `"0"` (`eaccess.rb:26`,
`NEW_CHARACTER_CODE = "0"`, used at `:153`).

This response is also the app's character picker, free of charge: the player
types an account and a password and gets a real list, with no name to guess.

### 2.5 The `L` reply

`eaccess.rb:169-174`:

```ruby
login_info = response.sub(/^L\tOK\t/, '')
                     .split("\t")
                     .map { |kv|
                       k, v = kv.split("=")
                       [k.downcase, v]
                     }.to_h
```

There is no whitelist. Lich downcases whatever keys arrive. In practice they
are `GAMEHOST`, `GAMEPORT`, `KEY`, `UPPORT`, `GAME`, `GAMECODE`,
`FULLGAMENAME`, `GAMEFILE`. `lib/common/authentication/launch_data.rb:18` turns
the hash straight back into `.sal` lines:

```ruby
launch_data = auth_data.map { |k, v| "#{k.upcase}=#{v}" }
```

### 2.6 Game codes

`lib/common/authentication/login_helpers.rb:88-97`:

```ruby
GAME_CODE_TO_NAME = {
  'GS3' => 'GemStone IV',   'GSX' => 'GemStone IV Platinum',
  'GSF' => 'GemStone IV Shattered', 'GST' => 'GemStone IV Test',
  'DR'  => 'DragonRealms',  'DRX' => 'DragonRealms Platinum',
  'DRF' => 'DragonRealms Fallen',  'DRT' => 'DragonRealms Test'
}.freeze
```

DragonRealms prime is **`DR`**. `VALID_GAME_CODES` (`login_helpers.rb:17`) is
`%w[GS3 GST GSF DR DRX DRT DRF]`. Lane N ships `DR` and accepts `DRX`, `DRF`,
`DRT` from the same picker.

---

## 3. The launch mechanism — why `.sal`, and not `entry.yaml`

Two routes reach a logged-in Lich. Both were read before choosing.

### 3.1 The chosen route: EAccess in the app, then a `.sal`

The app performs §2 itself, receives `GAMEHOST/GAMEPORT/KEY/…`, writes a
launch file, and starts:

```
lich.rbw <sal path> --headless=11024 --start-scripts=companion_bridge
```

Lich reads the file as **plain lines**, not as a parsed document
(`lib/main/main.rb:213`):

```ruby
@launch_data = File.open(@argv_options[:sal]) { |sal_file| sal_file.readlines }.collect { |line| line.chomp }
```

and every key is found with `Array#find` and a regex. Four are hard-required,
each with its own `exit(1)` (`main.rb:232-251`): `GAMECODE=`, `GAMEPORT=`,
`GAMEHOST=`, `GAME=`. `KEY=` becomes required as soon as `--without-frontend`
is present (`main.rb:307-322`), which `--headless` guarantees.

The minimum valid DragonRealms file is therefore:

```
GAME=STORM
GAMECODE=DR
GAMEFILE=STORMFRONT.EXE
GAMEHOST=dr.simutronics.net
GAMEPORT=11024
KEY=<the one-shot key from the L reply>
FULLGAMENAME=DragonRealms
UPPORT=5535
```

with `GAMEHOST`, `GAMEPORT`, `KEY` and the trailing values taken verbatim from
the `L` reply rather than typed here.

Under `--without-frontend` Lich sends the key to the game server itself and
never rewrites the file for a frontend (`main.rb:642-664`):

```ruby
Thread.new {
  Game._puts(game_key)
  game_key = nil
  client_string = Frontend::CLIENT_STRING
  ...
```

`Frontend::CLIENT_STRING` is `"/FE:WRAYTH /VERSION:1.0.1.28 /P:WIN_UNKNOWN /XML"`
(`lib/common/front-end.rb:352`).

Note what this route does **not** need: no `--dragonrealms`, no `--stormfront`,
no `--login`, no saved entry, no GTK window. `GAMECODE=DR` in the file picks
the game (`main.rb:225-231`). `--start-scripts` is read straight from ARGV
(`lib/games.rb:976-979`) and is unaffected by the `.sal` route.

Lane N does not reproduce Lich's PEM pinning. It uses ordinary system-root
certificate validation for `eaccess.play.net`, which is strictly stronger than
a trust-on-every-use pin that re-downloads itself on mismatch (§2.1), and needs
no pin file to ship, refresh or get wrong.

### 3.2 The route not taken: writing `entry.yaml` and using `--login`

Lich's saved-entry store is `data/entry.yaml`
(`lib/common/authentication/entry_store.rb:19-21`). `entry.dat` is legacy:
Marshal inside Base64, **not encrypted** (`lib/common/gui/state.rb:17-28`,
`:47-49`), read only for a one-time migration (`entry_store.rb:141-215`). The
entry shape is `launch_data.rb:65-76` — `char_name, game_code, game_name,
user_id, password, frontend, custom_launch, custom_launch_dir`.

Two things in its favour, and they are real: `frontend` is **not** required for
a `--login` match (`login_helpers.rb:211-274`; only `char_name` is
unconditional at `:220`), and `--without-frontend` explicitly unsets the
frontend filter (`login_helpers.rb:558-562`), so the "Lich only offers Wrayth,
Wizard, Avalon and Saga" problem is a GUI problem and not a CLI one.

It loses anyway, on four counts:

1. **It writes the password to disk by construction.** That is the single thing
   this design most wants to avoid, and the route requires it before anything
   else happens.
2. **The password's on-disk form is Lich's choice, not ours.** The mode is read
   out of the file — `encryption_mode = (entry_data[:encryption_mode] || 'plaintext').to_sym`
   (`cli.rb:291`) — with modes `:plaintext`, `:standard`, `:enhanced`
   (`entry_store.rb:224-231`), and the whole read path is gated on a master
   password being available first (`cli.rb:169-176`). That is a facility this
   app does not own and cannot promise to a player.
3. **It is a second implementation of Lich's store.** `tools/save-lich-entry.rb`
   already writes entries, and correctly — it loads Lich's own
   `EntryStore.save_entries` rather than hand-writing YAML (`:145`, `:190`). A
   Rust YAML writer beside it would be a fork of that, and would drift the day
   Lich's schema moves.
4. **It needs the character name up front.** The `.sal` route gets the list from
   the `C` response and can offer a picker.

Against that, the `.sal` route's whole Lich-side dependency is four
`Array#find` calls over `readlines` — the least likely surface in that tree to
change, because it is the twenty-year-old Simutronics launcher format and not
Lich's own invention.

**Decision: EAccess in the app, `.sal` on disk for the length of a launch,
`--headless=11024`.** `tools/save-lich-entry.rb` stays exactly as it is: it is a
developer tool for populating Lich's store by hand, it is not on this path, and
Lane N neither extends nor duplicates it.

### 3.3 The `.sal` file's lifetime

The file holds `KEY=`, a one-shot game key. It is not a credential — it cannot
be replayed after the game server consumes it and it expires on its own — but
it is written to disk, so:

- random 16-hex basename inside the app's own temp directory, never the repo,
  never Lich's `TEMP_DIR`;
- created with the file open only for this user;
- deleted by the app as soon as `game_attach` reports the 11024 socket
  established, and unconditionally on a timeout and at process exit;
- the deletion is the increment's `done-when`, checked by `stat`, not assumed
  (Lich shreds the file *it* rewrites at `main.rb:439/:487`; the one we hand it
  is ours to remove).

---

## 4. The game stream after the change

**Nothing about the socket or the parser changes.** The app connects to the same
`--detachable-client` port, receives the same Lich-processed XML, and parses it
with the same `src/lib/gameStream.ts`. `--headless` is what the app already
passes.

Two things about *Lich's* behaviour do change, because `$frontend` is no longer
`genie`, and both are improvements the Genie route explicitly cost the player:

- **Streams capability.** Genie is registered `capabilities: %i[xml mono]`
  (`lib/common/front-end.rb:251-252`) — no `streams`. That is why
  `LichLauncher.tsx:283` warns the channel tabs stay empty. Off the Genie
  route, `resolve_headless_frontend` returns `'profanity'` when a detachable
  port is present and neither `--genie` nor `--saga` is given
  (`login_helpers.rb:578-584`), while `Frontend.client` is set from the `GAME=`
  line — `/STORM/i` → `'stormfront'` (`main.rb:373-383`). Which of those two
  decides `supports_streams?` at runtime is **inferred, not read** (§7), and it
  is N4's job to measure it against a real session rather than assert it here.
- **The Lich command character.** `$clean_lich_char = Frontend.client.eql?('genie') ? ',' : ';'`
  (`main.rb:58`). The app already models both — `src/lib/frontends.ts`, guarded
  by `tools/frontend-test.mjs`, which today asserts `genie -> ,companion_bridge`.
  With Genie gone the `,` branch goes with it.
- **The state replay on attach.** `detachable_client_send_init`
  (`lib/global_defs.rb:2306-2343`) sends a synthetic snapshot — progress bars,
  spell, indicators, hands, wounds, compass — to a newly attached client, and is
  **suppressed for Genie and Saga only** (`global_defs.rb:2357-2361`). So the
  Lich-native route gains it. `tools/fake-lich.mjs` mirrors it (`INIT_TAGS` at
  `:274`, sent as one write at `:369-372`).

  Three corrections to the sentence above, all read out of Lich 5.20.1 on 7 Sep
  2026 while measuring PR #454's open hypothesis (issue #479). None of them
  changes the conclusion that this app receives the replay; all three change
  what may be built on it.

  **The suppression is not keyed on `$frontend`.** It is a raw ARGV match:

  ```ruby
  def handle_detachable_client(client)
    unless ARGV.any? { |argument| argument.match?(/^--(?:genie|saga)$/i) }
      Thread.new { detachable_client_send_init(client) }
    end
  ```

  `global_defs.rb:2357-2360`. `$frontend` appears nowhere in that block — the
  only two mentions of it in the whole file are commented out (`:1812`,
  `:1833`). There is no `profanity` branch anywhere; `profanity` is the
  *fallback return* of `resolve_headless_frontend` (`login_helpers.rb:578-584`)
  and nothing more. This app passes neither flag (`src-tauri/src/lich.rs`, whose
  `launch_args` test asserts the absence), so it lands in the `unless` body.
  The two conditions coincide; they are not the same condition, and a future
  change that set `$frontend` by another route would not move this branch.

  **It arrives about ten seconds late, every time, in DragonRealms.** The
  replay's first statement is
  `100.times { sleep 0.1; break if XMLData.indicator['IconJOINED'] }`
  (`global_defs.rb:2307`), on its own thread. `IconJOINED` is a **GemStone**
  indicator: every setter in Lich's tree is under `lib/gemstone/`
  (`group.rb:353,395,398`, `infomon/xmlparser.rb:9`), and the generic path only
  sets it if the game itself sends that id (`common/xmlparser.rb:789`).
  DragonRealms does not. So the `break` never fires, the loop runs its full
  course, and the dump lands ten seconds after the accept — behind ten seconds
  of live game text, rather than as the opening frames anybody would look at
  first. **This is the most likely reason #454's 22-second attach did not
  observe it.**

  **It is partial, and cannot be asked for.** It is assembled from `XMLData`,
  not a buffer of the bytes a client missed: four `<progressBar>` (with `value`
  hardcoded `'0'` — the numbers are only in `text`), `<spell>`, seven
  `<indicator>`, `<compass>`. The hands / wounds / `pbarStance` / `mindState` /
  `encumlevel` block is gated behind `XMLData.game.to_s.match?(/GS/)` and never
  arrives in DragonRealms. **Not** in it: room title, room description,
  `<component id='room objs'>` / `'room players'`, `<prompt>`, roundtime, the
  script list. And there is no request path: the detachable read loop
  understands `SET_FRONTEND_PID <n>` (honoured only from the registry's primary
  client) and an exit command, and treats every other line as player input
  (`global_defs.rb:2363-2379`); `detachable_client_send_init` has exactly one
  caller in the tree, and it is the accept. So a client cannot ask for a
  replay — it can only get a fresh one by reconnecting, which is a fresh
  accept. `src/lib/linkReplay.ts` synthesises the rest from the bridge's
  `status` on 7415 for exactly this reason.

- **A reconnect gets its own replay, and the port survives a client leaving.**
  The `Thread.new` above is per-accept, and `handle_detachable_client`'s
  `ensure` (`global_defs.rb:2390-2409`) closes and unregisters only that
  socket while the accept loop in `main.rb:842-906` blocks on `server.accept`
  again. Downstream text fans out to every attached client
  (`games.rb:1122-1130`), so several may be attached at once.

One behaviour worth stating because it is easy to trip over: when any detachable
client is attached, the primary frontend stops receiving the stream —
`games.rb:1125-1128` is an `elsif`, not a fan-out. With `--without-frontend`
there is no primary frontend, so this is moot; it is written down so nobody
"fixes" it later.

The frontend's return direction is one out-of-band verb, `SET_FRONTEND_PID <pid>`
honoured only from the primary client, and otherwise every line is prefixed with
`$cmd_prefix` and dispatched exactly as primary-frontend input, `;script`
commands included (`global_defs.rb:2363-2384`).

---

## 5. Credentials

This is the first first-party credential handling in the project, and it lands
against three written promises to the contrary:
`docs/PRIVACY.md:13-15`, `docs/ENGINE.md:33-37`, and
`src/components/shared/LichLauncher.tsx:304-307`. All three must change to what
is true. A promise quietly left standing while the code moves under it is the
exact defect `tools/doc-claims-test.mjs` exists to catch.

### 5.1 What is stored, and what is not

| Item | Stored | Where | Default |
|---|---|---|---|
| Account name | yes | ordinary app settings, plain | on |
| Character list and last character | yes | ordinary app settings, plain | on |
| Game code | yes | ordinary app settings, plain | on |
| **Password** | **no, unless the player ticks a box** | Windows Credential Manager only | **off** |
| The `L` reply's `KEY` | on disk only for the length of a launch | the temp `.sal`, §3.3 | n/a |

The password is never written to a config file, never logged, never returned to
the webview in any Tauri result, never put in a process argument (a command line
is world-readable on Windows), and never placed in the `.sal`. It enters the
Rust side as a `String` in one command invocation, is XOR-obscured for frame 2
of §2.2, and is overwritten in place on drop.

That last part is our own newtype with a manual `Drop`, not a crate. Adding
`zeroize` for it would be a dependency ask with no benefit the newtype does not
already give at this scale.

### 5.2 The optional store

If a player ticks "remember my password", it goes to **Windows Credential
Manager** through the `keyring` crate — MIT OR Apache-2.0. **Built, N8, merged
6 Sep 2026** on Dan's answer to the plan's §10 question N-b: *yes, opt-in,
default off*. The paragraph that stood here recorded the crate as absent and
the increment as `[!]` awaiting that yes; both are now the opposite, and a
stale claim of that shape is worse than none because a reader cannot tell it
from a current one. The check, rather than the claim:

```
$ grep -in "^keyring" src-tauri/Cargo.toml                      -> the dependency, cfg(windows)
$ grep -A1 '^name = "keyring"' src-tauri/Cargo.lock          -> version = "4.2.0"
$ grep -c "keyring" THIRD_PARTY.md                              -> 3 (crate, core, backend)
$ cargo test credential_store                                   -> 6 passed
```

What shipped, and the parts worth knowing before building on it:

- `src-tauri/src/credential_store.rs` is the module. `store`, `has`, `forget`,
  `load` and `unavailable_reason` all take the **service name as an argument**;
  only the three `#[tauri::command]` wrappers call `service_name()`. So a test
  names its own service and cannot reach a player's, which is a stronger
  guarantee than a test that promises to clean up after itself.
- **`load` is not a command.** It returns a `Secret`, and §5.1's `Secret`
  cannot be serialised, so a `#[tauri::command]` could not return one if
  somebody tried. That is the mechanism by which a stored password reaches the
  EAccess client and nothing else. N1's `lich_login_characters` and N3's
  `lich_login_launch` are its intended callers: when the webview passes no
  password and `has` is true, read one with `load` and use it once.
- The Credential Manager **target name** is `{account}.{service}`, service
  `dr-companion.play.net` — `windows-native-keyring-store`'s default divider is
  `.`. So `cmdkey /list | findstr dr-companion.play.net` is the manual check,
  and `the_entry_is_in_windows_credential_manager` is the automated one, which
  asserts 0 → 1 → 0 through `cmdkey` rather than through the code under test.
- The checkbox defaults to **off** (`REMEMBER_PASSWORD_DEFAULT` in
  `src/lib/rememberPassword.ts`), and the sentence beside it says who else can
  read the entry: *"Stored in Windows Credential Manager. Anyone signed in to
  this Windows account can use it."* Settings carries the Forget control.

**Not storing the password is still the shipped default and the rest of the
lane works without any of this** — it is a feature that is genuinely optional,
not a stub.

There is no third option. A password in a JSON settings file, obfuscated or
not, is a plaintext password with a decoding step, and this design does not
offer one.

### 5.3 The privacy document, and the trap in its generator

`tools/build-privacy-doc.mjs` derives `docs/PRIVACY.md` by scanning `src/` and
`src-tauri/src/` (`:41-79`) and cross-checking every host it finds against a
hand-written `DESTINATIONS` array (`:98-170`). Both directions are hard failures:
a scanned host missing from `DESTINATIONS` is `unclassified`, one in
`DESTINATIONS` that the scan does not find is `stale`, and either throws
(`:174-176`, `:275-280`).

The trap: the scanner's host pattern is

```js
const HOST = /https?:\/\/([a-zA-Z0-9.-]+)/g
const EXCLUDE = /test|127\.0\.0\.1|localhost/
```

A raw TLS socket to `eaccess.play.net:7910` has **no `https://` in it**, so a
`const EACCESS_HOST: &str = "eaccess.play.net"` is invisible to the scanner and
the generator throws `stale`. The wrong fix — writing a fake `https://` URL into
a comment so the regex catches it — makes the source lie to satisfy a test.

**The right fix, and N2 owns it:** teach the scanner a second pattern for a
declared non-HTTP endpoint, so a raw socket destination is scanned on the same
footing as a fetch. Note also that `EXCLUDE` matches the substring `test`
anywhere in the rendered `path:line:text`, so a line whose path or comment
contains "test", "latest" or "greatest" is dropped silently — N2's sabotage must
prove the new pattern actually fires rather than that the file merely changed.

The generated prose changes too, and it is not in `DESTINATIONS`: the "short
version" block asserting *"your Play.net credentials are never sent anywhere by
this app"* is inside the `md` template literal and becomes false the moment
frame 2 of §2.2 is sent. What replaces it is the truth, stated plainly: the
account name and password go to `eaccess.play.net:7910` over TLS, to Simutronics
and nowhere else, exactly as every other DragonRealms client sends them; the
password is not stored unless the player asks for it; and when it is, it is in
Windows Credential Manager and not in any file this app writes.

---

## 6. What Genie's departure removes, and what it must not

A repo-wide case-insensitive `git grep -ic genie` matches **146 files**. Lane N
does not delete 146 files, and saying so up front is the point of this section.

**In scope for Lane N (the connection path):**

- the Genie instruction text in `src/components/shared/WaitingForCharacter.tsx:138-160`
  and `src/components/shared/LichLauncher.tsx:263-285`;
- the "cannot sign in on this machine" panel — `LichLauncher.tsx:227-233` and
  the `note` field at `src-tauri/src/lich.rs:490-495`;
- the "this app never sees your password" claims at `LichLauncher.tsx:304-307`,
  `lich.rs:497`, `docs/PRIVACY.md:13-15`, `docs/ENGINE.md:33-37`;
- the `--genie` arguments wherever they are printed as instructions, including
  `src/components/first-run/ConnectGuide.tsx:124-126, :183-187`;
- the `genie` branch in `src/lib/frontends.ts` and its case in
  `tools/frontend-test.mjs`, and the `'genie'` member of the frontend union at
  `src/types/index.ts:40` plus `src/store/useAppStore.ts:37-38`;
- `genie_status` (`lich.rs:412-425`) and its registration (`lib.rs:153`) — done as a rename to `frontend_conflict_status`, not a deletion: two clients cannot both hold the detachable port, and that hazard outlives the client that named it;
- the Genie mentions in `lich-scripts/companion_bridge.lic`'s comments and in
  the connection docs `docs/BRIDGE_CONTRACT.md:8-10, :117-121` — the first of
  which ("It must not parse the game stream itself") is already false today.

**Deliberately NOT in scope, and each for a reason:**

- **`genie_pos` / `genie_id` / `genie_zone` in `src/bridge/types.ts:185-218`.**
  These are Lich map-node fields (`lib/common/map/map_dr.rb`) that happen to
  carry Genie's name. Deleting them deletes map coordinates.
- ~~**The whole Genie config-editor subsystem.**~~ **Struck 6 September 2026.**
  This entry said the editor's fate was a product decision rather than a
  connection one, filed for Dan in §10 of the plan, and that N6 would state in
  the UI that the importer is unrelated to signing in. Dan made the decision -
  "we aren't using genie anymore … you have to implement correctly using lich" -
  and N6 carried it out: `src/components/config/` (the sheet and seven
  editors), `src/lib/useGenieConfigEditor.ts`, `genieConfigEdit.ts`, the macros
  / presets / substitutes / gags / variables modules and hooks,
  `config_import.rs`'s `restore_genie_config`, `sounds.rs`'s `list_sounds` and
  six `test:` scripts are gone. The reasoning above was not wrong about the
  kind of question it was; it was answered.
  What is **still** out of scope, and is the read-only half: `read_genie_config`
  and the Genie install detection in `setup.rs`/`sounds.rs`, which is what lets
  a player bring their highlights and aliases across, plus `highlights.ts` /
  `aliases.ts` and their hooks, which the game pane reads and the editor never
  owned. The Genie *writer* survived N6 for one caller, `pinsFile.ts`'s pin export,
  and **Q5 deleted it** (6 Sep 2026) along with its wrapper module: plan
  question N-c is answered — the pin file is app data, in
  `app_data_dir()/config` through `src-tauri/src/player_files.rs`. So the app
  reads a Genie install and never writes into one, which
  `tools/doc-claims-test.mjs` asserts rather than this paragraph claiming.
- **`genie-plugin/`** — the C# NDJSON plugin on port 7416. Same decision, same
  place.

The rule this follows is `CLAUDE.md` §0: the new login **replaces** the
launcher's Genie route rather than sitting beside it. There is no
"legacy Genie sign-in" fallback, no feature flag, and no second launch path.

---

## 7. What was read, and what is inferred

Every rule in this repository about negative and positive results applies here,
so the two are separated rather than blended.

### Read from source, cited above, re-checkable by the cite

- The EAccess host, port, TLS mode and pin file (§2.1).
- The full message sequence and every literal in it (§2.2).
- The password-obscuring arithmetic (§2.3).
- The `C` frame layout and the name→code rule (§2.4).
- The `L` reply's parse and its round trip to `.sal` lines (§2.5).
- The game-code table and the valid set (§2.6).
- The `.sal` reader: `readlines`, the four required keys, the conditional `KEY`
  (§3.1).
- `--headless` expanding to `--without-frontend --detachable-client=` and
  refusing to combine with an explicit one (§1).
- `--without-frontend` sending the key and `Frontend::CLIENT_STRING` itself
  (§3.1).
- The detachable listener, the state replay, its Genie/Saga suppression, and the
  `elsif` that starves a primary frontend (§4).
- **The state replay's gate, its ten-second delay, its exact contents, and the
  absence of any way to request one.** Read 7 Sep 2026 against the installed
  Lich 5.20.1 (`lib/version.rb:3`) while settling PR #454's hypothesis
  (issue #479), and every cite in §4 re-checkable by opening the file:
  - the gate is `ARGV`, not `$frontend` (`global_defs.rb:2357-2360`), and there
    is no `profanity` branch anywhere;
  - the wait is `100.times { sleep 0.1; break if XMLData.indicator['IconJOINED'] }`
    (`:2307`), and every setter of `IconJOINED` is under `lib/gemstone/`;
  - the contents, with the `XMLData.game =~ /GS/` gate on hands, wounds,
    stance, mindstate and encumbrance (`:2306-2343`);
  - the two out-of-band verbs the detachable loop understands, and that
    `detachable_client_send_init` has one caller (`:2359`, `:2363-2379`);
  - the per-accept replay, the re-accept after a disconnect (`main.rb:842-906`,
    `global_defs.rb:2390-2409`), and the fan-out to every attached client
    (`games.rb:1122-1130`).

  Two negative results, recorded with the command that establishes them rather
  than as a claim: there is **no** `_` sentinel and **no** connect-time `<c>`
  hello on the detachable socket. `grep -rn "SET_FRONTEND_PID" lib/` in the
  Lich tree is the positive control for that search — it finds the one handler
  at `global_defs.rb:2364`, so the scope is right — and the same sweep for a
  bare-underscore comparison finds nothing. `<c>` is what Lich *prepends*
  (`:2376`), not what a client sends.
- Genie's registered capabilities and the three behavioural switches it flips
  (§4, §6).
- `entry.yaml` as the current store, `entry.dat` as unencrypted Marshal+Base64
  legacy, and the entry field list (§3.2).
- This app's current arg list, port constant, socket direction and parser (§1).
- The absence of any secret-storage crate, with the commands that returned
  nothing (§5.2).
- **`--headless=11024` really is normalised on the `.sal` path, and the launch
  file really is what Lich reads.** Not read out of `arg_normalization.rb` -
  measured against a real Lich 5.20.1 on 6 Sep 2026, with the sabotage that
  makes the measurement mean something:
  `docs/verification/lich-sal-launch-2026-09-06.md`. An eight-line hand-written
  `.sal` plus one `--headless=11024` started Lich with no `--login`, no
  `--dragonrealms`, no `--stormfront` and no saved entry, and
  `Get-NetTCPConnection` showed 11024 listening on Lich's own pid; the same
  file with `GAMECODE=` removed exited(1) printing `error: launch_data contains
  no GAMECODE info` and never opened the port.
- **The frontend identity on the `.sal` route is `'profanity'`, and
  `Frontend.supports_streams?` is `true`.** Not read out of `front-end.rb` -
  measured 6 Sep 2026 by executing Lich 5.20.1's own
  `resolve_headless_frontend` and `Frontend.has_capability?` against its own
  registry with this launch's exact argv, and re-run against `--saga`,
  `--genie` and no-detachable-port so the chooser was tested where the wrong
  answers were available: `docs/verification/lich-native-stream-2026-09-06.md`.
  The two candidates in the old question turned out not to be two: `$frontend`
  is what `supports_streams?` reads (`front-end.rb:374-376`), `Frontend.client`
  is an alias of that same global (`front-end.rb:407-415`), and the
  `GAME=`-derived assignment at `main.rb:375-376` is inside the `else` of
  `if ARGV.include?('--without-frontend')` (`main.rb:359`) and never runs. It
  would have said `true` as well, which is why this stayed open so long.
- **`--frontend=<name>` is parsed and never read.** `argv_options.rb:98-99`
  writes `@argv_options[:frontend]` and nothing consumes that key, so the flag
  §7 once offered as a remedy would have done nothing. `--wrayth` and
  `--profanity` do not exist at all.

### Inferred, and must be measured before anything is built on it

1. ~~**Which of `resolve_headless_frontend`'s `'profanity'` and the `GAME=`-derived
   `'stormfront'` decides `Frontend.supports_streams?` at runtime.**~~
   **Measured 6 Sep 2026 (N4).** Moved to the read column above.
2. ~~**Whether `--headless` normalisation runs on the `.sal` path.**~~
   **Measured 6 Sep 2026 (N3): yes.** Moved to the read column above.
3. **Whether the `L` reply's `GAMEPORT` for DR prime is 11024.** Lich's own
   flag-driven constants say `dr.simutronics.net:11024`
   (`argv_options.rb:373-383`), but on this path the value comes from the
   server, not from the constant, and the two are only expected to agree. The
   app must use what the server sends and never the constant. Not measured.
4. **Whether `eaccess.play.net:7910` still answers.** No credential has been
   sent from this machine in this lane. A TLS handshake probe against that
   host and port, with no login frames, is acceptable and is N1's optional
   sanity check; it is not a login and it is not required for N1 to be done.
5. **What the server returns for an account with zero DragonRealms characters,
   or for a wrong password.** Lich's code names the error strings it raises,
   not the bytes that provoke them. N1's mock covers the shapes Lich's own
   regexes accept and reject; the live shapes are N7's.
   **Narrowed 7 Sep 2026 (#488).** The *vocabulary* is no longer inferred:
   `authenticator.rb:20-23` writes six tokens down with a gloss each, and §2.2a
   records them with the command that re-reads them. What is still inferred is
   which of those six the live server sends at the `A` step, and whether it
   sends anything outside them — which is exactly why an unrecognised token now
   classifies as `AccountRefused` and keeps the stored password rather than
   guessing at `BadCredentials` and deleting it.

6. ~~**Whether the app receives the attach-time state replay at all.**~~
   **Read 7 Sep 2026 (issue #479): yes, and the reason #454 did not see it is
   that it arrives ten seconds late in DragonRealms.** Moved to the read
   column above. What is *still* not measured is the one thing only a live
   session can settle: whether a real DragonRealms Lich ever sets
   `IconJOINED` and so breaks that loop early. Every setter being under
   `lib/gemstone/` makes it very unlikely, and nothing is built on it either
   way — the app resets its parser and asks the bridge on every reconnect
   regardless of when Lich's own dump turns up.

7. **Whether twenty seconds is long enough for a real Lich to open its
   detachable port on a real machine.** The attach retry added for issue #458
   (`game_link::dial_with_retry`) is tested against a loopback listener that
   opens 1.5 seconds late, a stand-in that has exited without listening, and a
   port nothing ever opens - not against a real Lich, which this lane does not
   start. The *ordering* it depends on is read, not inferred: Lich reads
   `@launch_data` by `main.rb:213`/`:349` and does not open the detachable
   listener until `main.rb:842-857`, so the single dial in the tick after
   `spawn` could never have succeeded. Only the ceiling is a guess, and it is a
   cheap one in both directions: the wait ends the moment the port answers or
   the spawned process exits, so overshooting costs nobody anything, and
   undershooting shows as "Lich did not open 127.0.0.1:11024 within 20.0
   seconds" rather than as a wrong sentence about the sign-in.

Nothing in the inferred list is load-bearing for N1 or N2, which is why those
two can start in parallel today.

---

## 8. The interface Lane N publishes

Stated here so N3, N4 and N5 can be built against it without their sessions
talking to each other. Names follow the existing `<subsystem>_<verb>`
convention (`game_attach`, `lich_status`).

```rust
// src-tauri/src/eaccess.rs  — pure protocol, no I/O of its own
pub trait Transport: std::io::Read + std::io::Write {}
pub struct LaunchData(pub Vec<(String, String)>);   // keys UPPERCASED, order preserved
pub struct CharacterEntry { pub code: String, pub name: String }
pub struct Account { pub subscription: String, pub characters: Vec<CharacterEntry> }

pub fn list_characters<T: Transport>(t: &mut T, account: &str, password: &Secret, game_code: &str)
    -> Result<Account, EAccessError>;
pub fn login<T: Transport>(t: &mut T, account: &str, password: &Secret, game_code: &str, character: &str)
    -> Result<LaunchData, EAccessError>;
```

```rust
// src-tauri/src/sal.rs
pub fn write_temp(data: &LaunchData) -> Result<std::path::PathBuf, String>;
pub fn shred(path: &std::path::Path) -> Result<(), String>;
```

Tauri commands, with the JSON the webview sees:

| Command | Argument JSON | Result JSON |
|---|---|---|
| `lich_login_characters` | `{ account: string, password: string \| null, gameCode: string }` | `{ subscription: string, characters: [{ code: string, name: string }] }` |
| `lich_login_launch` | `{ account: string, password: string \| null, gameCode: string, character: string }` | `{ pid: number, port: number }` |
| `game_attach` | `{ host?: string, port: number, waitMs?: number \| null }` | `LinkState` |

**Both sign-in commands fail with an object, not a string.** That is the
contract `src/lib/lichLogin.ts` documented from the start and nothing
implemented until issue #457: `{ code, message }`, where `code` is one of
`src-tauri/src/login_error.rs`'s `LoginCode::ALL`. The webview matches on the
code and shows a player sentence; the message is detail printed under it. The
code set is generated into `src/lib/loginErrorFixtures.ts` by a Rust test and
asserted against the TypeScript declaration by `tools/sign-in-test.mjs`, so the
two cannot drift.

`password` is `null` when the player has one saved in Windows Credential
Manager for that account (issue #459). Rust loads it, uses it once, and forgets
the entry if the account server refuses it. `game_attach`'s `waitMs` is how long
to keep retrying the dial: omitted means one attempt, which is the Attach
button, and the sign-in passes twenty seconds because Lich provably has not
opened its port in the tick the launch returned (issue #458).

`password` appears in an argument and **never** in a result, an event, an error
message or a log line. `lich_login_launch` returns after Lich's process is
spawned and the `.sal` is gone; the webview then calls the existing
`game_attach` with the returned `port`. No new event channel is introduced.

Port and environment contract:

- `src-tauri/src/lich.rs:107` `DETACHABLE_PORT = 11024` stays the single source
  of the port. `lich_login_launch` returns it rather than the caller supplying
  it, which removes the five places the frontend currently retypes `11024`
  (`GameConnectionBar.tsx:34`, `WaitingForCharacter.tsx:148`,
  `LichLauncher.tsx:276`, `Dashboard.tsx:150`, `instances.ts:41`).
- `DRC_EACCESS_HOST` and `DRC_EACCESS_PORT` exist **only** so a test can aim the
  client at a mock, and default to `eaccess.play.net` / `7910`. They are the
  injection point that makes the unhappy paths reachable on purpose; a run
  given a deliberately wrong value must fail *naming that value*.
- `DRC_LICH_DRY_RUN=1` makes `lich_login_launch` write and shred the `.sal` and
  report the argv it would have used, without spawning Lich. Without it N3
  cannot be tested at all without a real account.
- **All three are development-only, and a release build does not read them**
  (issue #464). They were plain `std::env::var` reads with no gate, so a shipped
  app started with `DRC_EACCESS_HOST` set would have sent the account name and
  password somewhere other than Simutronics - an undocumented exception to the
  claim `docs/PRIVACY.md` makes, and a knob that decides whether a player is
  really playing. The gate is one function,
  `credentials::overrides_are_honoured()`, which is `cfg!(debug_assertions)`:
  `eaccess_endpoint` returns the declared constant before either variable is
  read when it is false, `lich::dry_run` is `false` outright, and
  `tools/build-privacy-doc.mjs --check` refuses to publish the privacy document
  if that stops being true.

---

## 9. What happens to Lich when the app closes

Issue #488 §3. The behaviour was already what the design wanted; what it did not
have was a sentence anywhere, or a check, and a Lich handle nobody owned is a
Lich handle a future tidy-up quietly changes.

**Nothing on the exit path ends a Lich by itself.** Not `RunEvent::Exit`, not a
dropped `Child`, not a crash, not a kill. A Lich this app started is a character
somebody is playing, and closing a companion window is not a request to log them
out. That is the same rule the code has always stated for a Lich it did *not*
start ("this app does not end a Lich it did not start ending", `lich.rs`), and
`--detachable-client` exists precisely so the two can come apart.

The contrast to keep in view is `viewer.rs`, which **is** killed on exit and
should stay that way: a world viewer with no app behind it is furniture connected
to nothing, and a Lich with no app behind it is a live game session. Do not make
the two consistent.

### The one place the player is asked

Closing the window raises `CloseRequested`. If - and only if - this app started
a Lich and that Lich is still running, Rust holds the window shut
(`api.prevent_close()`), emits `lich-close-prompt`, and the webview asks:

| answer | command | what happens |
|---|---|---|
| **Leave it running** (default) | `lich_release` | the handle is given up, the process is untouched, any pending `.sal` keeps its existing owners |
| **Stop Lich** | `lich_stop` | killed **by the handle**, never by image name, and the pending `.sal` is shredded with it |

Whichever is chosen, `close_main_window` finishes the close - `destroy`, not
`close`, so `CloseRequested` does not fire again and ask twice.

Every path that is *not* that prompt produces the "leave it running" outcome:
a crash, a taskkill, a webview that never answers, and an emit that fails (which
closes rather than trapping the player in a window that will not shut).

### And the next start offers to attach

A Lich left running is found on the next sign-in by the existing already-running
detection. That refusal used to arrive as `lich_did_not_start`, whose player
sentence is *"The sign-in worked but Lich did not start. Use 'Why won't it start?'
below to find out why."* - a diagnostic, for a Lich that is running perfectly
well. It has its own code now, `lich_already_running`, and the sign-in screen
offers an attach instead.

What it offers is not one button. That refusal comes from one `tasklist`
match on the image name `rubyw.exe`, so what it establishes is *a Ruby
process exists* - not whose, not which character, not whether it opened a
port. A single **Attach to the Lich that is running** on that evidence could
join another account's character with nothing on screen saying the character
had changed, and its "press it again in a moment" advice could never come
true for a Lich started without `--detachable-client` (issue #504).

So `lich_attach_offer` answers first, with one of five things, and the screen
has a sentence for each:

| answer | what it means | is there a button |
|---|---|---|
| `ours` | this app started it and still holds the handle | yes, on the recorded port |
| `foreign` | somebody else’s Lich is listening | yes, and it names the character |
| `no_port` | a Lich is running with nothing listening | no - pressing could never work |
| `no_lich` | nothing running, nothing listening | no - the refusal is stale |
| `unknown` | the question was not answered | no, and it says which half was missing |

The name comes from Lich, not from us. `Frontend.create_session_file`
(`lib/common/front-end.rb:435-443`) writes
`<tmp>/simutronics/sessions/<Name>.session` holding
`{"name":..,"host":..,"port":..}`, and the detachable listener calls it with
the character it was started for and the port it just bound
(`lib/main/main.rb:856-866`). A Lich started without `--login` writes no
descriptor, which is why `foreign` carries a nullable character and says "does
not say which character" rather than assuming the session is yours.

The listener is read out of `netstat -ano`, not by connecting: a connect would
register a detachable client on somebody's live session
(`global_defs.rb:2357`), which is a side effect on the thing being probed.

### How to check it rather than believe it

```
cd src-tauri && cargo test --lib lich::tests::stopping_lich
cd src-tauri && cargo test --lib lich::tests::leaving_lich
cd src-tauri && cargo test --lib lich::tests::somebody_elses_lich
cd src-tauri && cargo test --lib lich::tests::a_lich_with_no_detachable_port
cd src-tauri && cargo test --lib lich::tests::a_port_that_is_not_listening
npm run test:lich-lifetime
npm run test:sign-in
```

The two Rust cases drive a loopback stand-in (`ping -n 60 127.0.0.1`), assert it
is alive before doing anything, and then ask **tasklist** whether the pid is
still there - the outcome, not what `stop` said about itself. The Node suite
holds the webview half and the source properties, including that the exit
handler still names no Lich. Where this prose and those commands disagree, the
commands are right and this section is stale.

---

## 10. Where this document is wrong first

The parts most likely to rot, so the next reader knows where to look:

- **§2 is a snapshot of Lich 5.20.1.** If `lib/version.rb:3` reads higher,
  re-read `eaccess.rb` before trusting the sequence.
- **§7's inferred list is the honest boundary.** Items 1 and 2 are the two that
  decide whether the design works as written, and both are measured by an
  increment rather than argued here.
- **§9 is the one section with commands rather than claims.** If it and the
  tests disagree, edit the section. It was written that way on purpose
  (`CLAUDE.md` §19).
- **§6's "not in scope" list is a boundary, not a verdict.** If Dan answers the
  §10 question by retiring the Genie config editor, this section is stale the
  same day and should be rewritten rather than appended to.
