# Create a saved Lich character entry, so `--login <name>` works from then on.
#
#   ruby tools/save-lich-entry.rb            reads tools/lich-credentials.txt
#   ruby tools/save-lich-entry.rb --check    says whether an entry exists, reads no secrets
#
# # Why this exists
#
# Lich creates saved entries in exactly one place: its own GUI login window.
# That window requires a frontend it calls `gui_selectable` - Wrayth, Wizard,
# Avalon or Saga - and refuses with "No supported frontend is available."
# otherwise. On a machine whose only frontend is Genie, which Lich's registry
# marks as not gui_selectable, that window can never complete.
#
# There is also no command-line route. Lich dispatches on
# `if ARGV.include?('--login')` with one `elsif` for the GUI (main.rb:112,
# :195), so credentials without `--login` match no branch;
# `argv_options[:save]` is assigned at argv_options.rb:103 and read nowhere.
# Run anyway, that command falls into a proxy mode, binds port 11024 and
# hangs - it does not merely fail.
#
# So on this machine the app's own `--login Phemius` path had nothing to
# resolve against and no supported way to get one. This closes that, using
# Lich's own `EntryStore.save_entries` rather than hand-writing its YAML, so
# the file is whatever the installed Lich version considers correct - including
# its encryption mode, which `save_entries` applies from the existing file.
#
# # The credentials are not in this script, and nothing here prints them
#
# They live in `tools/lich-credentials.txt`, which is gitignored, which this
# script reads and never echoes, and which you can delete the moment the entry
# is saved - the entry is what `--login` uses afterwards, not the file.
#
# Deliberately not wired to a button in the app. dr-companion does not take,
# store, or display an account password anywhere in its own UI, and that has
# not changed; this is a local tool that reads a file you wrote.

require 'yaml'
require 'fileutils'

LICH_DIR  = ENV['LICH_DIR']  || 'C:/Ruby4Lich5/Lich5'
DATA_DIR  = ENV['DATA_DIR']  || File.join(LICH_DIR, 'data')
CREDS     = ENV['CREDS']     || File.join(__dir__, 'lich-credentials.txt')

def die(msg)
  warn msg
  exit 1
end

# --check reads no secrets at all: it only asks whether an entry exists and
# names the characters, which `--login` needs and which are not sensitive.
if ARGV.include?('--check')
  yaml_file = File.join(DATA_DIR, 'entry.yaml')
  unless File.exist?(yaml_file)
    puts "no entry.yaml in #{DATA_DIR} - `--login` has nothing to resolve"
    exit 2
  end
  data = YAML.safe_load_file(yaml_file, permitted_classes: [Symbol])
  chars = (data['accounts'] || {}).flat_map do |_acct, a|
    (a['characters'] || []).map { |c| c['char_name'] }
  end
  puts "entry.yaml exists, #{chars.size} character(s): #{chars.join(', ')}"
  exit chars.empty? ? 2 : 0
end

unless File.exist?(CREDS)
  die <<~MSG
    No credentials file at:
      #{CREDS}

    Create it with these four lines, filling in your own values:

      account=YOURACCOUNT
      password=YOURPASSWORD
      character=YourCharacter
      game=DR

    Then run this script again. Nothing prints the file's contents, and you
    can delete it once the entry is saved.

    game= is DR for DragonRealms Prime, DRF for Fallen, DRT for Test,
    DRX for Platinum.
  MSG
end

# Parsed without ever printing a value. Errors below name the *key* that was
# missing, never what was in the file.
fields = {}
File.readlines(CREDS, chomp: true).each do |line|
  next if line.strip.empty? || line.strip.start_with?('#')
  k, _, v = line.partition('=')
  fields[k.strip.downcase] = v.strip
end

%w[account password character].each do |k|
  die "#{CREDS} is missing a `#{k}=` line." if fields[k].to_s.empty?
end

game_code = (fields['game'] || 'DR').upcase
game_name = {
  'DR' => 'DragonRealms', 'DRF' => 'DragonRealms - The Fallen',
  'DRT' => 'DragonRealms - Test', 'DRX' => 'DragonRealms - Platinum'
}[game_code] || 'DragonRealms'

# Load Lich's own entry store rather than writing YAML by hand, so the file
# matches whatever this Lich version expects.
$LOAD_PATH.unshift(File.join(LICH_DIR, 'lib'))
LIB_DIR = File.join(LICH_DIR, 'lib') unless defined?(LIB_DIR)
DATA_DIR_CONST = DATA_DIR

# `entry_store` pulls in `master_password_manager`, whose first line calls
# `Lich::Util.install_gem_requirements` - a gem installer that only exists
# once Lich's full boot has run. Stubbed rather than booting Lich, because
# booting Lich is the thing that does not work on this machine, and the gem it
# wants (`os`) is already installed.
#
# Narrow on purpose: this defines exactly the one method that is in the way,
# and only if nothing has defined it already, so a future version that loads
# cleanly gets its own implementation rather than this stub.
module Lich
  module Util
    unless respond_to?(:install_gem_requirements)
      def self.install_gem_requirements(*_args, **_kwargs) = true
    end
  end
end

# The same chain reaches `windows_credential_manager`, which does
# `extend FFI::Library` at load. Lich's own boot has required ffi by then;
# this has not. The gem is present, so requiring it is enough - and if it ever
# is not, saying so here is far clearer than an "uninitialized constant FFI"
# ten frames deep in Lich's GUI code.
# Both are gems Lich's own boot has already required by the time this code
# runs inside Lich; standalone, they have not been. Named individually so a
# missing one says which, rather than surfacing as an "uninitialized constant"
# ten frames deep in Lich's GUI code.
%w[ffi os].each do |gem_name|
  require gem_name
rescue LoadError
  die "the `#{gem_name}` gem is needed to load Lich's entry store. Install it " \
      "into the Ruby that runs Lich:  gem install #{gem_name}"
end

begin
  require File.join(LICH_DIR, 'lib', 'common', 'authentication', 'entry_store')
rescue LoadError => e
  die "could not load Lich's entry store from #{LICH_DIR}: #{e.message}"
end

FileUtils.mkdir_p(DATA_DIR)

# `frontend: 'stormfront'` on purpose, and it does not mean Wrayth gets
# launched. Lich treats that value as a *protocol* selector - it picks the XML
# dialect, and it is the one with the `streams` capability, which is what the
# app's channel tabs read. `--without-frontend` (which dr-companion passes as
# `--headless=<port>`) is the separate flag that stops Lich launching an actual
# client. See lich.rs's module header.
entry = {
  user_id:           fields['account'],
  password:          fields['password'],
  char_name:         fields['character'],
  game_code:         game_code,
  game_name:         game_name,
  frontend:          'stormfront',
  custom_launch:     nil,
  custom_launch_dir: nil,
  is_favorite:       false
}

# Merge rather than replace, so running this for a second character does not
# delete the first.
#
# The method is `load_saved_entries(data_dir, autosort_state)`, not
# `load_entries(data_dir)`. The first version called the latter, which does
# not exist - and the bare `rescue StandardError` below turned that NoMethodError
# into an empty list, so saving a second character silently deleted the first.
# Caught by actually adding two characters and reading the file back, not by
# reading this code. That rescue now names what it is willing to swallow.
existing = begin
  Lich::Common::Authentication::EntryStore.load_saved_entries(DATA_DIR, false) || []
rescue Errno::ENOENT
  # No file yet. The only absence that legitimately means "no entries" - a
  # parse failure or a missing method must not silently become one, because
  # the result is used as the base of a write that replaces the file.
  []
end
existing = existing.reject do |e|
  e[:char_name].to_s.casecmp?(entry[:char_name]) &&
    e[:user_id].to_s.casecmp?(entry[:user_id])
end

ok = Lich::Common::Authentication::EntryStore.save_entries(DATA_DIR, existing + [entry])
die 'Lich reported the save failed.' unless ok

# Verify by reading it back, rather than trusting the return value - and print
# only the character name, which is the part `--login` needs.
saved = YAML.safe_load_file(File.join(DATA_DIR, 'entry.yaml'), permitted_classes: [Symbol])
names = (saved['accounts'] || {}).flat_map { |_a, v| (v['characters'] || []).map { |c| c['char_name'] } }

if names.any? { |n| n.to_s.casecmp?(entry[:char_name]) }
  puts "saved: #{entry[:char_name]} (#{game_name})"
  puts "entry.yaml now holds #{names.size} character(s): #{names.join(', ')}"
  puts
  puts "You can delete #{CREDS} now - `--login` uses the entry, not that file."
else
  die 'the entry was written but the character is not in it - nothing to trust here.'
end
