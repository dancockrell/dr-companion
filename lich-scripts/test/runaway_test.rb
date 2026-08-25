# Tests Companion::Runaway against the two loops the community actually hit.
#
#   ruby lich-scripts/test/runaway_test.rb lich-scripts/companion_bridge.lic
#
# Both come from real reports (docs/DOMAIN.md section 20):
#
#   1. A Platinum character that went through the portal network nine times,
#      passing through its own destination on hop eight and continuing.
#   2. A character that sat "endlessly looking at the ferry and never getting
#      on".
#
# The rule on Prime and Platinum is that automation is monitored. What gets a
# character noticed is not automation as such, it is a script visibly doing
# nothing for a long time. Catching that is the point of this module.

def respond(m) = warn("[lich] #{m}")

$room = 100
class FakeRoom
  def initialize(id) = @id = id
  attr_reader :id
end
module Room
  def self.current = FakeRoom.new($room)
end

src = File.read(ARGV[0])
body = src[/module Companion.*?\n  # -+ commands --/m] or abort 'could not slice Runaway'
eval(body.sub(/\n  # -+ commands --\z/, "\nend\n"), TOPLEVEL_BINDING, ARGV[0])

R = Companion::Runaway
fails = 0

def check(label, got, want)
  ok = want.is_a?(Regexp) ? (got.to_s =~ want ? true : false) : (got == want)
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}: #{got.inspect}"
  ok
end

puts '-- normal varied commands do not trip it --'
R.reset
tripped = nil
%w[north east stow\ sword south west look].each do |c|
  $room += 1
  tripped ||= R.observe(c)
end
fails += 1 unless check('varied commands pass', tripped, nil)

puts ''
puts '-- the same command over and over trips it --'
R.reset
tripped = nil
8.times { tripped ||= R.observe('go portal') }
fails += 1 unless check('repeated command caught', tripped, /go portal/)

puts ''
puts '-- the portal loop, as it actually happened --'
# Nine hops, each landing in a different zone, all issued as "go portal".
R.reset
tripped = nil
[67, 107, 30, 90, 40, 47, 116, 1, 99].each do |zone|
  $room = zone * 10
  tripped ||= R.observe('go portal')
end
fails += 1 unless check('nine-hop portal loop caught', tripped, /go portal/)

puts ''
puts '-- varied movement that never leaves the room trips it --'
# The ferry case. Note this needs *varied* commands: identical ones would hit
# the repeat limit first. A character shuffling around a maze exit it cannot
# take looks exactly like this.
R.reset
$room = 500
# First observation establishes the room and starts its clock, which is why
# the backdating has to happen after it rather than before.
R.observe('north')
Companion::Runaway.instance_variable_set(:@room_since, Time.now - 200)
tripped = nil
%w[south east west north].each { |c| tripped ||= R.observe(c) }
fails += 1 unless check('stuck in one room caught', tripped, /still in room 500/)

puts ''
puts '-- but genuine progress keeps it quiet --'
R.reset
$room = 600
R.observe('north')
Companion::Runaway.instance_variable_set(:@room_since, Time.now - 200)
tripped = nil
%w[south east west north].each do |c|
  $room += 1 # the room changes, so we are getting somewhere
  tripped ||= R.observe(c)
end
fails += 1 unless check('movement that moves passes', tripped, nil)

puts ''
puts '-- it only fires once, so we do not spam a stop --'
R.reset
8.times { R.observe('go portal') }
again = R.observe('go portal')
fails += 1 unless check('second trip suppressed', again, nil)
fails += 1 unless check('but it remembers it tripped', R.tripped, true)

puts ''
puts '-- reset clears it, because a deliberate restart is a fresh decision --'
R.reset
fails += 1 unless check('cleared', R.tripped, false)

puts ''
puts(fails.zero? ? 'all passed' : "#{fails} FAILED")
exit(fails.zero? ? 0 : 1)
