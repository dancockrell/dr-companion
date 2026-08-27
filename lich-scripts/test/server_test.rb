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

class FakeScript
  def self.current = new
  def path = File.join(TEST_LICH_DIR, 'scripts', 'companion_bridge.lic')
  def self.at_exit(&_blk) = nil
end
Script = FakeScript

$lich_dir = "#{TEST_LICH_DIR}/"

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
def dothistimeout(cmd, _timeout, _regex)
  $dothis_log << cmd
  nil
end

# Load everything except the trailing command-line section, which would start a
# server on the default port and then sleep forever.
src = File.read(SRC)
body = src[/module Companion.*?\n^end\b/m] or abort 'could not find the Companion module'
eval(body, TOPLEVEL_BINDING, SRC)

# ------------------------------------------------------------------ harness --

$fails = 0

def check(label, ok, detail = '')
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}#{detail.to_s.empty? ? '' : ": #{detail}"}"
  $fails += 1 unless ok
  ok
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
PORT = 7893
server = Companion::Server.new(PORT)
abort 'server would not start' unless server.start

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

  c.close
ensure
  server.stop
end

puts ''
puts($fails.zero? ? 'all passed' : "#{$fails} FAILED")
exit($fails.zero? ? 0 : 1)
