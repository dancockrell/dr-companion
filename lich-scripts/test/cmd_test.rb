# Tests Companion::Cmd against a fake game that refuses the way DragonRealms
# does: roundtime, stun, and a command-specific "Sorry, you may only".
#
# The point is that a refusal is not a result. Every community script retries
# through these, and a bridge that treats "...wait" as the answer will look
# like the button did nothing.

def respond(m) = warn("[lich] #{m}")

# --- fake Lich command surface ---------------------------------------------

$sent = []
$script = {}   # command => array of replies, consumed in order
$rt_end = 0.0

module XMLData
  def self.roundtime_end = $rt_end
end

def fput(cmd)
  $sent << cmd
  true
end

def dothistimeout(cmd, _timeout, regex)
  $sent << cmd
  queue = $script[cmd] or return nil
  loop do
    reply = queue.shift
    return nil if reply.nil?
    return reply if reply =~ regex
  end
end

# Load just the Cmd module out of the bridge.
src = File.read(ARGV[0])
body = src[/module Companion.*?\n  # -+ intents --/m] or abort 'could not slice Cmd'
eval(body.sub(/\n  # -+ intents --\z/, "\nend\n"), TOPLEVEL_BINDING, ARGV[0])

C = Companion::Cmd
fails = 0

# Each case below deliberately repeats one command. The loop detector is
# tested separately in runaway_test.rb; reset it between cases so its state
# does not leak across unrelated assertions.
def fresh
  Companion::Runaway.reset
  $room += 1
end
def check(label, got, want)
  ok = got == want
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}: got #{got.inspect}"
  ok
end

puts '-- a clean reply comes straight back --'
$sent = []
$script = { 'stow sword' => ['You put your sword in your backpack.'] }
r = C.exec('stow sword', expect: [/You put/], timeout: 1)
fails += 1 unless check('clean reply', r, 'You put your sword in your backpack.')
fails += 1 unless check('sent once', $sent.size, 1)

puts '-- roundtime is retried, not returned --'
$sent = []
$script = { 'stow sword' => ['...wait 3 seconds.', 'You put your sword in your backpack.'] }
r = C.exec('stow sword', expect: [/You put/], timeout: 1, attempts: 3)
fails += 1 unless check('retried past ...wait', r, 'You put your sword in your backpack.')
fails += 1 unless check('sent twice', $sent.size, 2)

puts '-- stun is retried --'
$sent = []
$script = { 'stow sword' => ['You are still stunned.', 'You put your sword in your backpack.'] }
r = C.exec('stow sword', expect: [/You put/], timeout: 1, attempts: 3)
fails += 1 unless check('retried past stun', r, 'You put your sword in your backpack.')

puts '-- a command-specific refusal is retried --'
$sent = []
$script = { 'stow sword' => ['Sorry, you may only type ahead 1 command.', 'You put your sword in your backpack.'] }
r = C.exec('stow sword', expect: [/You put/], timeout: 1, attempts: 3)
fails += 1 unless check('retried past Sorry', r, 'You put your sword in your backpack.')

puts '-- giving up returns nil rather than a refusal --'
$sent = []
$script = { 'stow sword' => ['...wait 3 seconds.', '...wait 3 seconds.', '...wait 3 seconds.'] }
r = C.exec('stow sword', expect: [/You put/], timeout: 1, attempts: 3)
fails += 1 unless check('nil after exhausting attempts', r, nil)
fails += 1 unless check('tried 3 times', $sent.size, 3)

puts '-- roundtime is waited out before sending --'
$sent = []
$rt_end = Time.now.to_f + 1.5
$script = { 'stow sword' => ['You put your sword in your backpack.'] }
started = Time.now
C.exec('stow sword', expect: [/You put/], timeout: 1)
waited = Time.now - started
puts(waited >= 1.0 ? "OK   waited #{waited.round(1)}s for roundtime" : "FAIL did not wait (#{waited.round(1)}s)")
fails += 1 unless waited >= 1.0
$rt_end = 0.0

puts '-- an exception in the game layer does not kill the bridge --'
$sent = []
def dothistimeout(*) = raise('game exploded')
r = C.exec('stow sword', expect: [/You put/], timeout: 1)
fails += 1 unless check('returns nil on exception', r, nil)

puts(fails.zero? ? "\nall passed" : "\n#{fails} FAILED")
exit(fails.zero? ? 0 : 1)
