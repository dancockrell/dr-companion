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

SRC = ARGV[0] or abort 'usage: server_test.rb <path to companion_bridge.lic>'

# ---------------------------------------------------------------- Lich stubs --
#
# Only what the script touches at load and while serving. Everything the bridge
# reads goes through State.safe, so absent globals are already handled; these
# exist so the status payload has something recognisable in it.

$respond_log = []
def respond(m) = $respond_log << m.to_s

LICH_VERSION = '5.20.1'

class FakeScript
  def self.current = new
  def path = 'C:/Ruby4Lich5/Lich5/scripts/companion_bridge.lic'
  def self.at_exit(&_blk) = nil
end
Script = FakeScript

$lich_dir = 'C:/Ruby4Lich5/Lich5/'

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

  def initialize(port, path = Companion::PATH)
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
  end

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

  c.close
ensure
  server.stop
end

puts ''
puts($fails.zero? ? 'all passed' : "#{$fails} FAILED")
exit($fails.zero? ? 0 : 1)
