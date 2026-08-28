# Tests Companion::MapInfo against a stand-in for Lich's Map.
#
#   ruby lich-scripts/test/map_test.rb lich-scripts/companion_bridge.lic
#
# The panel needs geography it does not own. Lich already holds a room graph
# with Dijkstra pathing, a tag index and uid translation, so the job here is to
# ask it correctly rather than to reimplement any of that.
#
# The stub mirrors the parts of Lich::Common::Map this module touches: id vs
# uid, title as an array, wayto, tags, path_to and find_nearest_by_tag. Two
# things are worth being strict about and both are tested below.
#
#   * id and uid are different numbers for the same room. Lich's id is what
#     #goto takes; uid is the game's own room id, the one ShowRoomID prints.
#     Quoting one when you mean the other is a known way to lose an afternoon,
#     so both must survive to the panel, labelled.
#   * "no map loaded" and "nothing found" must not look alike. A panel that
#     says "no bank nearby" when it means "I cannot see a map" sends someone
#     hunting for a bank that is already on their map.

def respond(m) = warn("[lich] #{m}")

SRC = ARGV[0] or abort 'usage: map_test.rb <path to companion_bridge.lic>'

# --------------------------------------------------------------- the stub --
#
# A tiny four-room world:
#
#   1 (Town Square) -- 2 (Bank Lobby, tagged bank)
#   |
#   3 (Road) -- 4 (Healer, tagged healer)

class StubRoom
  attr_reader :id, :uid, :title, :location, :climate, :terrain, :tags, :wayto,
              :genie_zone, :genie_id, :genie_pos

  def initialize(id, uid, title, location, tags, wayto, zone = '1', pos = nil)
    @id = id
    # Lich stores these as arrays and uses the last entry.
    @uid = [uid]
    @title = ["[#{title}]"]
    @location = location
    @climate = 'temperate'
    @terrain = 'stone'
    @tags = tags
    @wayto = wayto
    # The layout the community's cartographers built, which Lich carries per
    # room keyed to its own ids. Coordinates are what make a map drawable.
    @genie_zone = zone
    @genie_id = id.to_s
    @genie_pos = pos || { 'x' => id * 20, 'y' => 0, 'z' => 0 }
  end

  def path_to(dest)
    StubMap.route(@id, dest.to_i)
  end

  def find_nearest_by_tag(tag)
    StubMap.list.compact.find { |r| r.tags.include?(tag) }&.id
  end
end

module StubMap
  ROUTES = {
    [1, 2] => [2],
    [1, 4] => [3, 4],
    [1, 3] => [3],
    [3, 4] => [4]
  }.freeze

  # Rooms 1-3 are zone "1"; room 4 sits in zone "2", so the zone query has
  # something to correctly leave out. Coordinates are zone-local in the real
  # data, which is exactly why zones must not share a canvas.
  #
  # `list` is an **Array indexed by room id**, with a nil at 0, because that is
  # what Lich's Map is. An earlier version of this stub returned a Hash, which
  # made `list.compact.select` yield [key, value] pairs instead of rooms and
  # failed the zone tests. The code was right and the stub was lying — which is
  # the only bug a stub can have that is worse than no stub at all.
  def self.list
    @list ||= begin
      rooms = [
        StubRoom.new(1, 9001, 'Town Square', 'Crossing', [], { 2 => 'east', 3 => 'south' }),
        StubRoom.new(2, 9002, 'Bank Lobby', 'Crossing', ['bank'], { 1 => 'west' }),
        StubRoom.new(3, 9003, 'Wide Road', 'Crossing', [], { 1 => 'north', 4 => 'east' }),
        StubRoom.new(4, 9004, 'Empath Clinic', 'Outskirts', ['healer'], { 3 => 'west' }, '2')
      ]
      arr = [nil]
      rooms.each { |r| arr[r.id] = r }
      arr
    end
  end

  def self.route(from, to) = ROUTES[[from, to]]
  def self.[](id) = list[id]
  def self.current = list[1]
  def self.tags = %w[healer bank]
end

# Load the module under test. Slice rather than require: the file's tail starts
# a real server on a real port.
src = File.read(SRC)
body = src[/module Companion.*?\n^end\b/m] or abort 'could not find the Companion module'
eval(body, TOPLEVEL_BINDING, SRC)

# MapInfo resolves Lich's class at call time, which is what lets it be swapped
# here — and is also why it does not explode outside Lich.
Companion::MapInfo.define_singleton_method(:klass) { StubMap }

# ------------------------------------------------------------------ checks --

fails = 0

def check(label, ok, detail = '')
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}#{detail.to_s.empty? ? '' : ": #{detail}"}"
  ok
end

M = Companion::MapInfo

puts '-- where we are, in both id systems --'
here = M.here
fails += 1 unless check('reports available', here['available'] == true)
fails += 1 unless check("Lich's room id", here['id'] == 1, here['id'].inspect)
fails += 1 unless check("the game's own uid, separately", here['uid'] == 9001, here['uid'].inspect)
fails += 1 unless check('id and uid are not confused', here['id'] != here['uid'])
fails += 1 unless check(
  'title has the brackets stripped',
  here['title'] == 'Town Square',
  here['title'].inspect
)
fails += 1 unless check('exits are listed', here['exits'].sort == %w[2 3], here['exits'].inspect)

puts ''
puts '-- a route is returned, room by room --'
p1 = M.preview_path(4)
fails += 1 unless check('ok', p1['ok'] == true, p1.inspect[0, 60])
fails += 1 unless check('from here', p1['from'] == 1, p1['from'].inspect)
fails += 1 unless check('step count', p1['steps'] == 2, p1['steps'].inspect)
fails += 1 unless check(
  'each room named',
  p1['rooms'].map { |r| r['title'] } == ['Wide Road', 'Empath Clinic'],
  p1['rooms'].map { |r| r['title'] }.inspect
)
fails += 1 unless check(
  'each room carries both ids',
  p1['rooms'].all? { |r| r['id'] && r['uid'] },
  p1['rooms'].inspect[0, 80]
)

puts ''
puts '-- a route that does not exist says so --'
none = M.preview_path(99)
fails += 1 unless check('refused', none['ok'] == false)
fails += 1 unless check('names both ends', none['reason'].to_s.include?('99'), none['reason'])
fails += 1 unless check('a missing destination is refused too',
                        M.preview_path(nil)['ok'] == false)

puts ''
puts '-- a zone, laid out well enough to draw --'
z = M.zone
fails += 1 unless check('ok', z['ok'] == true, z.inspect[0, 60])
fails += 1 unless check('knows which zone', z['zone'] == '1', z['zone'].inspect)
fails += 1 unless check('marks where we are', z['here'] == 1, z['here'].inspect)
fails += 1 unless check('only this zone', z['rooms'].length == 3, z['rooms'].length.to_s)
fails += 1 unless check(
  'a room from another zone is excluded',
  z['rooms'].none? { |r| r['id'] == 4 },
  z['rooms'].map { |r| r['id'] }.inspect
)
fails += 1 unless check(
  'coordinates survive, which is what makes it drawable',
  z['rooms'].all? { |r| !r['x'].nil? && !r['y'].nil? },
  z['rooms'].map { |r| [r['x'], r['y']] }.inspect
)
fails += 1 unless check(
  'exits are Lich room ids, not direction words',
  z['rooms'].find { |r| r['id'] == 1 }['to'].sort == [2, 3],
  z['rooms'].find { |r| r['id'] == 1 }['to'].inspect
)
fails += 1 unless check('nothing was capped', z['truncated'] == false)

puts ''
puts '-- capping is reported, never silent --'
capped = M.zone(nil, 2)
fails += 1 unless check('fewer rooms returned', capped['rooms'].length == 2)
fails += 1 unless check('says so', capped['truncated'] == true)
fails += 1 unless check('and says out of how many', capped['total'] == 3, capped['total'].inspect)

puts ''
puts '-- a zone that does not exist is refused --'
fails += 1 unless check('refused', M.zone('nowhere')['ok'] == false)

puts ''
puts '-- with no map at all, nothing pretends to be an answer --'
Companion::MapInfo.define_singleton_method(:klass) { nil }
fails += 1 unless check('not available', M.available? == false)
fails += 1 unless check('here reports unavailable', M.here['available'] == false)

puts ''
puts "-- genie_pos comes as a string in Lich's real map database --"

# The shape that actually ships, and the one that was silently dropped.
#
# Lich's downloaded map database stores position as comma-separated text
# ("360,460,0"), not a Hash or an Array. `coords` handled the other two and
# returned [nil, nil, nil] for this, so every room lost its coordinates and the
# map rendered "No rooms with coordinates on this level" while still reporting
# the correct zone name and room count - because those do not pass through
# here. Measured against the real file: 18,784 rooms, 14,639 with genie_pos,
# The Crossing holding 896 of them with a position on every one.
#
# Asserted as the property - a room with a position keeps it - rather than
# against the parsing mechanism, so a rewrite of `coords` still has to satisfy
# it.
C = Companion::MapInfo
fails += 1 unless check('a "x,y,z" string yields real coordinates',
                        C.send(:coords, '360,460,0') == [360, 460, 0],
                        C.send(:coords, '360,460,0').inspect)
fails += 1 unless check('whitespace around the numbers is tolerated',
                        C.send(:coords, ' 12 , -3 , 1 ') == [12, -3, 1],
                        C.send(:coords, ' 12 , -3 , 1 ').inspect)
fails += 1 unless check('a negative coordinate survives',
                        C.send(:coords, '-40,-80,0') == [-40, -80, 0],
                        C.send(:coords, '-40,-80,0').inspect)

# The two shapes that already worked must keep working - this adds a case, it
# does not replace them.
fails += 1 unless check('a hash still works',
                        C.send(:coords, { 'x' => 1, 'y' => 2, 'z' => 3 }) == [1, 2, 3])
fails += 1 unless check('an array still works',
                        C.send(:coords, [4, 5, 6]) == [4, 5, 6])

# Unparseable must stay nil rather than becoming 0. `to_i` on junk is 0, which
# would pile every unreadable room at the origin - visibly wrong data rather
# than an honest absence, and harder to notice than an empty map.
fails += 1 unless check('junk is nil, not 0',
                        C.send(:coords, 'somewhere,over,there') == [nil, nil, nil],
                        C.send(:coords, 'somewhere,over,there').inspect)
fails += 1 unless check('a short string leaves z absent rather than guessing 0',
                        C.send(:coords, '10,20') == [10, 20, nil],
                        C.send(:coords, '10,20').inspect)
fails += 1 unless check('nil is still nil', C.send(:coords, nil) == [nil, nil, nil])

puts ''
puts(fails.zero? ? 'all passed' : "#{fails} FAILED")
exit(fails.zero? ? 0 : 1)
