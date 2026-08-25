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
  attr_reader :id, :uid, :title, :location, :climate, :terrain, :tags, :wayto

  def initialize(id, uid, title, location, tags, wayto)
    @id = id
    # Lich stores these as arrays and uses the last entry.
    @uid = [uid]
    @title = ["[#{title}]"]
    @location = location
    @climate = 'temperate'
    @terrain = 'stone'
    @tags = tags
    @wayto = wayto
  end

  def path_to(dest)
    StubMap.route(@id, dest.to_i)
  end

  def find_nearest_by_tag(tag)
    StubMap.list.values.find { |r| r.tags.include?(tag) }&.id
  end
end

module StubMap
  ROUTES = {
    [1, 2] => [2],
    [1, 4] => [3, 4],
    [1, 3] => [3],
    [3, 4] => [4]
  }.freeze

  def self.list
    @list ||= {
      1 => StubRoom.new(1, 9001, 'Town Square', 'Crossing', [], { 2 => 'east', 3 => 'south' }),
      2 => StubRoom.new(2, 9002, 'Bank Lobby', 'Crossing', ['bank'], { 1 => 'west' }),
      3 => StubRoom.new(3, 9003, 'Wide Road', 'Crossing', [], { 1 => 'north', 4 => 'east' }),
      4 => StubRoom.new(4, 9004, 'Empath Clinic', 'Crossing', ['healer'], { 3 => 'west' })
    }
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
puts '-- the tag vocabulary comes from the map, not from us --'
fails += 1 unless check('tags read through', M.tags == %w[bank healer], M.tags.inspect)

puts ''
puts '-- nearest tagged room, with the distance --'
n = M.nearest('bank')
fails += 1 unless check('found', n['ok'] == true, n.inspect[0, 60])
fails += 1 unless check('the right room', n['id'] == 2, n['id'].inspect)
fails += 1 unless check('carries its uid too', n['uid'] == 9002, n['uid'].inspect)
fails += 1 unless check('and how far', n['steps'] == 1, n['steps'].inspect)

n2 = M.nearest('healer')
fails += 1 unless check('a two-room trip measures 2', n2['steps'] == 2, n2['steps'].inspect)

puts ''
puts '-- an unreachable tag is refused with a reason --'
miss = M.nearest('forge')
fails += 1 unless check('not ok', miss['ok'] == false)
fails += 1 unless check('says why', miss['reason'].to_s.include?('forge'), miss['reason'])

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
puts '-- with no map at all, nothing pretends to be an answer --'
Companion::MapInfo.define_singleton_method(:klass) { nil }
fails += 1 unless check('not available', M.available? == false)
fails += 1 unless check('here reports unavailable', M.here['available'] == false)
fails += 1 unless check('tags is empty, not fabricated', M.tags == [])

puts ''
puts(fails.zero? ? 'all passed' : "#{fails} FAILED")
exit(fails.zero? ? 0 : 1)
