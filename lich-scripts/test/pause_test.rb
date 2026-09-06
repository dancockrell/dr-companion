# Tests the Pause latch: that Pause reaches travel, macros and script starts,
# that it suspends a route already under way, and that Resume continues it.
#
#   ruby lich-scripts/test/pause_test.rb lich-scripts/companion_bridge.lic
#
# Issue #462. `pause_all` iterates `Script.running` at the moment it is called,
# so it can suspend a walker that is already going and can say nothing about
# one started afterwards. `map_walk` starts `go2` as its own Lich script, and
# it is a bridge intent, so the Rust command lane never sees it either: pressing
# Pause and then clicking a distant tile walked the character across a zone
# while both halves of the app believed automation was held.
#
# What is checked here is therefore both halves of Pause, because they fail
# independently:
#
#   the latch    - a *new* map_walk / run_macro / start_script is refused
#   the snapshot - a go2 *already running* is suspended and takes no more steps
#
# The walker below is a stand-in for that second half rather than a mock of
# Lich: it advances a room only when it is not paused, which is the behaviour
# `Script.current`'s `sleep 0.2 while script.paused?`
# (Lich lib/common/script.rb:1026) produces for a real go2. Asserting "no
# further room change events" against it is the same proposition as "the
# character stopped walking", stated where a test can see it.

def respond(m) = warn("[lich] #{m}")

SRC = ARGV[0] or abort 'usage: pause_test.rb <path to companion_bridge.lic>'

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

# A script that walks. It steps one room per tick unless it is paused or has
# been killed, which is the only property of a real go2 this test needs.
class FakeWalker
  attr_reader :name, :rooms_visited

  def initialize(name)
    @name = name
    @paused = false
    @alive = true
    @rooms_visited = []
  end

  def pause = @paused = true
  def unpause = @paused = false
  def paused? = @paused
  def alive? = @alive
  def kill
    @alive = false
  end

  # One tick of the route. Records a room only when it actually moved.
  def tick(room)
    return if @paused || !@alive

    @rooms_visited << room
  end
end

module FakeScriptRegistry
  class << self
    attr_accessor :installed, :running, :start_calls, :start_result, :killed
  end

  def self.reset!
    self.installed = {}
    self.running = []
    self.start_calls = []
    self.start_result = true
    self.killed = []
  end
  reset!

  def self.find(name)
    running.find { |s| s.name.casecmp?(name.to_s) }
  end
end

class Script
  def self.current = FakeWalker.new('companion_bridge')
  def self.exists?(name) = FakeScriptRegistry.installed.fetch(name, false)
  def self.running = FakeScriptRegistry.running

  def self.start(name, *args)
    FakeScriptRegistry.start_calls << [name, args]
    FakeScriptRegistry.running << FakeWalker.new(name) if FakeScriptRegistry.start_result
    FakeScriptRegistry.start_result
  end

  # Lich's own Script.pause/unpause find by name and act on the instance:
  # lib/common/script.rb:1318 and :1333.
  def self.pause(name)
    s = FakeScriptRegistry.find(name) or return false
    s.pause
    true
  end

  def self.unpause(name)
    s = FakeScriptRegistry.find(name) or return false
    s.unpause
    true
  end

  # Lich's Script.kill matches by name regardless of paused state
  # (lib/common/script.rb:1358), which is why Stop cancels a paused route.
  def self.kill(name)
    s = FakeScriptRegistry.find(name) or return false
    s.kill
    FakeScriptRegistry.running.delete(s)
    FakeScriptRegistry.killed << name
    true
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

src = File.read(SRC, encoding: 'UTF-8')
body = src[/module Companion.*?\n^end\b/m] or abort 'could not find the Companion module'
eval(body, TOPLEVEL_BINDING, SRC)

Companion::MapInfo.define_singleton_method(:klass) { StubMap }

I = Companion::Intents

# run_macro sends real game commands through Cmd.exec. Recorded rather than
# sent, so "the macro was held" is observable instead of inferred from the
# return value - a run_macro that returned a refusal and had already sent its
# commands would pass a check that only read the reply.
SENT = []
Companion::Cmd.define_singleton_method(:exec) do |command, **_kw|
  SENT << command.to_s
  nil
end

# start_script asks State.other_scripts whether the script is already running.
Companion::State.define_singleton_method(:other_scripts) { [] }

# ------------------------------------------------------------------ checks --

fails = 0

def check(label, ok, detail = '')
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}#{detail.to_s.empty? ? '' : ": #{detail}"}"
  ok
end

def reset!(here_id = 1)
  FakeScriptRegistry.reset!
  SENT.clear
  StubMap.current_room = FakeRoom.new(here_id)
  StubMap.routes[[here_id, 4]] = [3, 4]
  FakeScriptRegistry.installed['go2'] = true
  FakeScriptRegistry.installed['hunting'] = true
  I.clear_stop!
  I.clear_pause!
end

puts '-- the control: none of these is refused when nothing is latched --'
# The denominator. Every refusal below means something only because these
# succeed with the same fixture and the same arguments.
reset!
r = I.map_walk(4, FakeServer.new)
fails += 1 unless check('map_walk walks', r[0] == true, r[1])
fails += 1 unless check('go2 was started', FakeScriptRegistry.start_calls == [['go2', ['4']]],
                        FakeScriptRegistry.start_calls.inspect)

reset!
r = I.run_macro({ 'commands' => %w[stand north] }, FakeServer.new)
fails += 1 unless check('run_macro runs', r[0] == true, r[1])
fails += 1 unless check('and really sent the commands', SENT == %w[stand north], SENT.inspect)

reset!
r = I.start_script({ 'name' => 'hunting' }, FakeServer.new)
fails += 1 unless check('start_script starts', r[0] == true, r[1])
fails += 1 unless check('the script was started', FakeScriptRegistry.start_calls == [['hunting', []]],
                        FakeScriptRegistry.start_calls.inspect)

puts ''
puts '-- pause latches, and the latch is what a later start meets --'
reset!
server = FakeServer.new
I.pause_all(server)
fails += 1 unless check('pause_all latched', I.pause_requested? == true)

r = I.map_walk(4, FakeServer.new)
fails += 1 unless check('map_walk refused while paused', r[0] == false, r[1])
fails += 1 unless check('the refusal says paused', r[1].to_s.downcase.include?('paused'), r[1])
fails += 1 unless check('and names Resume, so the player knows the way out',
                        r[1].to_s.downcase.include?('resume'), r[1])
fails += 1 unless check('go2 was never started', FakeScriptRegistry.start_calls.empty?,
                        FakeScriptRegistry.start_calls.inspect)

r = I.run_macro({ 'commands' => %w[stand north] }, FakeServer.new)
fails += 1 unless check('run_macro refused while paused', r[0] == false, r[1])
fails += 1 unless check('and nothing was sent to the game', SENT.empty?, SENT.inspect)

r = I.start_script({ 'name' => 'hunting' }, FakeServer.new)
fails += 1 unless check('start_script refused while paused', r[0] == false, r[1])
fails += 1 unless check('no script was started', FakeScriptRegistry.start_calls.empty?,
                        FakeScriptRegistry.start_calls.inspect)

puts ''
puts '-- pause mid-route: the walker is suspended and takes no further step --'
reset!
walker = FakeWalker.new('go2')
FakeScriptRegistry.running << walker
walker.tick(2)
before = walker.rooms_visited.dup
fails += 1 unless check('the walker was walking before Pause', before == [2], before.inspect)

I.pause_all(FakeServer.new)
fails += 1 unless check('Lich was asked to pause the walker', walker.paused? == true)
3.times { |i| walker.tick(10 + i) }
fails += 1 unless check('no further room change while paused',
                        walker.rooms_visited == before, walker.rooms_visited.inspect)

puts ''
puts '-- resume continues that route rather than cancelling it --'
# A route paused half way through town is a route the player means to finish,
# and go2 is built for exactly this: it pauses itself and tells the player to
# unpause to continue (go2.lic:2236-2237).
I.resume_all(FakeServer.new)
fails += 1 unless check('the latch cleared', I.pause_requested? == false)
fails += 1 unless check('the walker was unpaused', walker.paused? == false)
fails += 1 unless check('and it is still alive to continue', walker.alive? == true)
walker.tick(5)
fails += 1 unless check('it took its next step after Resume',
                        walker.rooms_visited == [2, 5], walker.rooms_visited.inspect)

# A second walk is still refused while that route is under way, but by the
# pre-existing "already traveling" guard rather than by the latch - which is
# the distinction worth asserting: Resume removed the hold and nothing else.
r = I.map_walk(4, FakeServer.new)
fails += 1 unless check('the refusal after Resume is the already-traveling one, not the latch',
                        r[0] == false && r[1].to_s.include?('already traveling'), r[1])
Script.kill('go2')
r = I.map_walk(4, FakeServer.new)
fails += 1 unless check('and once that route ends, a new walk is accepted again', r[0] == true, r[1])

puts ''
puts '-- Stop while paused cancels the route rather than holding it --'
reset!
walker = FakeWalker.new('go2')
FakeScriptRegistry.running << walker
I.pause_all(FakeServer.new)
fails += 1 unless check('paused first', walker.paused? == true)
I.stop_all(FakeServer.new)
fails += 1 unless check('the paused walker was killed, not left suspended',
                        FakeScriptRegistry.killed.include?('go2'),
                        FakeScriptRegistry.killed.inspect)
fails += 1 unless check('and it is gone from the running list',
                        FakeScriptRegistry.find('go2').nil?)
walker.tick(9)
fails += 1 unless check('a killed walker takes no step', walker.rooms_visited.empty?,
                        walker.rooms_visited.inspect)

puts ''
puts '-- the refusal set is data, and reads as nothing when not paused --'
reset!
fails += 1 unless check('pause_refusal is nil when not paused', I.pause_refusal('map_walk').nil?)
I.request_pause!
Companion::Intents::PAUSE_HELD.each_key do |intent|
  held = I.pause_refusal(intent)
  fails += 1 unless check("#{intent} has its own sentence", held.is_a?(Array) && held[0] == false &&
    held[1].to_s.downcase.include?('resume'), held.inspect)
end
I.clear_pause!

puts ''
puts(fails.zero? ? 'all passed' : "#{fails} FAILED")
exit(fails.zero? ? 0 : 1)
