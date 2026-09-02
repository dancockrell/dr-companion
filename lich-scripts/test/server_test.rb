# Starts the real bridge and talks to it over a real socket.
#
#   ruby lich-scripts/test/server_test.rb lich-scripts/companion_bridge.lic
#
# The other suites slice one module out and test it in isolation. This one
# boots Companion::Server on a loopback port, performs an RFC 6455 handshake by
# hand, and exchanges real frames — because the WebSocket layer is written from
# scratch against the spec rather than pulled from a gem, and a bug in it makes
# the entire product a demo. Nothing above it can work if the handshake key is
# computed wrong or a length prefix is off by a byte.
#
# Lich is stubbed, not required. The point is the transport and the protocol:
# does it accept a browser's handshake, does it frame correctly in both
# directions, does it answer, and does it refuse what it should refuse.

require 'socket'
require 'json'
require 'digest/sha1'
require 'base64'
require 'timeout'
# The harness evaluates only the `module Companion` body, so the requires at the
# top of the script never run and anything they provide has to be supplied here.
#
# SecureRandom was missing, `generate_token` rescued to nil, and the token
# quietly did not exist - so the token tests skipped themselves and the run
# reported no failure. A harness gap that disables a security test looks
# exactly like a passing run.
require 'securerandom'

SRC = ARGV[0] or abort 'usage: server_test.rb <path to companion_bridge.lic>'

# ---------------------------------------------------------------- Lich stubs --
#
# Only what the script touches at load and while serving. Everything the bridge
# reads goes through State.safe, so absent globals are already handled; these
# exist so the status payload has something recognisable in it.

$respond_log = []
def respond(m) = $respond_log << m.to_s

LICH_VERSION = '5.20.1'

# A temporary directory, not the real Lich install.
#
# These pointed at C:/Ruby4Lich5/Lich5 - a real installed Lich on the machine
# running the tests - so every run wrote a live `companion_bridge.token` into
# the actual scripts folder, on top of whatever a running bridge had put there.
# It looked harmless because nothing ever failed. It was found when a peer
# session deleted an orphaned token, saw a fresh one appear minutes later with
# no bridge running and no ruby process, and reported it rather than deleting
# it again.
#
# Two problems, and the second is the one that bites. A test that mutates the
# machine's real install can break the thing it is testing. And a token file
# with no bridge behind it is exactly the stale-token state the bridge's own
# `clear_stale_token!` cannot cover - that fires when a write fails, not when
# a test wrote one on the bridge's behalf.
#
# Nothing here needs the real install: the path only has to exist and be
# writable so `token_path` resolves somewhere.
require 'tmpdir'
require 'fileutils'

TEST_LICH_DIR = File.join(Dir.tmpdir, "drc-bridge-test-#{Process.pid}")
FileUtils.mkdir_p(File.join(TEST_LICH_DIR, 'scripts'))
at_exit { FileUtils.rm_rf(TEST_LICH_DIR) }

# Script.running had no stub at all - undefined, so State.safe([]) {
# Script.running } silently returned [] in every test that has ever run,
# including every stop_all/pause/resume check tonight. That happened to be
# the right answer for "is anything running" (nothing was), but it also
# meant pause_all/resume_all's actual loop - find a running unpaused
# script, call Script.pause on it, report it - has never executed a single
# iteration in this suite. $fake_running_scripts stays empty by default so
# every existing test keeps seeing "nothing was running"; only the pause
# test below populates it, on purpose, to prove the loop body runs.
FakeRunningScript = Struct.new(:name, :paused) do
  def paused? = paused
end
$fake_running_scripts = []

# install_mapdb needs both: which scripts Lich would say exist, and whether
# XMLData.game reads as Prime. Neither had a stub - Script.exists? was
# undefined (always false via State.safe), and XMLData was undefined
# entirely, so State.instance (safe('') { XMLData.game.to_s }) always read
# 'Unknown'. That combination happened to make install_mapdb's old logic
# (try download-prime-map first, unconditionally) untestable in either
# direction: with exists? always false it always fell through to "neither
# is installed" regardless of which instance-detection bug was or wasn't
# present.
$fake_scripts_installed = []
$fake_exists_calls = []
$xmldata_game = ''
module XMLData
  def self.game = $xmldata_game
end

class FakeScript
  def self.current = new
  def path = File.join(TEST_LICH_DIR, 'scripts', 'companion_bridge.lic')
  # list_scripts excludes the running bridge by Script.current.name - had no
  # stub at all, so that exclusion was untestable (State.safe(nil) always
  # won, so it excluded a script named literally nil, which is to say
  # nothing).
  def name = 'companion_bridge'
  def self.at_exit(&_blk) = nil
  def self.running = $fake_running_scripts

  def self.pause(name)
    s = $fake_running_scripts.find { |x| x.name == name }
    s.paused = true if s
  end

  def self.unpause(name)
    s = $fake_running_scripts.find { |x| x.name == name }
    s.paused = false if s
  end

  # Tracked separately from the return value so a test can prove the regex
  # guard short-circuited *before* this was ever reached, not just that the
  # final answer was "refused" - the two failure paths are meant to be
  # different guards, and only a call log can tell them apart from outside.
  def self.exists?(name)
    $fake_exists_calls << name
    $fake_scripts_installed.include?(name)
  end

  def self.start(*args)
    name = args.first.is_a?(Hash) ? args.first[:name] : args.first
    $fake_started << [name, args[1..]]
    true
  end
end
Script = FakeScript
$fake_started = []

$lich_dir = "#{TEST_LICH_DIR}/"

# list_scripts references the bare SCRIPT_DIR constant directly, wrapped in
# State.safe(...) - so with SCRIPT_DIR entirely undefined, the NameError was
# swallowed and the catalog silently came back [] in every run there has
# ever been. A real Lich sets this from $lich_dir + 'scripts'; matching that
# here rather than reusing $lich_dir by coincidence.
SCRIPT_DIR = File.join(TEST_LICH_DIR, 'scripts')

# For the concurrency tests below: run_macro/stow_all reach Cmd.exec, which
# calls fput directly (no `expect:` given, so dothistimeout is never reached).
# A real sleep, not a mock that returns instantly, is the point - proving
# pre-emption needs a command that is still "in flight" long enough to race a
# Stop against, the same way a real DragonRealms roundtime would be.
$fput_log = []
$fput_delay = 0
def fput(cmd)
  $fput_log << cmd
  sleep($fput_delay) if $fput_delay.positive?
  true
end

# Cmd.exec only calls fput when no `expect:` is given (empty patterns, see
# companion_bridge.lic's Cmd.exec). Any command sent WITH an expect pattern —
# escape's 'flee', check_health's 'health', stow_all's 'stow <item>' — goes
# through dothistimeout instead, which had no stub at all until now. Every
# such command was invisible to this entire suite: a check asserting one of
# them never happened, or always happened, could not have failed either way.
# Returns nil (no match, like a timeout) rather than echoing the pattern back,
# so a test that wants a specific reply has to say so and cannot mistake "we
# stubbed it" for "the game responded".
$dothis_log = []
# nil by default so every existing call site keeps behaving exactly as it did
# before this was made controllable - a test that wants a real-looking reply
# has to set this itself, on purpose, and reset it after.
$dothis_reply = nil
def dothistimeout(cmd, _timeout, _regex)
  $dothis_log << cmd
  $dothis_reply
end

# DRCH.check_health had no stub at all - undefined, not merely returning
# nil - so check_health's primary path always raised, was swallowed by its
# own `rescue StandardError; nil; end`, and every call fell through to the
# Cmd.exec fallback above. `:raise` is the default because that is what
# "undefined" actually behaves like; a test that wants the primary path has
# to hand this a real-shaped Hash on purpose.
$drch_reply = :raise
module DRCH
  def self.check_health
    raise 'DRCH unavailable' if $drch_reply == :raise

    $drch_reply
  end
end

# A wound/bleeder entry only needs to answer .body_part - check_health calls
# nothing else on it. A Struct rather than a Hash, because the real objects
# are not Hashes either and a Hash would let a `w['body_part']` typo in the
# bridge pass silently.
DRCHWound = Struct.new(:body_part)

# What DRCH.check_health actually returns on success -
# lib/dragonrealms/commons/common-healing.rb:405's HealthResult, attr_reader
# only, no Hash ancestor and no `[]`. A Struct rather than a Hash for the
# same reason as DRCHWound above, and it matters more here: a Hash-shaped
# stub let a real bug (`data.is_a?(Hash)` false against the true return
# type, `data['wounds']` undefined on it even if the gate somehow passed)
# sit uncaught behind a green "DRCH available" test. This is the fixture
# fix that goes with that bridge fix, not a separate cleanup.
FakeHealthResult = Struct.new(:wounds, :bleeders, :poisoned, :diseased)

# A wound that actually answers .severity/.scar?/.bleeding_rate, for testing
# record_health's bucketing/scar/bleeding-rate logic - DRCHWound above is
# deliberately minimal (only .body_part) so the count-only tests keep
# exercising the "wound fields can be absent" defensive path. This one is
# for the tests that need the fields to mean something.
DRCHWoundFull = Struct.new(:body_part, :severity, :scar, :bleeding_rate) do
  def scar? = scar
end

# Lich::DragonRealms::Creature had no stub at all before this - the bridge's
# combatants() guards on `defined?(Lich::DragonRealms::Creature)`, so leaving
# it fully undefined (the honest default - most Lich builds/test runs never
# load it) exercises the "module absent" path, and $creature_room lets a test
# populate it on demand for the "module present" path.
FakeCreature = Struct.new(:id, :name, :noun, :range, :relation, :target, :target_number,
                           :balance, :off_balance, :conditions, :flags, :enriched_since) do
  def crtr_flag?(key) = flags.include?(key.to_s) || flags.include?(key.to_sym)
  def flag_active?(key) = crtr_flag?(key)
  def off_balance? = off_balance
  def enriched? = !enriched_since.nil?
  def enriched_at = enriched_since
end

$creature_room = []
module Lich
  module DragonRealms
    module Creature
      def self.in_room = $creature_room
    end
  end
end

# GameObj had no stub at all - not even one that returns nil, undefined
# entirely. It appears 12 times in companion_bridge.lic, almost all of them
# in the status/inventory payloads (roomItems, hands, worn, wornCount,
# looseCount), every one wrapped in `safe(...)`. With GameObj undefined,
# every call raises, safe swallows it, and every field has returned its
# empty default ([], nil, 0) in every test run that has ever existed - the
# suite has never once observed a populated inventory.
#
# $gameobj_raise, separate from the values below, exists to answer a
# specific question: can the payload tell "GameObj is broken" apart from
# "there is genuinely nothing here"? Both currently produce the identical
# empty shape through the same `safe` default, so the state below has to be
# able to simulate each on purpose rather than the test guessing.
GameObjItem = Struct.new(:id, :name, :noun) do
  def noun = self[:noun] || name
end
$gameobj_raise = false
$gameobj_loot = []
$gameobj_left_hand = nil
$gameobj_right_hand = nil
$gameobj_inv = []
module GameObj
  def self.loot
    raise 'GameObj unavailable' if $gameobj_raise

    $gameobj_loot
  end

  def self.left_hand
    raise 'GameObj unavailable' if $gameobj_raise

    $gameobj_left_hand
  end

  def self.right_hand
    raise 'GameObj unavailable' if $gameobj_raise

    $gameobj_right_hand
  end

  def self.inv
    raise 'GameObj unavailable' if $gameobj_raise

    $gameobj_inv
  end
end

# read_settings needs a character name to glob <name>-*.yaml files. DRStats
# had no stub at all before this, so State.char_name (State.safe('') {
# DRStats.name.to_s }) silently returned '' in every run - which happened to
# still exercise base.yaml, but never the per-character file, and never
# proved the bridge was asking for *this* character's files rather than
# getting lucky on an empty name matching nothing.
module DRStats
  def self.name = 'Testchar'
end

# Real files on disk, not a stubbed Yaml.profile_dirs override - read_settings
# is being tested through the socket as an intent, and Yaml.files_for's own
# logic (load order, base.yaml first) is already covered directly in
# yaml_test.rb. What's untested is the wiring: does the intent actually reach
# Yaml.files_for with this character's name and report what it finds.
PROFILE_DIR = File.join(TEST_LICH_DIR, 'scripts', 'dr-scripts', 'profiles')
FileUtils.mkdir_p(PROFILE_DIR)
File.write(File.join(PROFILE_DIR, 'base.yaml'), "throttle: true\n")
File.write(File.join(PROFILE_DIR, 'Testchar-setup.yaml'), "guild: bard\n")

# A one-room world, StubRoom/StubMap mirroring Lich::Common::Map's interface
# (id vs uid, title as an array, wayto, tags, path_to,
# find_nearest_by_tag) exactly as map_test.rb's stub does, for the same
# reason: MapInfo.klass resolves the real class by name and the bridge
# script has to be tricked the same way in both suites, not tested against a
# different double in each.
class StubRoom
  attr_reader :id, :uid, :title, :location, :climate, :terrain, :tags, :wayto,
              :genie_zone, :genie_pos

  def initialize(id, uid, title, location, tags, wayto)
    @id = id
    @uid = [uid]
    @title = ["[#{title}]"]
    @location = location
    @climate = 'temperate'
    @terrain = 'stone'
    @tags = tags
    @wayto = wayto
    @genie_zone = '1'
    @genie_pos = { 'x' => id * 10, 'y' => 0, 'z' => 0 }
  end

  def path_to(dest) = StubMap.route(@id, dest.to_i)
  def find_nearest_by_tag(tag) = StubMap.list.compact.find { |r| r.tags.include?(tag) }&.id
end

module StubMap
  ROUTES = { [1, 2] => [2] }.freeze

  def self.list
    @list ||= begin
      rooms = [
        StubRoom.new(1, 9001, 'Town Square', 'Crossing', [], { 2 => 'east' }),
        StubRoom.new(2, 9002, 'Bank Lobby', 'Crossing', ['bank'], { 1 => 'west' })
      ]
      arr = [nil]
      rooms.each { |r| arr[r.id] = r }
      arr
    end
  end

  def self.route(from, to) = ROUTES[[from, to]]
  def self.current = list[1]
  def self.tags = %w[bank]
end

# Load everything except the trailing command-line section, which would start a
# server on the default port and then sleep forever.
src = File.read(SRC, encoding: 'UTF-8')
body = src[/module Companion.*?\n^end\b/m] or abort 'could not find the Companion module'
eval(body, TOPLEVEL_BINDING, SRC)

# MapInfo resolves Lich's class at call time (State.safe(nil) {
# Lich::Common::Map } || State.safe(nil) { Map }), which is what lets it be
# swapped here rather than needing a real constant defined - same technique
# map_test.rb uses against the same module. $map_klass toggles between the
# stub and nil so a single test file can exercise both "map loaded" and
# "no map" without redefining anything mid-run.
$map_klass = StubMap
Companion::MapInfo.define_singleton_method(:klass) { $map_klass }

# ------------------------------------------------------------------ harness --

$fails = 0

def check(label, ok, detail = '')
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}#{detail.to_s.empty? ? '' : ": #{detail}"}"
  $fails += 1 unless ok
  ok
end

# Reads `count` messages into an array and lets the caller pick out what it
# needs by type, rather than calling read_until once per type in sequence.
# read_until discards everything that doesn't match while it searches, so
# asking for 'intent_ack' before a broadcast that was sent first (map_here's
# own payload push happens inside dispatch, before handle_message gets to
# send the ack) silently eats the broadcast the very first call, and the
# second read_until then hangs forever waiting for a message that already
# came and went. Collecting first and filtering after is order-independent.
def collect(client, count, timeout: 3)
  Array.new(count) do
    begin
      client.read_json(timeout: timeout)
    rescue StandardError
      nil
    end
  end.compact
end

# A minimal client. Masks its frames, because the spec requires clients to and
# a server that accepts unmasked client frames is broken in a way no browser
# would ever reveal.
class Client
  attr_reader :accept_header

  # `authenticate:` false leaves the token unsent, so the refusal paths can be
  # tested. Sending no Origin at all is on purpose: that is what a non-browser
  # client does, and the point of the origin check is that it does not break
  # them.
  def initialize(port, path = Companion::PATH, authenticate: true)
    @sock = TCPSocket.new('127.0.0.1', port)
    @key  = Base64.strict_encode64(Array.new(16) { rand(256) }.pack('C*'))
    @sock.write(
      "GET #{path} HTTP/1.1\r\n" \
      "Host: 127.0.0.1:#{port}\r\n" \
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" \
      "Sec-WebSocket-Key: #{@key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    @buf = +''
    @buf << @sock.readpartial(4096) until @buf.include?("\r\n\r\n")
    @head, rest = @buf.split("\r\n\r\n", 2)
    @rest = rest.to_s.dup
    @accept_header = @head[/Sec-WebSocket-Accept:\s*(\S+)/i, 1]

    send_json(type: 'auth', token: Companion.auth_token) if authenticate && @head.include?('101')
  end

  # Whether the server has hung up. Used to assert that a client which never
  # authenticates gets dropped rather than tolerated indefinitely.
  def dead?
    return true if @sock.closed?

    ready = IO.select([@sock], nil, nil, 0.2)
    return false unless ready

    @sock.read_nonblock(1).nil?
  rescue EOFError, IOError, Errno::ECONNRESET
    true
  rescue IO::WaitReadable
    false
  end

  def closed? = @sock.closed?

  def status_line = @head.lines.first.to_s.strip

  def expected_accept
    Digest::SHA1.base64digest(@key + Companion::WS_GUID)
  end

  def send_json(hash)
    payload = JSON.generate(hash)
    mask = Array.new(4) { rand(256) }
    masked = payload.bytes.each_with_index.map { |b, i| b ^ mask[i % 4] }
    header = [0x81].pack('C')
    len = masked.length
    header += if len < 126
                [len | 0x80].pack('C')
              elsif len < 65_536
                [126 | 0x80, len].pack('Cn')
              else
                [127 | 0x80, len].pack('CQ>')
              end
    @sock.write(header + mask.pack('C*') + masked.pack('C*'))
  end

  # Server frames are never masked, so this only handles that direction.
  def read_frame(timeout: 5)
    Timeout.timeout(timeout) do
      b0 = byte
      b1 = byte
      opcode = b0 & 0x0f
      len = b1 & 0x7f
      len = bytes(2).unpack1('n') if len == 126
      len = bytes(8).unpack1('Q>') if len == 127
      raise 'server masked a frame' if (b1 & 0x80) != 0

      [opcode, bytes(len)]
    end
  end

  def read_json(timeout: 5)
    _op, payload = read_frame(timeout: timeout)
    JSON.parse(payload)
  end

  # Read until a message of this type turns up, so an extra push in between
  # does not make the test flap.
  def read_until(type, tries: 12)
    tries.times do
      msg = read_json
      return msg if msg['type'] == type
    end
    nil
  end

  def close = (@sock.close rescue nil)

  private

  def byte = bytes(1).unpack1('C')

  def bytes(n)
    return +'' if n.zero?

    out = @rest.slice!(0, n) || +''
    out << @sock.readpartial(n - out.bytesize) while out.bytesize < n
    out
  end
end

# --------------------------------------------------------------------- run --

# A high port, so a real bridge on 7415 does not collide with the test.
#
# Overridable because several sessions run this suite on one machine at once,
# and a fixed port means the second to start silently loses. Three runs were
# lost to that in one evening before anyone read netstat: the abort below said
# only 'server would not start', which reads as a broken bridge and sent two
# sessions hunting a bug in working code.
PORT = Integer(ENV.fetch('DRC_TEST_PORT', '7893'))
server = Companion::Server.new(PORT)
unless server.start
  # Which of the two it is. A taken port and a bridge that cannot boot have
  # identical symptoms and only one is about the code under test. Three
  # states, not two - an indeterminate result gets said out loud rather than
  # folded into either answer.
  in_use = begin
    TCPServer.new('127.0.0.1', PORT).close
    false
  rescue Errno::EADDRINUSE
    true
  rescue StandardError
    nil
  end
  reason = case in_use
           when true  then "port #{PORT} is already in use - another session is probably running this suite. Set DRC_TEST_PORT to a free port."
           when false then "port #{PORT} is free, so the bridge itself failed to start."
           else            "could not tell whether port #{PORT} is free."
           end
  abort "server would not start: #{reason}"
end

begin
  puts '-- the handshake a browser actually performs --'
  c = Client.new(PORT)
  check('101 Switching Protocols', c.status_line.include?('101'), c.status_line)
  check(
    'Sec-WebSocket-Accept is the SHA-1 of key + GUID',
    c.accept_header == c.expected_accept,
    "got #{c.accept_header.inspect}"
  )

  puts ''
  puts '-- what a client is told the moment it connects --'
  hello = c.read_json
  check('hello first', hello['type'] == 'hello', hello['type'].inspect)
  check('carries the protocol number', hello['protocol'] == Companion::PROTOCOL)
  check(
    'carries the bridge version, so the app can compare',
    hello['bridgeVersion'] == Companion::BRIDGE_VERSION,
    hello['bridgeVersion'].inspect
  )
  check('reports the Lich version', hello['lichVersion'] == '5.20.1',
        hello['lichVersion'].inspect)

  status = c.read_until('status')
  check('status follows, unprompted', !status.nil?)
  check('status has a payload', status && status['payload'].is_a?(Hash))

  puts ''
  puts '-- a request gets an answer --'
  c.send_json(type: 'get_status')
  check('get_status answered', !c.read_until('status').nil?)

  puts ''
  puts '-- an unknown intent is refused, not silently dropped --'
  c.send_json(type: 'intent', intent: 'not_a_real_intent')
  ack = c.read_until('intent_ack')
  check('acked', !ack.nil?)
  check('ok:false', ack && ack['ok'] == false, ack.inspect[0, 80])
  check('and says why', ack && !ack['detail'].to_s.empty?, ack && ack['detail'])

  puts ''
  puts '-- malformed input does not take the bridge down --'
  # Raw text that is not JSON, sent as a proper frame.
  bad = Client.new(PORT)
  bad.read_until('status')
  bad_sock = bad.instance_variable_get(:@sock)
  payload = 'this is not json'
  mask = Array.new(4) { rand(256) }
  masked = payload.bytes.each_with_index.map { |b, i| b ^ mask[i % 4] }
  bad_sock.write([0x81, masked.length | 0x80].pack('CC') + mask.pack('C*') + masked.pack('C*'))
  err = bad.read_until('error')
  check('answered with an error', !err.nil?, err && err['message'])
  check('server still running', server.running?)
  bad.close

  puts ''
  puts '-- a foreign origin is refused, which is the whole browser attack --'
  # The same-origin policy does not restrict WebSockets. Any page on any origin
  # can open ws://127.0.0.1:7415/companion with no preflight and no CORS block,
  # so refusing a foreign origin is the server's job and nothing else's.
  #
  # Until 0.9.0 this passed. The handshake wanted a path and a key, which is
  # exactly what a browser sends, and reaching `intent` from there gets
  # `stop_all` - ungated by design, correct for a Stop button, and
  # unconditional for an attacker too.
  # Generated rather than pasted. The RFC's own sample nonce is a base64 blob
  # with enough entropy that the secret scanner flags it as a leaked key, and
  # teaching anyone to reach for --no-verify is a worse habit than the
  # inconvenience it saves.
  #
  # Bound to a name first: a comment cannot live inside a backslash
  # continuation, and putting one there is a syntax error that reads as a
  # perfectly ordinary line.
  evil_key = Base64.strict_encode64(Array.new(16) { rand(256) }.pack('C*'))

  evil = TCPSocket.new('127.0.0.1', PORT)
  evil.write("GET #{Companion::PATH} HTTP/1.1\r\nHost: 127.0.0.1:#{PORT}\r\n" \
             "Upgrade: websocket\r\nConnection: Upgrade\r\n" \
             "Origin: https://evil.example\r\n" \
             "Sec-WebSocket-Key: #{evil_key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
  evil_head = +''
  begin
    Timeout.timeout(5) { evil_head << evil.readpartial(1024) until evil_head.include?("\r\n\r\n") }
  rescue Timeout::Error, EOFError
    nil
  end
  check('403 for a foreign origin', evil_head.include?('403'), evil_head.lines.first.to_s.strip)
  check('and definitely not 101', !evil_head.include?('101'), evil_head.lines.first.to_s.strip)
  evil.close

  puts ''
  puts '-- an absent origin is allowed, because that is what a non-browser sends --'
  # Deliberate. The test suite, a CLI client and anything written later send no
  # Origin at all, and refusing them costs real usefulness while stopping
  # nothing: a hostile local process can simply omit the header. That attacker
  # is the token's job, not this check's.
  check('the ordinary client still connected', c.status_line.include?('101'), c.status_line)

  puts ''
  puts '-- the token is required, and one guess is all anyone gets --'
  # Asserted rather than skipped. A SKIP here is indistinguishable from a pass,
  # and it guards the half of the boundary that stops a local process - exactly
  # the thing nobody would notice was missing.
  check('a token was generated at startup', !Companion.auth_token.to_s.empty?,
        $respond_log.grep(/token/).join('; '))

  if Companion.auth_token.to_s.empty?
    puts 'SKIP no token, so the rest of this section cannot run'
  else
    bad_token = Client.new(PORT, authenticate: false)
    bad_token.send_json(type: 'auth', token: 'not-the-token')
    # Collect everything this socket is sent, not just the first message that
    # happens to be type 'error'. read_until('error') would silently discard
    # a leaked 'status' push while searching past it for the error - so the
    # check below, which used to read straight off read_until's result,
    # could never see a leak even when one happened. It was structurally
    # unable to fail.
    seen = []
    3.times do
      msg = begin
        bad_token.read_json(timeout: 2)
      rescue StandardError
        nil
      end
      break if msg.nil?
      seen << msg
    end
    refused = seen.find { |m| m['type'] == 'error' }
    check('a wrong token is told so', !refused.nil? || bad_token.closed?,
          refused && refused['message'])
    # The important half: it never joined the client list, so it never
    # received a status broadcast. An attacker who fails must learn nothing
    # on the way - checked against everything this socket was sent, not
    # against whichever one message read_until happened to hand back.
    check(
      'and never received a status push, among everything it was sent',
      seen.none? { |m| m['type'] == 'status' },
      seen.map { |m| m['type'] }.inspect
    )
    bad_token.close

    silent = Client.new(PORT, authenticate: false)
    sleep 1.4 # past TOKEN_GRACE_SECONDS
    check('a client that never authenticates is dropped', silent.dead?)
    silent.close
  end

  puts ''
  puts '-- the hello frame says which gates are actually up --'
  # A red-team pass named this: if the token cannot be written, the bridge
  # silently drops from two gates to one and nothing in the system can see it.
  # The notice went to Lich's log, which the app never reads.
  fresh = Client.new(PORT)
  hello2 = fresh.read_until('hello')
  check('hello carries the auth mode', !hello2.nil? && !hello2['auth'].to_s.empty?,
        hello2 && hello2['auth'])
  check('and it says token, because one was written', hello2 && hello2['auth'] == 'token',
        hello2 && hello2['auth'])
  check('with no note, because nothing went wrong', hello2 && hello2['authNote'].to_s.empty?,
        hello2 && hello2['authNote'])
  fresh.close

  puts ''
  puts '-- a failed write is announced, and takes the stale token with it --'
  # The nastiest state of the three: the write fails, an old token is still on
  # disk, the client reads it, it passes every shape check, it is sent, and
  # `authenticate` returns true at line two without comparing it to anything.
  # That looks MORE normal than a missing file, because a token was presented.
  begin
    token_file = Companion.token_path
    File.write(token_file, 'a' * 64) unless File.exist?(token_file)

    # Force the write to fail the way a lock or a read-only file would, by
    # making generate_token unavailable. Same branch, no filesystem games.
    Companion.singleton_class.send(:alias_method, :real_generate_token, :generate_token)
    Companion.singleton_class.send(:define_method, :generate_token) { nil }
    Companion.write_token!

    check('the mode drops to origin-only', Companion.auth_mode == 'origin-only',
          Companion.auth_mode)
    check('and says why', !Companion.auth_note.to_s.empty?, Companion.auth_note)
    check('the stale token file is gone', !File.exist?(token_file), token_file)
  ensure
    Companion.singleton_class.send(:alias_method, :generate_token, :real_generate_token)
    Companion.write_token!
    check('and a real token is back for the rest of the run',
          Companion.auth_mode == 'token', Companion.auth_mode)
  end

  puts ''
  puts '-- the wrong path is refused, so a stray browser tab cannot attach --'
  wrong = TCPSocket.new('127.0.0.1', PORT)
  wrong.write("GET /nope HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n" \
              "Connection: Upgrade\r\nSec-WebSocket-Key: abc\r\n\r\n")
  head = +''
  begin
    Timeout.timeout(5) { head << wrong.readpartial(1024) until head.include?("\r\n\r\n") }
  rescue Timeout::Error, EOFError
    nil
  end
  check('404 for an unknown path', head.include?('404'), head.lines.first.to_s.strip)
  wrong.close

  puts ''
  puts '-- stop is not gated on anything --'
  c.send_json(type: 'intent', intent: 'stop_all')
  stop_ack = c.read_until('intent_ack')
  check('stop_all acked', !stop_ack.nil?)
  check('and accepted', stop_ack && stop_ack['ok'] == true, stop_ack.inspect[0, 80])

  puts ''
  puts '-- it binds loopback only --'
  external = Socket.ip_address_list.find { |a| a.ipv4? && !a.ipv4_loopback? }
  if external
    reachable = begin
      Timeout.timeout(2) { TCPSocket.new(external.ip_address, PORT).close }
      true
    rescue StandardError
      false
    end
    check("not reachable on #{external.ip_address}", !reachable)
  else
    puts 'SKIP no non-loopback address on this machine'
  end

  # A latched Stop now survives past the intent that set it (that's the whole
  # point, see the persistence test below), including the 'stop is not gated
  # on anything' stop_all a few lines up. Clear it before each test that
  # needs a fresh, unstopped bridge to actually exercise command-sending -
  # this is exercising the real resume path, not working around the latch.
  c.send_json(type: 'intent', intent: 'resume')
  c.read_until('intent_ack')

  puts ''
  puts '-- stop pre-empts a running macro instead of queuing behind it --'
  # Before per-message threading, handle_message ran inline in serve()'s read
  # loop: a stop_all sent while run_macro was mid-flight sat unread in the OS
  # receive buffer until the blocking macro call returned, so a flag "set on
  # arrival" could never arrive early enough to matter. This proves the fix
  # rather than asserting it - a real elapsed delay per command, a Stop sent
  # partway through, and a count of how many commands actually reached fput.
  $fput_log = []
  $fput_delay = 0.3
  c.send_json(type: 'intent', intent: 'run_macro', args: { commands: %w[one two three four five] })
  sleep 0.15 # land inside the first command's fput delay, before it returns
  c.send_json(type: 'intent', intent: 'stop_all')

  acks = {}
  20.times do
    break if acks['run_macro'] && acks['stop_all']
    msg = begin
      c.read_json(timeout: 3)
    rescue StandardError
      nil
    end
    break if msg.nil?
    acks[msg['intent']] = msg if msg['type'] == 'intent_ack'
  end

  check('stop_all was acked', !acks['stop_all'].nil?)
  check('run_macro was acked', !acks['run_macro'].nil?)
  check(
    'run_macro reports it stopped early, not "5 command(s) sent"',
    acks['run_macro'] && acks['run_macro']['detail'].to_s.include?('stopped after'),
    acks['run_macro'] && acks['run_macro']['detail']
  )
  check('fewer than all 5 commands reached fput', $fput_log.size < 5, $fput_log.inspect)
  check('at least one command ran before the stop landed', $fput_log.size >= 1, $fput_log.inspect)
  $fput_delay = 0

  # The previous test's stop_all is still latched. Clear it before racing two
  # fresh macros, or both would be refused outright and this test would pass
  # vacuously (two empty logs are trivially "not interleaved").
  c.send_json(type: 'intent', intent: 'resume')
  c.read_until('intent_ack')

  puts ''
  puts '-- two command-sending intents queue instead of interleaving --'
  # The mutex this guards: without it, per-message threading (added for the
  # test above) would let two run_macro calls both reach fput at once, and
  # DragonRealms would see interleaved commands from what the player experiences
  # as two sequential requests. This has to actually race them, not just call
  # the methods back to back, or a bug here would pass by construction.
  $fput_log = []
  $fput_delay = 0.15
  a_client = Client.new(PORT)
  a_client.read_until('hello')
  b_client = Client.new(PORT)
  b_client.read_until('hello')

  a_client.send_json(type: 'intent', intent: 'run_macro', args: { commands: %w[a1 a2 a3] })
  sleep 0.05 # give a_client's macro the lock first, deterministically
  b_client.send_json(type: 'intent', intent: 'run_macro', args: { commands: %w[b1 b2 b3] })

  # Generous: 6 commands at 0.15s each under mutual exclusion, plus overhead.
  sleep 1.5

  groups = $fput_log.chunk { |cmd| cmd[0] }.map(&:first)
  check(
    'commands ran as two clean blocks, not interleaved',
    groups == %w[a b] || groups == %w[b a],
    $fput_log.inspect
  )
  check('all six commands ran', $fput_log.size == 6, $fput_log.inspect)
  $fput_delay = 0
  a_client.close
  b_client.close

  # Not latched by the previous test, but cleared anyway so this test does
  # not depend on that being true - it asserts the latch's own persistence,
  # so it has to start from a known, deliberately-established clean state.
  c.send_json(type: 'intent', intent: 'resume')
  c.read_until('intent_ack')

  puts ''
  puts '-- a Stop survives into the next macro the client sends --'
  # The actual bug in the first version of this fix: run_macro/stow_all
  # cleared the stop flag on entry, after acquiring CMD_LOCK. So a Stop
  # pressed mid-flow aborted the current step correctly, and then FlowDriver's
  # own timer sent the next step's run_macro, which wiped the flag before its
  # loop even started and ran to completion - Stop silently absorbed by
  # exactly the surface it exists to interrupt. No racing needed to prove
  # this one: once latched, it must stay latched across any gap, however
  # long, until resume.
  $fput_log = []
  c.send_json(type: 'intent', intent: 'run_macro', args: { commands: ['s1'] })
  ack1 = c.read_until('intent_ack')
  check('the first macro completed normally', ack1 && ack1['ok'] == true, ack1.inspect)

  c.send_json(type: 'intent', intent: 'stop_all')
  stop_ack = c.read_until('intent_ack')
  check('stop_all acked', stop_ack && stop_ack['intent'] == 'stop_all', stop_ack.inspect)

  c.send_json(type: 'intent', intent: 'run_macro', args: { commands: %w[n1 n2 n3] })
  ack2 = c.read_until('intent_ack')
  check(
    'no commands ran after the Stop',
    ($fput_log & %w[n1 n2 n3]).empty?,
    "commands sent after Stop: #{$fput_log.inspect}"
  )
  # Condition 5: a refusal must be reported as a refusal. ok:true with
  # "stopped after 0 of 3" reads identically to success on the client
  # (useAppStore.ts only logs on ok:false) - the exact silent-success shape
  # this whole fix exists to close, one layer up.
  check('the refused macro is acked ok:false, not a silent success', ack2 && ack2['ok'] == false, ack2.inspect)
  check('and says to resume', ack2 && ack2['detail'].to_s.include?('Resume'), ack2 && ack2['detail'])

  puts ''
  puts '-- resume clears the latch, and only resume does --'
  c.send_json(type: 'intent', intent: 'resume')
  resume_ack = c.read_until('intent_ack')
  check('resume acked', resume_ack && resume_ack['intent'] == 'resume', resume_ack.inspect)

  $fput_log = []
  c.send_json(type: 'intent', intent: 'run_macro', args: { commands: ['after-resume'] })
  ack3 = c.read_until('intent_ack')
  check('a macro after resume is accepted', ack3 && ack3['ok'] == true, ack3.inspect)
  check('and actually ran', $fput_log.include?('after-resume'), $fput_log.inspect)

  puts ''
  puts '-- escape reaches the game even while Stop is latched --'
  # Fleeing is the one thing you most need right after pressing Stop on a
  # fight going wrong. escape sits in COMMAND_SENDING (so it still queues
  # behind CMD_LOCK rather than interleaving with another command-sending
  # intent) but deliberately does not check stop_requested? the way
  # run_macro/stow_all do. The latch blocks automation continuing on its
  # own; it must not also block the one manual safety action that exists
  # for exactly the moment right after Stop.
  c.send_json(type: 'intent', intent: 'stop_all')
  c.read_until('intent_ack')

  # Floor: prove the latch is genuinely up before testing that escape
  # ignores it. Without this, a bug that broke the latch entirely (so
  # nothing was ever refused) would pass this test for the wrong reason -
  # escape would "work while latched" because nothing was latched at all.
  status_after_stop = c.read_until('status')
  check(
    'floor: the bridge reports the latch is up before this test proceeds',
    status_after_stop && status_after_stop['payload']['stopLatched'] == true,
    status_after_stop && status_after_stop['payload']
  )

  $dothis_log = []
  c.send_json(type: 'intent', intent: 'escape')
  escape_ack = c.read_until('intent_ack')
  check('escape is accepted while latched, not refused', escape_ack && escape_ack['ok'] == true, escape_ack.inspect)
  check('and flee actually reached the game', $dothis_log.include?('flee'), $dothis_log.inspect)

  c.send_json(type: 'intent', intent: 'resume')
  c.read_until('intent_ack')

  puts ''
  puts '-- check_health: DRCH available, real wound counts --'
  # The success path never touches Cmd.exec at all - it reads DRCH.check_health
  # directly. Floor below proves that: if a future edit made the success path
  # fall through to the game command too, this test would still pass on the
  # ack alone, so the floor is what actually catches that regression.
  $dothis_log = []
  $drch_reply = FakeHealthResult.new(
    { 'moderate' => [Object.new, Object.new], 'minor' => [Object.new] },
    { 'light' => [DRCHWound.new('right arm')] },
    false,
    false
  )
  c.send_json(type: 'intent', intent: 'check_health')
  ack = c.read_until('intent_ack')
  check('reports the real counts from DRCH', ack && ack['detail'] == '3 wounds, 1 bleeding', ack.inspect)
  check(
    'floor: the success path never reached the game at all',
    $dothis_log.empty?,
    $dothis_log.inspect
  )
  $drch_reply = :raise

  puts ''
  puts '-- check_health: DRCH unavailable, the fallback reads the game and succeeds --'
  $dothis_log = []
  $dothis_reply = 'You have a moderate bruise on your right arm.'
  c.send_json(type: 'intent', intent: 'check_health')
  ack = c.read_until('intent_ack')
  check('reports the fallback-success detail, not the DRCH-success shape', ack && ack['detail'] == 'health read', ack.inspect)
  check(
    'and it took the fallback for the stated reason: the game was actually asked',
    $dothis_log.include?('health'),
    $dothis_log.inspect
  )
  $dothis_reply = nil

  puts ''
  puts '-- check_health: DRCH unavailable, the fallback also gets nothing back --'
  $dothis_log = []
  c.send_json(type: 'intent', intent: 'check_health')
  ack = c.read_until('intent_ack')
  check('reports ok:false rather than a fabricated success', ack && ack['ok'] == false, ack.inspect)
  check('and the message names what happened', ack && ack['detail'] == 'Could not read health.', ack.inspect)
  check(
    'floor: this is a real "asked and got nothing," not a default that never asked',
    $dothis_log.include?('health'),
    $dothis_log.inspect
  )

  puts ''
  puts '-- check_toggles reaches both game commands it depends on --'
  # check_room_id_flag is called from inside check_toggles, not from the
  # dispatch table - a second, easy-to-miss command in the same intent. The
  # floor here is that specific: not "check_toggles ran something", but that
  # both named commands specifically reached the game.
  $dothis_log = []
  c.send_json(type: 'intent', intent: 'check_toggles')
  ack = c.read_until('intent_ack')
  check('check_toggles is acked', !ack.nil?, ack.inspect)
  check(
    'floor: the toggle command reached the game',
    $dothis_log.include?('toggle'),
    $dothis_log.inspect
  )
  check(
    'floor: the nested flags command also reached the game - the one that would go silent first',
    $dothis_log.include?('flags'),
    $dothis_log.inspect
  )

  # Every intent test above triggered a `broadcast(type: 'status', ...)`, so
  # several stale status pushes are sitting in the socket ahead of anything
  # this section sends - read_until returns the first match it finds, which
  # would be one of those, generated before any GameObj fixture below was
  # set. Drain them first so "send get_status, read status" actually reads
  # the fresh one rather than silently agreeing with whichever backlog entry
  # happened to be first in the queue.
  begin
    loop { c.read_json(timeout: 0.2) }
  rescue Timeout::Error
    nil
  end

  puts ''
  puts '-- a populated inventory produces a populated payload, not just an empty default --'
  # The floor that matters most here: a suite that only ever sees the empty
  # case cannot tell a working GameObj from a broken one, because the empty
  # case IS the default `safe(...)` falls back to. Prove the mechanism can
  # report something real before trusting it to report nothing.
  $gameobj_raise = false
  $gameobj_loot = [GameObjItem.new(101, 'a rusty dagger'), GameObjItem.new(102, 'some copper kronars')]
  $gameobj_right_hand = GameObjItem.new(201, 'a serrated broadsword')
  $gameobj_left_hand = nil
  $gameobj_inv = [GameObjItem.new(301, 'a leather cap'), GameObjItem.new(302, 'a wool cloak')]

  c.send_json(type: 'get_status')
  status = c.read_until('status')
  payload = status['payload']
  check('roomItems carries real names', payload['roomItems'] == ['a rusty dagger', 'some copper kronars'], payload['roomItems'].inspect)
  check('hands.right carries the real item', payload['hands']['right'] == 'a serrated broadsword', payload['hands'].inspect)
  check('hands.left stays nil for a genuinely empty hand', payload['hands']['left'].nil?, payload['hands'].inspect)

  c.send_json(type: 'get_inventory')
  inv = c.read_until('inventory')
  ipayload = inv['payload']
  check('worn carries the real names', ipayload['worn'] == ['a leather cap', 'a wool cloak'], ipayload['worn'].inspect)
  check('wornCount matches', ipayload['wornCount'] == 2, ipayload['wornCount'])
  check('looseCount counts only the occupied hand', ipayload['looseCount'] == 1, ipayload['looseCount'])

  puts ''
  puts '-- a legitimately empty inventory reports empty, honestly --'
  $gameobj_loot = []
  $gameobj_right_hand = nil
  $gameobj_left_hand = nil
  $gameobj_inv = []
  c.send_json(type: 'get_status')
  empty_status = c.read_until('status')['payload']
  c.send_json(type: 'get_inventory')
  empty_inv = c.read_until('inventory')['payload']
  check('roomItems is really empty, not raised-and-defaulted', empty_status['roomItems'] == [], empty_status['roomItems'].inspect)
  check('worn is really empty, not raised-and-defaulted', empty_inv['worn'] == [], empty_inv['worn'].inspect)

  puts ''
  puts '-- what safe() hides: can the payload tell "GameObj is broken" from "nothing is here" --'
  # Not fixing this - per Prime, if the answer is "no, they are indistinguishable",
  # that is a finding about the bridge's own design and belongs to GUI-1, not
  # a thing to invent a workaround for here.
  $gameobj_raise = true
  c.send_json(type: 'get_status')
  broken_status = c.read_until('status')['payload']
  c.send_json(type: 'get_inventory')
  broken_inv = c.read_until('inventory')['payload']
  $gameobj_raise = false

  check(
    'the six field VALUES stay identical broken-vs-empty, by design - ' \
    'degraded is what tells them apart, not a changed shape',
    broken_status['roomItems'] == empty_status['roomItems'] && broken_status['hands'] == empty_status['hands'],
    { broken: broken_status.slice('roomItems', 'hands'), empty: empty_status.slice('roomItems', 'hands') }.inspect
  )
  check(
    'same for the inventory payload: values identical, degraded is the signal',
    broken_inv['worn'] == empty_inv['worn'] && broken_inv['wornCount'] == empty_inv['wornCount'],
    { broken: broken_inv.slice('worn', 'wornCount'), empty: empty_inv.slice('worn', 'wornCount') }.inspect
  )

  puts ''
  puts '-- stow_all: a held item reaches the game, by its noun, not its full name --'
  # stow_all sends `item.noun`, not `item.name` - the two-word "a serrated
  # broadsword" would never match anything the game accepts. Deliberately
  # giving noun and name different values here so a bridge regression that
  # swapped one for the other would be caught, not coincidentally pass.
  # Floor: prove the honest no-op path first, so the populated case that
  # follows is shown against a real empty baseline rather than assumed.
  $gameobj_raise = false
  $gameobj_right_hand = nil
  $gameobj_left_hand = nil
  $dothis_log = []
  c.send_json(type: 'intent', intent: 'stow_all')
  ack = c.read_until('intent_ack')
  check('floor: empty hands take the honest no-op path', ack && ack['detail'] == 'nothing to stow', ack.inspect)
  check('floor: and nothing was sent to the game for it', $dothis_log.empty?, $dothis_log.inspect)

  $gameobj_right_hand = GameObjItem.new(201, 'a serrated broadsword', 'broadsword')
  $dothis_log = []
  $dothis_reply = 'You put the broadsword in your pack.'
  c.send_json(type: 'intent', intent: 'stow_all')
  ack = c.read_until('intent_ack')
  check('one held item is reported stowed', ack && ack['detail'] == 'stowed 1', ack.inspect)
  check(
    'and the game was actually asked, by noun rather than the full display name',
    $dothis_log.include?('stow broadsword'),
    $dothis_log.inspect
  )
  $dothis_reply = nil

  puts ''
  puts '-- stow_all: both hands full reaches the game for both --'
  $gameobj_right_hand = GameObjItem.new(201, 'a serrated broadsword', 'broadsword')
  $gameobj_left_hand = GameObjItem.new(202, 'a round shield', 'shield')
  $dothis_log = []
  $dothis_reply = 'You put it in your pack.'
  c.send_json(type: 'intent', intent: 'stow_all')
  ack = c.read_until('intent_ack')
  check('both held items are reported stowed', ack && ack['detail'] == 'stowed 2', ack.inspect)
  check('the right-hand item reached the game', $dothis_log.include?('stow broadsword'), $dothis_log.inspect)
  check('the left-hand item also reached the game', $dothis_log.include?('stow shield'), $dothis_log.inspect)
  $dothis_reply = nil
  $gameobj_right_hand = nil
  $gameobj_left_hand = nil

  puts ''
  puts '-- degraded: a swallowed read is named, a legitimately empty one is not --'
  # The whole point of the field. safe() turns any exception into the same
  # empty default the honest case produces, so the VALUES cannot distinguish
  # them and are not meant to - `degraded` carries what safe() swallowed.
  #
  # The second half matters more than the first: a field that read fine must
  # never appear here. An indicator that fires on an empty room is an
  # indicator nobody looks at on the night GameObj actually breaks.
  # Drain first, same reason as the section above: read_until returns the
  # first message of a matching type, which is not the same as the message
  # answering your request. Without this, the status read below silently
  # picks up a broadcast generated before $gameobj_raise was set - and
  # reports degraded as nil while the bridge is emitting it correctly.
  begin
    loop { c.read_json(timeout: 0.2) }
  rescue Timeout::Error
    nil
  end
  $gameobj_raise = true
  c.send_json(type: 'get_status')
  dstat = c.read_until('status')['payload']
  c.send_json(type: 'get_inventory')
  dinv = c.read_until('inventory')['payload']
  $gameobj_raise = false

  check('a broken GameObj names the status fields it could not read',
        (dstat['degraded'] || []).sort == ['hands.left', 'hands.right', 'roomItems'],
        dstat['degraded'].inspect)
  check('and the inventory fields, with dotted paths as the payload nests them',
        (dinv['degraded'] || []).sort == ['looseCount', 'worn', 'wornCount'],
        dinv['degraded'].inspect)

  # The cry-wolf condition, and the reason this is two checks and not one.
  # This is what caught GameObj.right_hand.id missing its safe-navigation:
  # an empty hand raised NoMethodError, safe() turned it into the correct
  # answer 0, and nothing looked wrong until degraded started naming what had
  # been swallowed and a pair of empty hands reported itself unreadable.
  $gameobj_loot = []
  $gameobj_right_hand = nil
  $gameobj_left_hand = nil
  $gameobj_inv = []
  # Drain first, same reason as the section above: read_until returns the
  # first message of a matching type, which is not the same as the message
  # answering your request. Without this, the status read below silently
  # picks up a broadcast generated before $gameobj_raise was set - and
  # reports degraded as nil while the bridge is emitting it correctly.
  begin
    loop { c.read_json(timeout: 0.2) }
  rescue Timeout::Error
    nil
  end
  c.send_json(type: 'get_status')
  clean = c.read_until('status')['payload']
  c.send_json(type: 'get_inventory')
  clean_inv = c.read_until('inventory')['payload']
  check('an empty room does NOT appear as degraded (absent, not [])',
        !clean.key?('degraded'), clean['degraded'].inspect)
  check('nor an empty inventory',
        !clean_inv.key?('degraded'), clean_inv['degraded'].inspect)

  # Floor. Without it, both checks above pass against a bridge that never
  # emits the field at all - which is exactly what an older bridge does, and
  # exactly what happened on the red run before this fix existed.
  check('floor: the field is emitted at all, or the two checks above are vacuous',
        dstat.key?('degraded') && dinv.key?('degraded'),
        [dstat.key?('degraded'), dinv.key?('degraded')].inspect)

  # ------------------------------------------------------------------------
  # Wiring tests: map_here, map_tags, map_nearest, map_path, map_zone,
  # read_settings, reset_runaway.
  #
  # All seven have their underlying logic tested directly elsewhere -
  # MapInfo in map_test.rb, Yaml.files_for in yaml_test.rb, Runaway.reset
  # exercised (never asserted on) as scaffolding in runaway_test.rb between
  # cases. None of that proves the *intent* reaches that logic: the right
  # args parsed out of the message, the right broadcast type sent back, the
  # right ack. A renamed intent, a broken args['tag'] vs args[:tag], or a
  # payload key typo would pass every existing test and fail here first.
  # Tested through the socket as intents, deliberately, not by calling
  # MapInfo/Yaml/Runaway directly - that would test the module a second
  # time and the wiring not at all.
  puts ''
  puts '-- map_here reaches MapInfo and reports this stub room, not a default --'
  c.send_json(type: 'intent', intent: 'map_here')
  msgs = collect(c, 4)
  here_ack = msgs.find { |m| m['type'] == 'intent_ack' }
  here_msg = msgs.find { |m| m['type'] == 'map_here' }
  check('acked ok', here_ack && here_ack['ok'] == true, here_ack.inspect)
  check('id is the stub room, not nil/0', here_msg && here_msg['payload']['id'] == 1, here_msg.inspect)
  check('uid is separate from id', here_msg && here_msg['payload']['uid'] == 9001, here_msg.inspect)
  check('title has the brackets stripped', here_msg && here_msg['payload']['title'] == 'Town Square', here_msg.inspect)
  check(
    'floor: available is true - a broken wire would show the same shape as "no map"',
    here_msg && here_msg['payload']['available'] == true,
    here_msg.inspect
  )

  # map_tags and map_nearest deleted (see companion_bridge.lic commit): zero
  # consumers anywhere in src/, and PlaceSearch already covers the purpose
  # better across 3,174 labelled rooms with aliases rather than one tag on
  # whatever the current map database happens to define.

  puts ''
  puts '-- map_path parses the destination argument and returns the real route --'
  c.send_json(type: 'intent', intent: 'map_path', args: { to: 2 })
  msgs = collect(c, 4)
  path_ack = msgs.find { |m| m['type'] == 'intent_ack' }
  path_msg = msgs.find { |m| m['type'] == 'map_path' }
  check('acked ok', path_ack && path_ack['ok'] == true, path_ack.inspect)
  check('reports the one-step route from the stub, not an invented length',
        path_msg && path_msg['payload']['steps'] == 1, path_msg.inspect)
  check('floor: ok is true, not the "no route" shape', path_msg && path_msg['payload']['ok'] == true, path_msg.inspect)

  puts ''
  puts '-- map_zone reaches MapInfo and reports both rooms in this zone --'
  c.send_json(type: 'intent', intent: 'map_zone')
  msgs = collect(c, 4)
  zone_ack = msgs.find { |m| m['type'] == 'intent_ack' }
  zone_msg = msgs.find { |m| m['type'] == 'map_zone' }
  check('acked ok', zone_ack && zone_ack['ok'] == true, zone_ack.inspect)
  check('reports both stub rooms, not one or zero', zone_msg && zone_msg['payload']['total'] == 2, zone_msg.inspect)
  check('floor: ok is true, not the "no zone" shape', zone_msg && zone_msg['payload']['ok'] == true, zone_msg.inspect)

  puts ''
  puts '-- map queries report "no map" honestly when MapInfo.klass is unavailable --'
  # The other half of the wiring: not just "does it work when the map is
  # there" but "does it say so, honestly, when it is not" - the exact
  # distinction map_test.rb's own doc comment calls out ("no bank nearby"
  # vs "I cannot see a map" must not look alike).
  $map_klass = nil
  c.send_json(type: 'intent', intent: 'map_here')
  msgs = collect(c, 3)
  no_map_ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('refused, not a fabricated success', no_map_ack && no_map_ack['ok'] == false, no_map_ack.inspect)
  check('names the real reason', no_map_ack && no_map_ack['detail'].to_s.include?('No Lich map'), no_map_ack && no_map_ack['detail'])
  $map_klass = StubMap

  puts ''
  puts '-- read_settings reaches Yaml.files_for with this character\'s name --'
  c.send_json(type: 'intent', intent: 'read_settings')
  # More than the others: read_settings logs a line per file before the
  # settings broadcast and the ack, so with two fixture files the ack sits
  # behind 3-4 'log' messages in the queue.
  msgs = collect(c, 8)
  settings_ack = msgs.find { |m| m['type'] == 'intent_ack' }
  settings_msg = msgs.find { |m| m['type'] == 'settings' }
  check('acked ok', settings_ack && settings_ack['ok'] == true, settings_ack.inspect)
  check('reports this character\'s name, not empty', settings_msg && settings_msg['character'] == 'Testchar', settings_msg.inspect)
  file_names = settings_msg && settings_msg['files'].map { |f| f['name'] }
  check('base.yaml is included', file_names && file_names.include?('base.yaml'), file_names.inspect)
  check(
    'floor: the character-specific file is also included - proves the name reached the glob, not just a fixed base.yaml lookup',
    file_names && file_names.include?('Testchar-setup.yaml'),
    file_names.inspect
  )

  puts ''
  puts '-- reset_runaway actually clears Runaway state, not just acks --'
  # Runaway.reset appears throughout runaway_test.rb, but only as scaffolding
  # between cases - called to clean up, never itself asserted on. A function
  # whose only appearance in a suite is as setup reads as covered to anyone
  # grepping the file, and is not tested at all: the inverse of a check that
  # cannot fail, a call that cannot fail because nothing is looking at it.
  Companion::Runaway.instance_variable_set(:@tripped, true)
  Companion::Runaway.instance_variable_set(:@recent, %w[go go go go go go])
  check('floor: Runaway is genuinely tripped before this test proceeds',
        Companion::Runaway.tripped == true, Companion::Runaway.tripped)
  c.send_json(type: 'intent', intent: 'reset_runaway')
  msgs = collect(c, 3)
  reset_ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('acked ok', reset_ack && reset_ack['ok'] == true, reset_ack.inspect)
  check(
    'and Runaway is actually cleared, not just acknowledged',
    Companion::Runaway.tripped == false,
    Companion::Runaway.tripped
  )

  # ------------------------------------------------------------------------
  # trace_on / trace_off / trace_dump: the diagnostic console
  # (useAppStore.ts's setTraceEnabled, rendered by Console.tsx), reachable
  # only through `as IntentName` casts until prime lands the type fix
  # tonight. Real intents, Trace had zero test coverage at any level before
  # this - not module-level, not wiring. Each check proves the actual
  # module state changed, not just that an ack came back, the same
  # discipline reset_runaway's test above was written to enforce.
  puts ''
  puts '-- trace_on genuinely enables tracing, not just acks --'
  Companion::Trace.enable(false)
  check('floor: tracing is genuinely off before this test proceeds',
        Companion::Trace.enabled? == false, Companion::Trace.enabled?)
  c.send_json(type: 'intent', intent: 'trace_on')
  msgs = collect(c, 4)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('acked ok', ack && ack['ok'] == true, ack.inspect)
  check('and tracing is actually enabled, not just acknowledged',
        Companion::Trace.enabled? == true, Companion::Trace.enabled?)

  puts ''
  puts '-- trace_off genuinely disables tracing, not just acks --'
  c.send_json(type: 'intent', intent: 'trace_off')
  msgs = collect(c, 4)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('acked ok', ack && ack['ok'] == true, ack.inspect)
  check('and tracing is actually disabled, not just acknowledged',
        Companion::Trace.enabled? == false, Companion::Trace.enabled?)

  puts ''
  puts '-- trace_dump replays the real recorded rows, not an empty tail --'
  # Recent rows are kept even while tracing is off (Trace.event's own
  # comment: "so a tester who turns it on after something went wrong still
  # has the last few lines"), and trace_dump reads them directly rather
  # than through the live sink - the floor below is what proves this test
  # is exercising real recorded history, not an artifact of tracing having
  # just been turned on above.
  #
  # Enabled explicitly false here, not assumed from the trace_off test
  # above: Trace.event also fires the live sink when enabled, which would
  # broadcast each event a second time and double the row count this test
  # reads back - a failure that would look like this test's own bug but
  # actually be trace_off's, entangling two independent checks. Making
  # every precondition this test needs true here, rather than inherited
  # from test order, is what keeps sabotaging trace_off from also
  # reddening this section.
  Companion::Trace.enable(false)
  Companion::Trace.instance_variable_set(:@recent, [])
  Companion::Trace.event(:send, 'test command one')
  Companion::Trace.event(:reply, 'test reply one')
  check('floor: two real rows are recorded before this test proceeds',
        Companion::Trace.recent.size == 2, Companion::Trace.recent.size)
  c.send_json(type: 'intent', intent: 'trace_dump')
  msgs = collect(c, 6)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  trace_rows = msgs.select { |m| m['type'] == 'trace' }
  check('acked with the real count, not a guess', ack && ack['detail'] == '2 rows', ack.inspect)
  check('and both real rows actually reached the wire', trace_rows.size == 2, trace_rows.inspect)
  check(
    'carrying the real recorded detail text, not placeholders',
    trace_rows.any? { |r| r['row']['detail'] == 'test command one' } &&
      trace_rows.any? { |r| r['row']['detail'] == 'test reply one' },
    trace_rows.inspect
  )

  puts ''
  puts '-- pause genuinely pauses a running script, not just acks --'
  # Zero dispatches anywhere in this suite before this test, while resume
  # had five - and pause is in ALWAYS, one of the three intents that must
  # work whenever the socket is open no matter what the game looks like. A
  # safety-classed intent untested at every level was the worst gap left
  # once the wiring batch closed.
  #
  # The check below is deliberately not "was Script.pause called" - it is
  # "does the thing pause_all was pausing actually read as paused
  # afterwards", the same shape as the client-side fix that made pause work
  # for real: clearing the timer, not setting a flag a later path ignores
  # or walks past. A test that only checked the ack, or only checked that
  # pause_all's own local `paused` array grew, would pass against a bridge
  # that pauses nothing anyone else can observe.
  $fake_running_scripts = [FakeRunningScript.new('hunting-buddy', false)]
  check('floor: a real running, unpaused script exists before this test proceeds',
        $fake_running_scripts.first.paused? == false, $fake_running_scripts.inspect)
  c.send_json(type: 'intent', intent: 'pause')
  msgs = collect(c, 4)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('acked ok, naming the real count', ack && ack['detail'] == 'paused 1', ack.inspect)
  check(
    'and the script is actually paused, observable from outside the intent handler',
    $fake_running_scripts.first.paused? == true,
    $fake_running_scripts.inspect
  )

  puts ''
  puts '-- resume genuinely unpauses it back, closing the loop --'
  c.send_json(type: 'intent', intent: 'resume')
  msgs = collect(c, 4)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('acked ok, naming the real count', ack && ack['detail'] == 'resumed 1', ack.inspect)
  check('and the script is actually unpaused', $fake_running_scripts.first.paused? == false, $fake_running_scripts.inspect)
  $fake_running_scripts = []

  puts ''
  puts '-- install_mapdb picks download-prime-map off Prime, unchanged behaviour --'
  # The instance check is new; the rest of this path (try download-prime-map,
  # fall back to repository, report which one) already existed and must not
  # regress for Platinum/Fallen, where download-prime-map actually works.
  $xmldata_game = 'DRX' # Platinum
  $fake_scripts_installed = %w[download-prime-map repository]
  $fake_started = []
  c.send_json(type: 'intent', intent: 'install_mapdb')
  msgs = collect(c, 4)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('acked ok', ack && ack['ok'] == true, ack.inspect)
  check(
    'download-prime-map was the one actually started off Prime',
    $fake_started.first && $fake_started.first[0] == 'download-prime-map',
    $fake_started.inspect
  )

  puts ''
  puts '-- install_mapdb skips download-prime-map on Prime, where it always refuses --'
  # download-prime-map.lic hard-exits the moment it runs on Prime
  # ("XMLData.game == 'DR'" -> exit, before touching the network), so
  # starting it there is a script that starts and does nothing - a command
  # that reports success and teaches the bridge nothing. This is the actual
  # bug: with both scripts installed, install_mapdb used to pick
  # download-prime-map purely because the file exists, never checking
  # whether it would run.
  $xmldata_game = 'DR' # Prime
  $fake_scripts_installed = %w[download-prime-map repository]
  $fake_started = []
  c.send_json(type: 'intent', intent: 'install_mapdb')
  msgs = collect(c, 4)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('acked ok', ack && ack['ok'] == true, ack.inspect)
  check(
    'repository was started instead, not the script that would refuse',
    $fake_started.first && $fake_started.first[0] == 'repository',
    $fake_started.inspect
  )
  check(
    'with the download-mapdb argument repository actually understands',
    $fake_started.first && $fake_started.first[1] == ['download-mapdb'],
    $fake_started.inspect
  )

  puts ''
  puts '-- install_mapdb reports honestly when nothing is installed --'
  $xmldata_game = 'DR'
  $fake_scripts_installed = []
  $fake_started = []
  c.send_json(type: 'intent', intent: 'install_mapdb')
  msgs = collect(c, 4)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('refused, not a fabricated success', ack && ack['ok'] == false, ack.inspect)
  check('names what it looked for', ack && ack['detail'].to_s.include?('repository'), ack && ack['detail'])
  check('floor: nothing was actually started', $fake_started.empty?, $fake_started.inspect)
  $xmldata_game = ''
  $fake_scripts_installed = []

  # ------------------------------------------------------------------------
  # start_script: the only intent that causes Lich to execute arbitrary
  # named code. Its defence is three guards in a row - name-shape regex,
  # existence check, already-running check - and none of them had ever been
  # exercised at the socket. Treated as a security test, not a coverage one:
  # each case is tested where the wrong answer is available, and the guard
  # that actually did the refusing is asserted, not just that a refusal
  # happened.
  puts ''
  puts '-- start_script refuses bad-shaped names before ever asking if they exist --'
  # $fake_exists_calls proves Script.exists? was never reached for these - a
  # regex bug that let a bad name through would often still get refused by
  # the existence check, and a test only checking "was it refused" would not
  # catch that the wrong guard did it.
  [
    ['../../etc/passwd', 'path traversal with slashes'],
    ['foo/bar', 'a single forward slash'],
    ["a\\b", 'a backslash'],
    ['foo bar', 'a space'],
  ].each do |bad_name, why|
    $fake_scripts_installed = %w[hunting-buddy]
    $fake_exists_calls = []
    c.send_json(type: 'intent', intent: 'start_script', args: { name: bad_name })
    msgs = collect(c, 3)
    ack = msgs.find { |m| m['type'] == 'intent_ack' }
    check(
      "#{why}: refused as an invalid name",
      ack && ack['ok'] == false && ack['detail'].to_s.include?('not a valid script name'),
      ack.inspect
    )
    check("#{why}: floor - Script.exists? was never reached", $fake_exists_calls.empty?, $fake_exists_calls.inspect)
  end

  puts ''
  puts '-- an empty name gets its own specific message, not the invalid-characters one --'
  $fake_exists_calls = []
  c.send_json(type: 'intent', intent: 'start_script', args: { name: '' })
  msgs = collect(c, 3)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check(
    'refused with the empty-name message specifically',
    ack && ack['ok'] == false && ack['detail'].to_s == 'no script name given',
    ack.inspect
  )
  check('floor: Script.exists? was never reached', $fake_exists_calls.empty?, $fake_exists_calls.inspect)

  puts ''
  puts '-- ".." passes the name-shape regex, but Script.exists? correctly refuses it --'
  # Convinced by reading Lich's own resolvers rather than assuming, since a
  # crafted "harmless-looking" name is exactly where a gap would hide.
  # Script.exists? (lib/common/script.rb's @@elevated_exists) builds
  # "#{SCRIPT_DIR}/#{name}.lic" by concatenation, not path-joining - name
  # '..' produces the literal filename "...lic" in SCRIPT_DIR, not a
  # parent-directory escape. Script.start's own resolver
  # (__find_script_file) only ever matches entries from
  # Dir.children(SCRIPT_DIR), which never lists ".." as an entry at all
  # (Dir.children excludes "." and ".." by definition). Both real gates are
  # independently safe against it; this proves the bridge's own existence
  # check is the one that actually refuses it - the guard genuinely
  # reachable from a crafted intent, not merely a coincidence of paths that
  # happen not to exist.
  $fake_scripts_installed = %w[hunting-buddy]
  $fake_exists_calls = []
  c.send_json(type: 'intent', intent: 'start_script', args: { name: '..' })
  msgs = collect(c, 3)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('".." is refused, not started', ack && ack['ok'] == false, ack.inspect)
  check(
    'and by the existence guard specifically, not the shape regex',
    ack && ack['detail'].to_s.include?('no script named'),
    ack && ack['detail']
  )
  check('floor: Script.exists? was actually asked about it', $fake_exists_calls.include?('..'), $fake_exists_calls.inspect)

  puts ''
  puts '-- a well-shaped name that is not installed is refused honestly --'
  $fake_scripts_installed = %w[hunting-buddy]
  c.send_json(type: 'intent', intent: 'start_script', args: { name: 'totally-fake-script' })
  msgs = collect(c, 3)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check(
    'refused as not found, not started',
    ack && ack['ok'] == false && ack['detail'].to_s.include?('no script named'),
    ack.inspect
  )

  puts ''
  puts '-- a genuinely valid, installed script name is accepted --'
  # The floor for every refusal above: a suite where every name gets refused
  # proves only that the bridge says no to things, never that it can say yes
  # to the right one.
  $fake_scripts_installed = %w[hunting-buddy]
  $fake_started = []
  c.send_json(type: 'intent', intent: 'start_script', args: { name: 'hunting-buddy' })
  msgs = collect(c, 3)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check('accepted and actually started', ack && ack['ok'] == true, ack.inspect)
  check(
    'floor: Script.start was actually called with this exact name',
    $fake_started.any? { |s| s[0] == 'hunting-buddy' },
    $fake_started.inspect
  )

  puts ''
  puts '-- start_script refuses a script that is already running --'
  $fake_scripts_installed = %w[hunting-buddy]
  $fake_running_scripts = [FakeRunningScript.new('hunting-buddy', false)]
  $fake_started = []
  c.send_json(type: 'intent', intent: 'start_script', args: { name: 'hunting-buddy' })
  msgs = collect(c, 3)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  check(
    'refused as already running, not started a second time',
    ack && ack['ok'] == false && ack['detail'].to_s.include?('already running'),
    ack.inspect
  )
  check('floor: Script.start was not called again', $fake_started.empty?, $fake_started.inspect)
  $fake_running_scripts = []
  $fake_scripts_installed = []

  puts ''
  puts '-- list_scripts enumerates real files: root, custom/, every accepted extension --'
  # Ordinary by comparison to start_script - this reads the real filesystem
  # rather than a mocked API, so the test writes real files into
  # TEST_LICH_DIR/scripts (the same fixture read_settings's tests use) and
  # asks what comes back, rather than stubbing the scan itself.
  scripts_dir = File.join(TEST_LICH_DIR, 'scripts')
  custom_dir = File.join(scripts_dir, 'custom')
  FileUtils.mkdir_p(custom_dir)
  File.write(File.join(scripts_dir, 'afk.lic'), '')
  File.write(File.join(scripts_dir, 'hunting-buddy.rb'), '')
  File.write(File.join(scripts_dir, 'notes.txt'), 'not a script')
  # The bridge's own file, written here on purpose - without it, "excludes
  # itself" would pass vacuously by never having a chance to appear.
  File.write(File.join(scripts_dir, 'companion_bridge.lic'), '')
  File.write(File.join(custom_dir, 'my-macro.lic'), '')

  c.send_json(type: 'intent', intent: 'list_scripts')
  msgs = collect(c, 4)
  ack = msgs.find { |m| m['type'] == 'intent_ack' }
  catalog_msg = msgs.find { |m| m['type'] == 'script_catalog' }
  names = catalog_msg && catalog_msg['payload']

  check('acked ok', ack && ack['ok'] == true, ack.inspect)
  check('floor: the catalog is not empty - proves the scan actually ran', names && !names.empty?, names.inspect)
  check('includes a root-level .lic script', names && names.include?('afk'), names.inspect)
  check('includes a root-level .rb script', names && names.include?('hunting-buddy'), names.inspect)
  check('includes a script from custom/', names && names.include?('my-macro'), names.inspect)
  # An exact-set check, not "does not include 'notes'" - the extension
  # filter's job is to strip the extension AND drop the file. A version that
  # only stripped `.sub(exts, '')` and dropped the `.select` would leave
  # "notes.txt" untouched in the list, which is also not equal to the string
  # "notes" - so an inclusion check on the trimmed name would pass for the
  # wrong reason regardless of whether the filter ran. Checked and caught
  # exactly this: the first version of this test used
  # `!names.include?('notes')` and stayed green with the filter removed.
  check(
    'the catalog is exactly these three names, nothing extra and nothing missing',
    names == %w[afk hunting-buddy my-macro],
    names.inspect
  )

  # Drain the backlog before this section - the same read_until defect noted
  # in 04830aa applies here too: several intents above have already triggered
  # broadcast(type: 'status', ...), so a fresh get_status could otherwise
  # return a stale push from before this section's fixture was set.
  begin
    loop { c.read_json(timeout: 0.2) }
  rescue Timeout::Error
    nil
  end

  puts ''
  puts '-- record_health: severity buckets at the documented boundaries --'
  # 1-4 -> 1, 5-8 -> 2, 9-13 -> 3, per BRIDGE_CONTRACT.md's table. Testing the
  # boundaries themselves (4/5, 8/9), not just one value comfortably inside
  # each bucket, since an off-by-one there is exactly the kind of bug a
  # single mid-range sample would never catch.
  $drch_reply = FakeHealthResult.new(
    {
      'insignificant' => [DRCHWoundFull.new('right arm', 4, false, nil)],
      'moderate'      => [DRCHWoundFull.new('left leg', 5, false, nil)],
      'painful'       => [DRCHWoundFull.new('chest', 8, false, nil)],
      'useless'       => [DRCHWoundFull.new('head', 9, false, nil)]
    },
    {},
    false,
    false
  )
  c.send_json(type: 'intent', intent: 'check_health')
  c.read_until('intent_ack')
  status = c.read_until('status')['payload']
  check('severity 4 buckets to 1 (top of the low band)', status['injuries']['rightArm'] == { 'wound' => 1, 'scar' => 0 }, status['injuries'].inspect)
  check('severity 5 buckets to 2 (bottom of the mid band)', status['injuries']['leftLeg'] == { 'wound' => 2, 'scar' => 0 }, status['injuries'].inspect)
  check('severity 8 buckets to 2 (top of the mid band)', status['injuries']['chest'] == { 'wound' => 2, 'scar' => 0 }, status['injuries'].inspect)
  check('severity 9 buckets to 3 (bottom of the top band)', status['injuries']['head'] == { 'wound' => 3, 'scar' => 0 }, status['injuries'].inspect)

  puts ''
  puts '-- record_health: a wound and a scar on the same part stay separate, worst wins --'
  $drch_reply = FakeHealthResult.new(
    {
      'moderate' => [DRCHWoundFull.new('chest', 9, false, nil)],  # wound, bucket 3
      'minor'    => [DRCHWoundFull.new('chest', 3, false, nil)],  # wound, bucket 1 - must not overwrite the 3
      'scarred'  => [DRCHWoundFull.new('chest', 6, true, nil)]    # scar, bucket 2, separate key
    },
    {},
    false,
    false
  )
  c.send_json(type: 'intent', intent: 'check_health')
  c.read_until('intent_ack')
  status = c.read_until('status')['payload']
  check(
    'the higher-severity wound wins, the lower one does not overwrite it, and the scar is a separate field',
    status['injuries']['chest'] == { 'wound' => 3, 'scar' => 2 },
    status['injuries'].inspect
  )

  puts ''
  puts '-- record_health: an unmapped body part is logged, not dropped silently and not guessed at --'
  $drch_reply = FakeHealthResult.new(
    { 'moderate' => [DRCHWoundFull.new('tail', 6, false, nil)] },
    {},
    false,
    false
  )
  c.send_json(type: 'intent', intent: 'check_health')
  # read_until discards everything it passes over while searching for its
  # target type - exactly the defect this file already carries scars from
  # (see 04830aa, and bd9e534's note on it). The log line this test needs
  # arrives *before* the status broadcast, so reading status first via
  # read_until would silently eat it. Collect every message raw instead.
  received = []
  8.times do
    msg = begin
      c.read_json(timeout: 0.5)
    rescue Timeout::Error
      nil
    end
    break if msg.nil?
    received << msg
  end
  status = received.reverse.find { |m| m['type'] == 'status' }&.dig('payload')
  check(
    'no fabricated slot for a body part with nowhere to go',
    status && !status['injuries'].key?('tail') && status['injuries'].values.none? { |v| v['wound'] > 0 || v['scar'] > 0 },
    status && status['injuries'].inspect
  )
  logs = received.select { |m| m['type'] == 'log' }
  check(
    'and it was logged by name rather than silently eaten',
    logs.any? { |l| l['line'].to_s.include?('unmapped wound body part: tail') },
    logs.map { |l| l['line'] }.inspect
  )

  puts ''
  puts '-- record_health: bleeding carries the rate string as-is, not collapsed to a boolean --'
  $drch_reply = FakeHealthResult.new(
    {},
    { 'light' => [DRCHWoundFull.new('right arm', 2, false, 'clotted')] },
    false,
    false
  )
  c.send_json(type: 'intent', intent: 'check_health')
  c.read_until('intent_ack')
  status = c.read_until('status')['payload']
  check(
    'the rate string survives rather than becoming a yes/no',
    status['bleeding'] == [{ 'part' => 'rightArm', 'rate' => 'clotted' }],
    status['bleeding'].inspect
  )

  puts ''
  puts '-- record_health: injuries are held state, not blanked by the next status tick --'
  # The whole point of "held, not passive": a plain get_status with no
  # intervening check_health must still show the last successful poll's
  # data, not reset to absent/empty just because time passed.
  $drch_reply = FakeHealthResult.new(
    { 'moderate' => [DRCHWoundFull.new('right hand', 6, false, nil)] },
    {},
    false,
    false
  )
  c.send_json(type: 'intent', intent: 'check_health')
  c.read_until('intent_ack')
  c.read_until('status') # the broadcast from that intent, drained
  c.send_json(type: 'get_status')
  held = c.read_until('status')['payload']
  check(
    'a later plain status request still carries the same injury, unasked-for',
    held['injuries'] && held['injuries']['rightHand'] == { 'wound' => 2, 'scar' => 0 },
    held['injuries'].inspect
  )
  $drch_reply = :raise

  puts '-- record_health: the abbreviated l./r. prefix maps to the same key as the spelled-out side --'
  # map_body_part's side detection is `s.start_with?('l.', 'left')` / `('r.',
  # 'right')` - a distinct branch from anything the boundary/worst-wins/
  # unmapped tests above exercise, all of which use spelled-out sides. If that
  # alternation regressed to only match the spelled-out form, every check
  # above would stay green and this would be the only one to catch it.
  $drch_reply = FakeHealthResult.new(
    {
      'moderate' => [DRCHWoundFull.new('r. arm', 3, false, nil)],
      'minor'    => [DRCHWoundFull.new('l. eye', 2, false, nil)]
    },
    {},
    false,
    false
  )
  c.send_json(type: 'intent', intent: 'check_health')
  c.read_until('intent_ack')
  c.read_until('status') # the broadcast from that intent, drained
  c.send_json(type: 'get_status')
  abbrev = c.read_until('status')['payload']
  check(
    "'r. arm' maps to the same rightArm key as the spelled-out form",
    abbrev['injuries'] && abbrev['injuries']['rightArm'] == { 'wound' => 1, 'scar' => 0 },
    abbrev['injuries'].inspect
  )
  check(
    "'l. eye' maps to leftEye, not left unmapped or confused with leftArm",
    abbrev['injuries'] && abbrev['injuries']['leftEye'] == { 'wound' => 1, 'scar' => 0 },
    abbrev['injuries'].inspect
  )
  $drch_reply = :raise

  puts ''
  puts '-- degraded: Thread.current isolation actually holds under real overlap, not just sequentially --'
  # 3b08dd2's whole argument for thread-local over module state is that
  # serve() spawns a thread per message, so two payload builds can genuinely
  # overlap - a shared array would misattribute one request's failure to the
  # other's payload. The existing coverage (above, and in the section this
  # follows) never has two threads inside safe()/degraded_fields at the same
  # moment, so it could not have caught a regression back to shared state.
  # This forces real overlap with a gate, bypassing the socket layer
  # entirely to test the mechanism directly rather than through the stub
  # globals, which are shared across connections and can't simulate two
  # requests seeing different failures at once anyway.
  gate = Queue.new
  t1_ready = Queue.new
  t2_ready = Queue.new
  t1_result = nil
  t2_result = nil

  t1 = Thread.new do
    Companion::State.reset_degraded!
    t1_ready << true
    gate.pop
    Companion::State.safe(0, as: 'thread1field') { raise 'boom' }
    sleep 0.05 # hold the window open so t2's read can land while t1's list is populated
    t1_result = Companion::State.degraded_fields
  end
  t2 = Thread.new do
    Companion::State.reset_degraded!
    t2_ready << true
    gate.pop
    sleep 0.02 # land inside t1's post-raise window, before t1 reads its own result
    t2_result = Companion::State.degraded_fields
  end

  t1_ready.pop
  t2_ready.pop
  gate << true
  gate << true
  t1.join
  t2.join

  check('thread 1 sees the failure it recorded', t1_result == ['thread1field'], t1_result.inspect)
  check(
    "thread 2, mid-overlap with thread 1's failure, sees none of it - its own list stays clean",
    t2_result == [],
    t2_result.inspect
  )

  # Drain, same reason as every other section that reads status right after
  # setting fixture state: read_until returns the first message of a
  # matching type, not the one answering this request.
  begin
    loop { c.read_json(timeout: 0.2) }
  rescue Timeout::Error
    nil
  end

  puts ''
  puts '-- roomCombatants: assessed range/target/balance/statuses reach the status payload --'
  $creature_room = [
    FakeCreature.new(
      '105829093', 'a jeol moradu', 'moradu', 'melee', 'in front of you', 'you', 1,
      'off', false, %w[cursed], %w[hostile stunned], Time.now
    )
  ]
  c.send_json(type: 'get_status')
  status = c.read_until('status')['payload']
  combatant = status['roomCombatants']&.first
  check(
    'the assessed creature carries range, relation and who it is targeting',
    combatant && combatant['range'] == 'melee' && combatant['relation'] == 'in front of you' &&
      combatant['target'] == 'you' && combatant['targetNumber'] == 1,
    combatant.inspect
  )
  check(
    'balance and its derived off-balance flag both reach the payload',
    combatant && combatant['balance'] == 'off' && combatant['offBalance'] == false,
    combatant.inspect
  )
  check(
    'crtrStatus flags (hostile, stunned) and assess-only conditions (cursed) are both visible, from different sources',
    combatant && combatant['hostile'] == true && combatant['statuses'] == ['stunned'] &&
      combatant['conditions'] == ['cursed'],
    combatant.inspect
  )
  check(
    'freshly enriched reports as roughly zero seconds old, not nil or stale',
    combatant && combatant['enrichedAgeSeconds'] && combatant['enrichedAgeSeconds'] <= 2,
    combatant.inspect
  )

  puts ''
  puts '-- roomCombatants: disengaged is the honest "not fighting" answer, not absence --'
  $creature_room = [
    FakeCreature.new(
      '1', 'a wild boar', 'boar', nil, nil, nil, nil,
      nil, false, [], %w[hostile disengaged], nil
    )
  ]
  c.send_json(type: 'get_status')
  status = c.read_until('status')['payload']
  combatant = status['roomCombatants']&.first
  check(
    'a creature that broke off combat is marked disengaged rather than just missing range data',
    combatant && combatant['disengaged'] == true && combatant['range'].nil?,
    combatant.inspect
  )
  check(
    'never assessed reports enrichedAgeSeconds as nil, not zero - "unknown" and "just now" must not look the same',
    combatant && combatant['enrichedAgeSeconds'].nil?,
    combatant.inspect
  )
  $creature_room = []

  c.close
ensure
  server.stop
end

puts ''
puts($fails.zero? ? 'all passed' : "#{$fails} FAILED")
exit($fails.zero? ? 0 : 1)
