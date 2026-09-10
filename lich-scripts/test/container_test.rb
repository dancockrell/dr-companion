# Tests Companion::State.containers — the container counts the app reads back.
#
#   ruby lich-scripts/test/container_test.rb lich-scripts/companion_bridge.lic
#
# The property under test is one sentence, and it is the one the old code
# could not pass: **a full bag and an empty bag read differently, and a bag
# nobody has opened reads as neither.**
#
# What was here before called `DRCI.get_worn_containers`, a method that exists
# nowhere in Lich or dr-scripts, and mapped its result to a literal
# `{'used' => 0, 'capacity' => 0}`. Both halves failed silently: the call
# raised NoMethodError into `safe([])` so the list was always empty on a live
# bridge, and on anything that did reach the map every container reported the
# same constant. A test that only asserted "containers is an Array" passed
# against both.
#
# So the fixture below deliberately contains all three cases at once. A
# container detector that cannot tell them apart fails here rather than
# reporting a plausible zero — the population has the wrong answer available
# in it, which is the only way a check on a discriminator means anything.

def respond(m) = warn("[lich] #{m}")

SRC = ARGV[0] or abort 'usage: container_test.rb <path to companion_bridge.lic>'

# ---------------------------------------------------------------- the stub --
#
# Lich's real shape, not a convenient one:
#
#   GameObj.inv         top-level carried items, each with an id and a name
#   GameObj.containers  { container id => [contained GameObj, ...] }
#
# The second is filled from the game's own `<inv id='...'>` blocks and holds
# a key **only** for containers the game has described this session. A worn
# backpack nobody has opened has no key at all, and Lich deletes a key when
# the game says the container closed. That absence is the "unknown" this
# whole increment is about, so the fixture models it exactly: `satchel` is
# carried and has no entry.

Thing = Struct.new(:id, :name)

FULL_BAG   = [Thing.new('301', 'a steel dagger'), Thing.new('302', 'some rope'), Thing.new('303', 'a brass lantern')].freeze
EMPTY_PACK = [].freeze

module StubGameObj
  CARRIED = [
    Thing.new('101', 'a leather backpack'), # 3 items
    Thing.new('102', 'a canvas haversack'), # empty
    Thing.new('103', 'a silk satchel'),     # never opened - no entry at all
    Thing.new('104', 'a broadsword')        # not a container
  ].freeze

  CONTENTS = {
    '101' => FULL_BAG,
    '102' => EMPTY_PACK
  }.freeze

  def self.inv = CARRIED
  def self.containers = CONTENTS
  def self.right_hand = Thing.new(nil, nil)
  def self.left_hand = Thing.new(nil, nil)
end

# Load the module under test - the same slice trick map_test.rb uses.
src = File.read(SRC, encoding: 'UTF-8')
body = src[/module Companion.*?\n^end\b/m] or abort 'could not find the Companion module'
eval(body, TOPLEVEL_BINDING, SRC)

Object.const_set(:GameObj, StubGameObj) unless Object.const_defined?(:GameObj)

S = Companion::State

# ------------------------------------------------------------------ checks --

def check(label, ok, detail = '')
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}#{detail.to_s.empty? ? '' : ": #{detail}"}"
  ok
end

def record(label, ok, detail = '')
  $checked += 1
  $fails += 1 unless check(label, ok, detail)
end

$fails = 0
$checked = 0

S.reset_degraded!
list = S.containers
by_name = list.each_with_object({}) { |c, h| h[c['name']] = c }

puts '-- only real containers are reported at all --'
record('a plain weapon is not a container', !by_name.key?('a broadsword'), by_name.keys.inspect)
record(
  'a carried container Lich has no contents for is left out, not zeroed',
  !by_name.key?('a silk satchel'),
  by_name.keys.inspect
)
record('the two Lich does know are both present', by_name.key?('a leather backpack') && by_name.key?('a canvas haversack'), by_name.keys.inspect)

puts ''
puts '-- THE CHECK: a full bag and an empty bag read differently --'
full = by_name['a leather backpack']
empty = by_name['a canvas haversack']
record('the full bag has a used count at all', full && full.key?('used'), full.inspect)
record('the empty bag has a used count at all', empty && empty.key?('used'), empty.inspect)
record('the full bag counts three', full && full['used'] == 3, full && full['used'].inspect)
record('the empty bag counts zero', empty && empty['used'] == 0, empty && empty['used'].inspect)
record(
  'and the two are not the same number - the property the old constant could not have',
  full && empty && full['used'] != empty['used'],
  "full=#{full && full['used']} empty=#{empty && empty['used']}"
)

puts ''
puts '-- the names come back too, so the count can be checked against something --'
record('the full bag lists its three items', full && full['items'].sort == ['a brass lantern', 'a steel dagger', 'some rope'], full && full['items'].inspect)
record('the empty bag lists nothing', empty && empty['items'] == [], empty && empty['items'].inspect)
record('used agrees with the item list it was derived from', full && full['used'] == full['items'].length)

puts ''
puts '-- capacity is honestly absent, not invented --'
record('capacity is the not-reported sentinel', full && full['capacity'] == 0, full && full['capacity'].inspect)
record('and it is never a guess above zero', list.all? { |c| c['capacity'] == 0 }, list.map { |c| c['capacity'] }.inspect)

puts ''
puts '-- the payload carries it, so this is not a check on a private method --'
S.reset_degraded!
payload = S.inventory
record('inventory sends the containers', payload['containers'].length == 2, payload['containers'].inspect[0, 120])
record(
  'and the full/empty distinction survives the trip',
  payload['containers'].map { |c| c['used'] }.sort == [0, 3],
  payload['containers'].map { |c| c['used'] }.inspect
)
record('no field failed to read while building it', payload['degraded'].nil?, payload['degraded'].inspect)

puts ''
# The denominator, asserted rather than printed. If the eval above ever
# stopped producing a working State, every `record` would vanish and the run
# would end on "0 checked, 0 failed" - which reads exactly like a pass.
record('a whole-run guard: this file checked a real number of things', $checked >= 15, "#{$checked} checks")

puts ''
puts "#{$checked} checked, #{$fails} failed"
puts($fails.zero? ? 'all passed' : "#{$fails} FAILED")
exit($fails.zero? ? 0 : 1)
