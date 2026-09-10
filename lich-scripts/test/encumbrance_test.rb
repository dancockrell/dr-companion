# Tests Companion::State's encumbrance rank and derived carried-item count —
# W4, the two numbers that answer "can I pick this up".
#
#   ruby lich-scripts/test/encumbrance_test.rb lich-scripts/companion_bridge.lic
#
# Two properties, and each is a discriminator, so each is checked against a
# population where the wrong answer is available:
#
#   1. **A phrase Lich's ladder knows and one it does not read differently.**
#      `DRStats.encumbrance` is a phrase. Turning it into a rank is only worth
#      doing if an unrecognised phrase comes back as "we could not tell"
#      rather than as rank 0, because rank 0 means *unburdened* — the two are
#      opposite answers to the question this increment exists for. The fixture
#      below therefore carries a real phrase and a bogus one and the test runs
#      the same code over both.
#
#   2. **The item count includes what is inside containers, and is a floor.**
#      DragonRealms never publishes a running total; it only refuses a PUT,
#      STOW or ACCEPT with "would push you over the item limit". So the bridge
#      derives the number, and the fixture is built so that a derivation which
#      forgot container contents, or forgot the hands, or counted a container
#      Lich has no entry for as zero, each produces a different, wrong number
#      that this file names.
#
# The fixture ladder here is a deliberate **subset** of Lich's twelve-entry
# ENC_MAP, not a copy of it. This file has to prove the derivation, not
# reproduce a table; `ruby/lich_stub.rb` carries the full ladder because
# standing in for Lich is that file's whole job.

def respond(m) = warn("[lich] #{m}")

SRC = ARGV[0] or abort 'usage: encumbrance_test.rb <path to companion_bridge.lic>'

# ---------------------------------------------------------------- the stub --

Thing = Struct.new(:id, :name)

FULL_BAG   = [Thing.new('301', 'a steel dagger'), Thing.new('302', 'some rope'), Thing.new('303', 'a brass lantern')].freeze
EMPTY_PACK = [].freeze

# 4 worn things, 3 of them in the full bag, 1 held. The three candidate wrong
# answers are all different numbers, which is the point:
#
#   4  forgot container contents and the hand
#   5  forgot container contents          (4 worn + 1 held)
#   7  forgot the hand                    (4 worn + 3 contents)
#   8  correct                            (4 worn + 3 contents + 1 held)
#
# and a fifth carried container ('a silk satchel') has no entry in the registry
# at all, so any implementation that invents a count for it lands elsewhere
# again.
module StubGameObj
  CARRIED = [
    Thing.new('101', 'a leather backpack'), # 3 items
    Thing.new('102', 'a canvas haversack'), # opened, genuinely empty
    Thing.new('103', 'a silk satchel'),     # never opened - no entry at all
    Thing.new('104', 'a broadsword')        # not a container
  ].freeze

  CONTENTS = {
    '101' => FULL_BAG,
    '102' => EMPTY_PACK,
    # A chest standing in a room. Lich keeps its contents in the same hash and
    # it is not on the character, so a derivation that sums every value in the
    # registry rather than only the carried ones reports 11 instead of 8.
    '900' => [Thing.new('901', 'a rusted helm'), Thing.new('902', 'a mouldy tabard'), Thing.new('903', 'a bent spoon')]
  }.freeze

  def self.inv = CARRIED
  def self.containers = CONTENTS
  def self.right_hand = Thing.new('201', 'a bastard sword')
  def self.left_hand = Thing.new(nil, nil)
end

# The phrase the fake DRStats currently reports, swapped between checks.
$encumbrance_word = 'Somewhat Burdened'

module StubDRStats
  def self.encumbrance = $encumbrance_word
end

module Lich
  module DragonRealms
    ENC_MAP = {
      'None'              => 0,
      'Light Burden'      => 1,
      'Somewhat Burdened' => 2,
      'Burdened'          => 3,
      'Heavy Burden'      => 4
    }.freeze
  end
end

# Load the module under test - the same slice trick container_test.rb uses.
src = File.read(SRC, encoding: 'UTF-8')
body = src[/module Companion.*?\n^end\b/m] or abort 'could not find the Companion module'
eval(body, TOPLEVEL_BINDING, SRC)

Object.const_set(:GameObj, StubGameObj) unless Object.const_defined?(:GameObj)
Object.const_set(:DRStats, StubDRStats) unless Object.const_defined?(:DRStats)

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

puts '-- a phrase on the ladder becomes its rank --'
$encumbrance_word = 'Somewhat Burdened'
S.reset_degraded!
record('a known phrase ranks', S.encumbrance_level == 2, S.encumbrance_level.inspect)
record('and reading it degraded nothing', S.degraded_fields.empty?, S.degraded_fields.inspect)

$encumbrance_word = 'None'
S.reset_degraded!
record('rank 0 is a real rank, not a failure', S.encumbrance_level == 0, S.encumbrance_level.inspect)

$encumbrance_word = 'Heavy Burden'
S.reset_degraded!
record('the top of this fixture ranks too', S.encumbrance_level == 4, S.encumbrance_level.inspect)

puts ''
puts '-- THE CHECK: an unranked phrase is nil, never 0 --'
#
# `0` means unburdened, so returning it for a phrase nobody recognised would
# say "you can definitely pick that up" about a character we know nothing
# about. This is the wrong answer that was available.
$encumbrance_word = 'Light' # not a DragonRealms phrase; the old fixture's word
S.reset_degraded!
unranked = S.encumbrance_level
record('an unrecognised phrase does not rank', unranked.nil?, unranked.inspect)
record('and specifically is not 0', unranked != 0, unranked.inspect)

$encumbrance_word = ''
S.reset_degraded!
record('no phrase at all does not rank either', S.encumbrance_level.nil?, S.encumbrance_level.inspect)

puts ''
puts '-- the scale ceiling comes from the ladder, not from a constant here --'
record('the ceiling is the fixture ladder\'s own max', S.encumbrance_scale_max == 4, S.encumbrance_scale_max.inspect)

puts ''
puts '-- THE OTHER CHECK: the count reaches inside containers --'
S.reset_degraded!
count = S.carried_item_count
record('a count came back at all', count.is_a?(Integer), count.inspect)
record(
  'it is 8: four worn, three inside the one open bag, one in a hand',
  count == 8,
  "got #{count.inspect}"
)
record('and not 4 - which is what forgetting containers and hands gives', count != 4, count.inspect)
record('and not 5 - which is what forgetting container contents gives', count != 5, count.inspect)
record('and not 7 - which is what forgetting the held item gives', count != 7, count.inspect)
record(
  'and not 11 - a container standing in a room is not carried',
  count != 11,
  count.inspect
)
record('nothing failed to read while counting', S.degraded_fields.empty?, S.degraded_fields.inspect)

puts ''
puts '-- the payload carries all three, so this is not a check on private methods --'
$encumbrance_word = 'Somewhat Burdened'
S.reset_degraded!
status = S.status
record('status sends the phrase',              status['encumbrance'] == 'Somewhat Burdened', status['encumbrance'].inspect)
record('status sends the rank',                status['encumbranceLevel'] == 2, status['encumbranceLevel'].inspect)
record('status sends the ceiling',             status['encumbranceScaleMax'] == 4, status['encumbranceScaleMax'].inspect)
record('status sends the count',               status['carriedItemCount'] == 8, status['carriedItemCount'].inspect)
record(
  'the rank and the phrase are the same fact - a client can check one against the other',
  Lich::DragonRealms::ENC_MAP[status['encumbrance']] == status['encumbranceLevel'],
  "#{status['encumbrance'].inspect} => #{status['encumbranceLevel'].inspect}"
)

puts ''
# The denominator, asserted rather than printed. If the eval above ever stopped
# producing a working State, every `record` would vanish and the run would end
# on "0 checked, 0 failed" - which reads exactly like a pass.
record('a whole-run guard: this file checked a real number of things', $checked >= 18, "#{$checked} checks")

puts ''
puts "#{$checked} checked, #{$fails} failed"
puts($fails.zero? ? 'all passed' : "#{$fails} FAILED")
exit($fails.zero? ? 0 : 1)
