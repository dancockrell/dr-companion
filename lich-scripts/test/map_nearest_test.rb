# Tests Companion::MapInfo.nearest and Companion::Intents.map_nearest.
#
#   ruby lich-scripts/test/map_nearest_test.rb lich-scripts/companion_bridge.lic
#
# A separate fixture from map_test.rb's four-room world on purpose: nearest-N
# needs several rooms sharing one tag at different distances to exercise
# ordering and slicing, which the existing world (one bank, one healer) can't
# show. The stub's find_all_nearest_by_tag returns a precomputed, already-
# sorted answer for the fixture rather than re-deriving Dijkstra distances -
# that algorithm is Lich's own and is exercised by Lich's own test suite, not
# this one. What this file checks is what MapInfo/map_nearest do with the
# answer: slicing to `count`, describing each hit, refusing cleanly when
# nothing matches, and not moving the character.

def respond(m) = warn("[lich] #{m}")

SRC = ARGV[0] or abort 'usage: map_nearest_test.rb <path to companion_bridge.lic>'

# --------------------------------------------------------------- the stub --
#
# A star: room 1 is home, with three banks at increasing distance and one
# healer next door.
#
#   1 -- 2 (bank, 1 hop) -- 3 (bank, 2 hops) -- 4 (bank, 3 hops)
#   1 -- 5 (healer, 1 hop)

class StubRoom
  attr_reader :id, :uid, :title, :location, :tags

  def initialize(id, uid, title, location, tags)
    @id = id
    @uid = [uid]
    @title = ["[#{title}]"]
    @location = location
    @tags = tags
  end

  def path_to(dest) = StubMap.route(@id, dest.to_i)
  def find_all_nearest_by_tag(tag) = StubMap.nearest_order(@id, tag)
end

module StubMap
  ROUTES = {
    [1, 2] => [2],
    [1, 3] => [2, 3],
    [1, 4] => [2, 3, 4],
    [1, 5] => [5]
  }.freeze

  # Precomputed, already in distance order - see the file header for why this
  # is not re-derived from ROUTES.
  NEAREST = {
    [1, 'bank'] => [2, 3, 4],
    [1, 'healer'] => [5],
    [1, 'temple'] => []
  }.freeze

  def self.list
    @list ||= begin
      rooms = [
        StubRoom.new(1, 9001, 'Home', 'Crossing', []),
        StubRoom.new(2, 9002, 'Near Bank', 'Crossing', ['bank']),
        StubRoom.new(3, 9003, 'Mid Bank', 'Crossing', ['bank']),
        StubRoom.new(4, 9004, 'Far Bank', 'Crossing', ['bank']),
        StubRoom.new(5, 9005, 'Healer', 'Crossing', ['healer'])
      ]
      arr = [nil]
      rooms.each { |r| arr[r.id] = r }
      arr
    end
  end

  def self.route(from, to) = ROUTES[[from, to]]
  def self.nearest_order(from, tag) = NEAREST[[from, tag]] || []
  def self.[](id) = list[id]
  def self.current = list[1]
end

# Load the module under test - the whole Companion module, same slice trick
# as map_test.rb and map_walk_test.rb.
src = File.read(SRC, encoding: 'UTF-8')
body = src[/module Companion.*?\n^end\b/m] or abort 'could not find the Companion module'
eval(body, TOPLEVEL_BINDING, SRC)

Companion::MapInfo.define_singleton_method(:klass) { StubMap }

M = Companion::MapInfo
I = Companion::Intents

class FakeServer
  attr_reader :broadcasts

  def initialize
    @broadcasts = []
  end

  def broadcast(**kw) = @broadcasts << kw
  def log(*); end
end

# ------------------------------------------------------------------ checks --

fails = 0

def check(label, ok, detail = '')
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}#{detail.to_s.empty? ? '' : ": #{detail}"}"
  ok
end

puts '-- MapInfo.nearest: the closest one, by default --'
one = M.nearest('bank')
fails += 1 unless check('ok', one['ok'] == true, one.inspect[0, 80])
fails += 1 unless check('the tag is echoed back', one['tag'] == 'bank')
fails += 1 unless check('from here', one['from'] == 1)
fails += 1 unless check('exactly one, the closest', one['rooms'].map { |r| r['id'] } == [2], one['rooms'].inspect)
fails += 1 unless check('names the room', one['rooms'].first['title'] == 'Near Bank', one['rooms'].first.inspect)
fails += 1 unless check('carries both ids', one['rooms'].first['uid'] == 9002)
fails += 1 unless check('reports the hop count', one['rooms'].first['steps'] == 1, one['rooms'].first['steps'].inspect)

puts ''
puts '-- asking for more than one, in distance order --'
three = M.nearest('bank', 3)
fails += 1 unless check(
  'all three, nearest first',
  three['rooms'].map { |r| r['id'] } == [2, 3, 4],
  three['rooms'].map { |r| r['id'] }.inspect
)
fails += 1 unless check(
  'hop counts increase with distance',
  three['rooms'].map { |r| r['steps'] } == [1, 2, 3],
  three['rooms'].map { |r| r['steps'] }.inspect
)

puts ''
puts '-- asking for more than exist: slices, does not pad or fail --'
over = M.nearest('healer', 5)
fails += 1 unless check('ok', over['ok'] == true)
fails += 1 unless check('just the one that exists', over['rooms'].map { |r| r['id'] } == [5])

puts ''
puts '-- a count of zero or less is treated as at least one --'
zero = M.nearest('bank', 0)
fails += 1 unless check('at least one comes back', zero['rooms'].length == 1, zero['rooms'].inspect)

puts ''
puts '-- nothing tagged that way is a clean refusal, not an empty success --'
none = M.nearest('temple')
fails += 1 unless check('refused', none['ok'] == false, none.inspect)
fails += 1 unless check('names the tag', none['reason'].to_s.include?('temple'), none['reason'])

puts ''
puts '-- no tag given is refused, not treated as "everything" --'
blank = M.nearest('')
fails += 1 unless check('refused', blank['ok'] == false, blank['reason'])
nada = M.nearest(nil)
fails += 1 unless check('nil is refused the same way', nada['ok'] == false, nada['reason'])

puts ''
puts '-- with no map at all, nothing pretends to be an answer --'
Companion::MapInfo.define_singleton_method(:klass) { nil }
fails += 1 unless check('not available', M.available? == false)
Companion::MapInfo.define_singleton_method(:klass) { StubMap }

puts ''
puts '-- the intent: broadcasts the result, never moves anyone --'
server = FakeServer.new
r = I.map_nearest({ 'tag' => 'bank', 'count' => 2 }, server)
fails += 1 unless check('ok', r[0] == true, r[1])
fails += 1 unless check('says how many', r[1].to_s.include?('2'), r[1])
fails += 1 unless check(
  'broadcasts the full result for the client to draw',
  server.broadcasts.any? { |b| b[:type] == 'map_nearest' && b[:payload]['rooms'].length == 2 },
  server.broadcasts.inspect
)

puts ''
puts '-- the intent accepts a bare tag too, same as map_path\'s bare form --'
r2 = I.map_nearest('healer', FakeServer.new)
fails += 1 unless check('ok', r2[0] == true, r2[1])

puts ''
puts '-- the intent refuses cleanly when nothing matches --'
r3 = I.map_nearest({ 'tag' => 'temple' }, FakeServer.new)
fails += 1 unless check('refused', r3[0] == false, r3[1])
fails += 1 unless check('names the tag', r3[1].to_s.include?('temple'), r3[1])

puts ''
puts(fails.zero? ? 'all passed' : "#{fails} FAILED")
exit(fails.zero? ? 0 : 1)
