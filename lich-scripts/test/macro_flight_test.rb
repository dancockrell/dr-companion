# Process-wide macro flight contract.
#
# Multiple Tauri windows are separate JavaScript runtimes but share this one
# bridge process. Simultaneous macro requests must therefore have one winner
# here, while a later deliberate request and every non-macro intent remain
# available.

src = File.read(ARGV[0], encoding: 'UTF-8')
body = src[/  module Intents\n.*?\n    # One entry per real intent/m] or abort 'could not slice Intents flight gate'
body = body.sub(/\n    # One entry per real intent.*\z/m, "\n  end\n")
eval("module Companion\n#{body}\nend\n", TOPLEVEL_BINDING, ARGV[0])

gate = Companion::Intents
fails = 0

def check(label, condition)
  puts "#{condition ? 'OK  ' : 'FAIL'} #{label}"
  condition
end

puts '-- simultaneous windows share one atomic claim --'
gate.reset_macro_flight!
ready = Queue.new
release = Queue.new
results = Queue.new
workers = 12.times.map do
  Thread.new do
    ready << true
    release.pop
    results << gate.claim_macro_flight(100.0)
  end
end
12.times { ready.pop }
12.times { release << true }
workers.each(&:join)
winners = 12.times.count { results.pop }
fails += 1 unless check('exactly one simultaneous request wins', winners == 1)

puts ''
puts '-- the flight expires without blocking unrelated work --'
fails += 1 unless check('a duplicate inside 900ms is refused', !gate.claim_macro_flight(100.899))
fails += 1 unless check('a later deliberate macro is accepted', gate.claim_macro_flight(100.9))
fails += 1 unless check('command serialization still includes run_macro', gate::COMMAND_SENDING.include?('run_macro'))

exit(fails.zero? ? 0 : 1)
