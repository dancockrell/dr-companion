# Tests Companion::Yaml against real dr-scripts settings files.
#
#   ruby lich-scripts/test/yaml_test.rb lich-scripts/companion_bridge.lic
#
# Why this matters: to use the main free script suite a newcomer is asked to
# hand-write a character setup file (the shipped samples run 16-21 KB),
# overriding the right keys out of a 94 KB base.yaml, using anchors and merge
# keys, and to debug the result in an online parser. Config-shaped failures
# dominate the help channels as a result.
#
# Reading those files correctly, and reporting a syntax error with a line
# number, is the foundation for doing anything better than that.

def respond(m) = warn("[lich] #{m}")

require 'tmpdir'

src = File.read(ARGV[0], encoding: 'UTF-8')
body = src[/module Companion.*?\n  # -+ commands --/m] or abort 'could not slice Yaml'
eval(body.sub(/\n  # -+ commands --\z/, "\nend\n"), TOPLEVEL_BINDING, ARGV[0])

Y = Companion::Yaml
fails = 0

def check(label, ok, detail = '')
  puts "#{ok ? 'OK  ' : 'FAIL'} #{label}#{detail.empty? ? '' : ": #{detail}"}"
  ok
end

dir = Dir.mktmpdir('drc-yaml')

# A realistic slice of a dr-scripts profile, including the anchor and merge
# syntax people are asked to learn.
good = File.join(dir, 'Testchar-setup.yaml')
File.write(good, <<~YAML)
  ---
  safe_room: &my_safe_room 1234
  crossing_training_sorcery_room: *my_safe_room
  outfitting_room: *my_safe_room

  training_abilities:
    Herbs: 480
    Athletics: 300

  herbs:
    - name: jadice flower
      size: 6
      stackable: true
      room: 8259
      price: 812
      quantity: 12

  lootables:
    - bolt
    - arrow
    - coin
YAML

puts '-- a valid profile parses, and we can list its settings --'
r = Y.check(good)
fails += 1 unless check('parses', r['ok'] == true, r['error'].to_s)
fails += 1 unless check('found top-level keys', r['count'].to_i >= 5, "count=#{r['count']}")
fails += 1 unless check(
  'anchors resolved, not treated as text',
  YAML.unsafe_load_file(good)['outfitting_room'] == 1234,
  YAML.unsafe_load_file(good)['outfitting_room'].inspect
)

puts ''
puts '-- a broken profile reports the line, which is what people want --'
bad = File.join(dir, 'Testchar-broken.yaml')
# Bad indentation: the classic hand-editing failure.
File.write(bad, <<~YAML)
  ---
  training_abilities:
    Herbs: 480
     Athletics: 300
YAML
r = Y.check(bad)
fails += 1 unless check('reports failure', r['ok'] == false)
fails += 1 unless check('names a line', !r['line'].nil?, "line=#{r['line'].inspect}")

puts ''
puts '-- an undefined anchor is caught too --'
bad2 = File.join(dir, 'Testchar-anchor.yaml')
File.write(bad2, "---\nfoo: *nope\n")
r = Y.check(bad2)
fails += 1 unless check('undefined anchor rejected', r['ok'] == false, r['error'].to_s[0, 60])

puts ''
puts '-- load order is base.yaml first, then the character files --'
File.write(File.join(dir, 'base.yaml'), "---\ndefault_setting: 1\n")
$test_dir = dir
Companion::Yaml.define_singleton_method(:profile_dirs) { [$test_dir] }
files = Y.files_for('Testchar')
names = files.map { |f| File.basename(f) }
fails += 1 unless check('base.yaml first', names.first == 'base.yaml', names.inspect)
fails += 1 unless check('character files follow', names.length == 4, names.inspect)

FileUtils.rm_rf(dir) if defined?(FileUtils)

puts ''
puts(fails.zero? ? 'all passed' : "#{fails} FAILED")
exit(fails.zero? ? 0 : 1)
