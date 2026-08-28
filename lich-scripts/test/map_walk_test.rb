# Tests Companion::Intents.map_walk against stand-ins for Lich's Map and
# Script.
#
#   ruby lich-scripts/test/map_walk_test.rb lich-scripts/companion_bridge.lic
#
# map_walk is the one intent in this file that actually moves the character -
# added at Dan's explicit instruction ("when you click on a location on the
# map, you go there using lich"), reversing this panel's original "not a
# travel control" design. It does that by starting Lich's own go2 script
# rather than reimplementing movement, so what needs testing here is the
# decision logic around that: which of the read-only guards fire, and that
# Script.start is (or is not) actually called with the right arguments -
# never just that a message came back, which a broken guard could produce by
# accident. See map_test.rb for the read-only map queries this shares
# MapInfo with.

def respond(m) = warn("[lich] #{m}")

SRC = ARGV[0] or abort 'usage: map_walk_test.rb <path to companion_bridge.lic>'

# --------------------------------------------------------------- the stub --

class FakeRoom
  attr_reader :id

  def initialize(id)
    @id = id
  end

  def path_to(dest) = StubMap.routes[[@id, dest]]
end

module StubMap
  class << self
    attr_accessor :current_room, :routes
  end
  self.routes = {}

  def self.current = current_room
end

# A minimal stand-in for Lich's Script class. Tracks what was asked of it
# rather than doing anything - the whole point of this test is to check the
# guards decide correctly, not to actually run a script.
module FakeScriptRegistry
  class << self
    attr_accessor :installed, :running_names, :start_calls, :start_result
  end
  self.installed = {}
  self.running_names = []
  self.start_calls = []
  self.start_result = true

  def self.reset!
    self.installed = {}
    self.running_names = []
    self.start_calls = []
    self.start_result = true
  end
end

RunningScript = Struct.new(:name)

class Script
  def self.exists?(name) = FakeScriptRegistry.installed.fetch(name, false)
  def self.running = FakeScriptRegistry.running_names.map { |n| RunningScript.new(n) }

  def self.start(name, *args)
    FakeScriptRegistry.start_calls << [name, args]
    FakeScriptRegistry.start_result
  end
end

class FakeServer
  attr_reader :logs

  def initialize
    @logs = []
  end

  def log(msg, level = 'info')
    @logs << [level, msg]
  end

  def broadcast(**_kw); end
end

# Load the module under test. Slice rather than require: the file's tail
# starts a real server on a real port. The slice is the whole Companion
# module - Intents, MapInfo, State and friends are all nested inside it, so
# map_walk's own unqualified `State`/`MapInfo` references resolve correctly
# without needing to be faked themselves.
src = File.read(SRC)
body = src[/module Companion.*?\n^end\b/m] or abort 'could not find the Companion module'
eval(body, TOPLEVEL_BINDING, SRC)

Companion::MapInfo.define_singleton_method(:klass) { StubMap }

I = Companion::Intents

# ------------------------------------------------------------------ checks --

fails = 0

def check(label, ok, detail = '')
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}#{detail.to_s.empty? ? '' : ": #{detail}"}"
  ok
end

def reset!(here_id)
  FakeScriptRegistry.reset!
  StubMap.current_room = FakeRoom.new(here_id)
end

puts '-- refused before Script is ever touched --'

reset!(1)
r = I.map_walk(0, FakeServer.new)
fails += 1 unless check('no destination given', r[0] == false, r[1])
fails += 1 unless check('Script.start was never called', FakeScriptRegistry.start_calls.empty?)

reset!(1)
StubMap.current_room = nil
r = I.map_walk(5, FakeServer.new)
fails += 1 unless check('no current room known', r[0] == false, r[1])

reset!(1)
StubMap.routes[[1, 99]] = nil
r = I.map_walk(99, FakeServer.new)
fails += 1 unless check('no route to the destination', r[0] == false, r[1])
fails += 1 unless check('names the destination', r[1].to_s.include?('99'), r[1])
fails += 1 unless check('Script.start was never called', FakeScriptRegistry.start_calls.empty?)

puts ''
puts '-- already there is answered without touching go2 --'
reset!(7)
r = I.map_walk(7, FakeServer.new)
fails += 1 unless check('ok, and says so', r == [true, 'already there'], r.inspect)
fails += 1 unless check('Script.start was never called', FakeScriptRegistry.start_calls.empty?)

puts ''
puts '-- a real trip, but go2 is not installed --'
reset!(1)
StubMap.routes[[1, 4]] = [3, 4]
r = I.map_walk(4, FakeServer.new)
fails += 1 unless check('refused', r[0] == false, r[1])
fails += 1 unless check('says go2, not a generic failure', r[1].to_s.include?('go2'), r[1])
fails += 1 unless check('Script.start was never called', FakeScriptRegistry.start_calls.empty?)

puts ''
puts '-- go2 is already running: refused rather than started twice --'
reset!(1)
StubMap.routes[[1, 4]] = [3, 4]
FakeScriptRegistry.installed['go2'] = true
FakeScriptRegistry.running_names = ['go2']
r = I.map_walk(4, FakeServer.new)
fails += 1 unless check('refused', r[0] == false, r[1])
fails += 1 unless check('names why', r[1].to_s.include?('already traveling'), r[1])
fails += 1 unless check('Script.start was never called', FakeScriptRegistry.start_calls.empty?)

puts ''
puts '-- Script.start refusing is reported, not swallowed --'
reset!(1)
StubMap.routes[[1, 4]] = [3, 4]
FakeScriptRegistry.installed['go2'] = true
FakeScriptRegistry.start_result = false
r = I.map_walk(4, FakeServer.new)
fails += 1 unless check('refused', r[0] == false, r[1])
fails += 1 unless check(
  'Script.start really was attempted (sabotage reaches the line)',
  FakeScriptRegistry.start_calls == [['go2', ['4']]],
  FakeScriptRegistry.start_calls.inspect
)

puts ''
puts '-- the happy path: go2 is actually started, with the room number --'
server = FakeServer.new
reset!(1)
StubMap.routes[[1, 4]] = [3, 4]
FakeScriptRegistry.installed['go2'] = true
r = I.map_walk(4, server)
fails += 1 unless check('ok', r[0] == true, r[1])
fails += 1 unless check('reports the hop count', r[1].to_s.include?('2'), r[1])
fails += 1 unless check(
  'go2 started with the destination room as a bare string, its own "just go" form',
  FakeScriptRegistry.start_calls == [['go2', ['4']]],
  FakeScriptRegistry.start_calls.inspect
)
fails += 1 unless check('logged what it did', server.logs.any? { |_, m| m.include?('go2') }, server.logs.inspect)

puts ''
puts '-- args can arrive as a hash, same as map_path --'
reset!(1)
StubMap.routes[[1, 4]] = [3, 4]
FakeScriptRegistry.installed['go2'] = true
r = I.map_walk({ 'to' => 4 }, FakeServer.new)
fails += 1 unless check('ok', r[0] == true, r[1])
fails += 1 unless check(
  'the hash form reaches Script.start the same as the bare form',
  FakeScriptRegistry.start_calls == [['go2', ['4']]],
  FakeScriptRegistry.start_calls.inspect
)

puts ''
puts(fails.zero? ? 'all passed' : "#{fails} FAILED")
exit(fails.zero? ? 0 : 1)
