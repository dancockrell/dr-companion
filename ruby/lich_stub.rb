# frozen_string_literal: true

# The Lich API a script can see when it is not running inside Lich.
#
# A Ruby script in this app is a Lich script: a `.lic` that calls `fput`,
# `echo`, `Room.current`, `DRStats.health` and the rest, none of which exist in
# a bare Ruby process. So a candidate script - one an AI proposed as a repair -
# cannot be run at all without something answering those calls, and it must not
# be run inside Lich, because Lich is attached to the player's character.
#
# This is that something. Two jobs:
#
#   1. **Answer.** Every Lich name the repository's own scripts call resolves
#      here to a fixed, harmless value. `SURFACE` below is the whole list, and
#      it is printed rather than described: `ruby/runner.rb --shim` emits it,
#      and the test compares it against the surface `companion_bridge.lic`
#      actually calls, extracted with Ruby's own parser. So "the shim covers
#      what our scripts need" is a measurement that goes red when a script
#      starts calling something new, not a sentence in a comment.
#
#   2. **Record.** Anything that would reach the game (`fput`, `put`, `move`,
#      `Script.start`, ...) is appended to `Recorder.sent` and goes nowhere.
#      There is no socket in the process to send it on - see `runner.rb` - so
#      this is a record of what the candidate *attempted*, which is exactly
#      what a reviewer needs to see before a repaired script is offered.
#
# # Why the values are fixed and dull
#
# A containment run answers "does this script run, and what does it try to
# do", not "does it play well". Fixed values make the answer reproducible.
# Where a script needs to see the game change over time it gets a fixture
# stream (`--fixture`), replayed line by line to `waitfor`/`get`/`matchwait`.
#
# # Not a Lich
#
# It implements what our scripts call and stops. It is not a re-implementation
# of Lich and must never grow into one: the day a candidate needs a Lich
# feature this does not have, the honest outcome is that the containment run
# says so, not that a second Lich appears in this repository.
#
# # Its relationship to lich-scripts/test/protocol_harness.rb
#
# That file also stubs Lich, and the overlap is real, so the boundary is worth
# stating rather than leaving for somebody to discover and unify by halves.
# It exists to make `companion_bridge.lic` *serve* outside the game: fixed
# values chosen to satisfy `server_test.rb`'s assertions, plus the eval that
# slices the bridge and starts its socket. This one exists to run an
# *arbitrary* script where it can do no harm, and its whole point is the
# recording and the containment that file has no use for.
#
# They are one file the day either need changes: if the harness ever wants a
# record of what the bridge tried to send, or if this shim ever needs
# per-caller values, the two have become the same thing and should be merged
# rather than kept in step by hand. Until then the only thing they shared was
# a skill table, and that was made deliberately different below so nobody
# maintains it twice.

require 'json'

module LichStub
  # Everything the candidate tried to do, and everything it said.
  module Recorder
    class << self
      def reset
        @sent = []
        @echoed = []
        @notes = []
      end

      def sent = (@sent ||= [])
      def echoed = (@echoed ||= [])
      def notes = (@notes ||= [])

      # A game command that was not sent, because there is nowhere to send it.
      def send!(via, text)
        sent << { 'via' => via.to_s, 'text' => text.to_s }
        true
      end

      def echo!(text)
        echoed << text.to_s
        nil
      end

      def note!(text)
        notes << text.to_s
        nil
      end
    end
    reset
  end

  # The fixture stream, replayed to whatever asks the game a question.
  module Stream
    class << self
      def load(lines)
        @lines = Array(lines)
        @at = 0
      end

      def lines = (@lines ||= [])
      def remaining = lines.length - (@at ||= 0)

      # Next line, or nil when the fixture is spent. Never blocks: a
      # containment run that waits forever for a line nobody will send is a
      # hang, and a hang is what the wall clock in runner.rb is for - but a
      # script asking one question too many should get an answer of "no more",
      # not a timeout that hides which line it was on.
      def next_line
        @at ||= 0
        return nil if @at >= lines.length

        line = lines[@at]
        @at += 1
        line
      end

      def next_matching(patterns)
        return next_line if patterns.empty?

        loop do
          line = next_line
          return nil if line.nil?
          return line if patterns.any? { |p| p.is_a?(Regexp) ? line =~ p : line.include?(p.to_s) }
        end
      end
    end
  end
end

# --------------------------------------------------------------------------
# Bare functions. Lich defines ~210 of these in `lib/global_defs.rb`; these
# are the ones our scripts call plus the handful any repaired script reaches
# for first. The list is closed on purpose - see the header.
# --------------------------------------------------------------------------

# Things that would reach the game. Recorded, never sent.
def fput(cmd, *_patterns) = LichStub::Recorder.send!(:fput, cmd)
def put(cmd) = LichStub::Recorder.send!(:put, cmd)
def move(dir = 'north') = LichStub::Recorder.send!(:move, dir)
def walk(*args) = LichStub::Recorder.send!(:walk, args.join(' '))
def goto(target) = LichStub::Recorder.send!(:goto, target)
def start_script(name, *_args) = LichStub::Recorder.send!(:start_script, name)
def kill_script(name) = LichStub::Recorder.send!(:kill_script, name)

def dothistimeout(cmd, _timeout = 5, pattern = nil)
  LichStub::Recorder.send!(:dothistimeout, cmd)
  LichStub::Stream.next_matching(pattern ? [pattern] : [])
end

def dothis(cmd, pattern = nil) = dothistimeout(cmd, 5, pattern)

# Things the script says. Recorded, and this is the only output a reviewer
# reads - the process's real stdout carries the JSON result.
def echo(*args) = LichStub::Recorder.echo!(args.join(' '))
def _echo(*args) = LichStub::Recorder.echo!(args.join(' '))
def respond(*args) = LichStub::Recorder.echo!(args.join(' '))
def _respond(*args) = LichStub::Recorder.echo!(args.join(' '))

# Things that ask the game a question. Answered from the fixture stream.
def get = LichStub::Stream.next_line
def reget(_count = 20, _pattern = nil) = LichStub::Stream.lines.dup
def waitfor(*patterns) = LichStub::Stream.next_matching(patterns)
def waitforre(pattern) = LichStub::Stream.next_matching([pattern])
def matchwait(*patterns) = LichStub::Stream.next_matching(patterns)
def matchfind(*patterns) = LichStub::Stream.next_matching(patterns)

# Things that wait. Recorded and returned from at once: a containment run
# measures what a script does, and sleeping through its roundtimes would turn
# a two-second answer into a wall-clock timeout that says nothing.
def pause(seconds = 1) = LichStub::Recorder.note!("pause #{seconds}")
def waitrt = LichStub::Recorder.note!('waitrt')
def waitrt? = LichStub::Recorder.note!('waitrt?')
def waitcastrt? = LichStub::Recorder.note!('waitcastrt?')
def checkrt = 0
def checkcastrt = 0
def checkpaused = false
def running?(*_names) = false
def variable = []
def script_error(message) = LichStub::Recorder.note!("script_error #{message}")

# The state questions a script asks about itself and the room, flat and dull.
def checkhealth = 100
def checkmana = 100
def checkstamina = 100
def checkspirit = 100
def checkname = 'Testchar'
def checkbleeding = false
def checkstunned = false
def checkdead = false
def checkhidden = false
def checkstanding = true
def checkloot = []
def checkpcs = []
def checknpcs = []
def checkroom = 'Town Square Central'

# Reads a dr-scripts data file (`data/town.yaml` and friends) by name. Empty
# is the honest answer here: this shim has no such file on disk, and callers
# that look up a key in the result (e.g. a town name) must already treat a
# miss as "no data for that key", never as "the file must be malformed".
def get_data(_name) = {}

# --------------------------------------------------------------------------
# The module surface. Same rule: what our scripts call, nothing more.
# --------------------------------------------------------------------------

LICH_VERSION = '5.20.1-contained' unless defined?(LICH_VERSION)

module Vars
  def self.list = []
  def self.[](_key) = nil
  def self.[]=(_key, value)
    value
  end
end

CharSettings = {} unless defined?(CharSettings)
Settings = {} unless defined?(Settings)

module XMLData
  def self.game = 'DR'
  def self.name = 'Testchar'
  def self.indicator = { 'IconDEAD' => 'n', 'IconSTUNNED' => 'n', 'IconBLEEDING' => 'n' }
  def self.roundtime_end = 0
  def self.cast_roundtime_end = 0
  def self.health = 100
  def self.mana = 100
  def self.stamina = 100
  def self.spirit = 100
  def self.concentration = 100
  def self.max_health = 100
  def self.max_mana = 100
  def self.max_stamina = 100
  def self.max_spirit = 100
  def self.max_concentration = 100
end

module DRStats
  def self.name = 'Testchar'
  def self.guild = 'Moon Mage'
  def self.race = 'Elothean'
  def self.circle = 42
  def self.favors = 7
  def self.encumbrance = 'Light'
  def self.position = 'standing'
  def self.balance = 100
  def self.health = 100
  def self.spirit = 100
  def self.fatigue = 100
  def self.concentration = 100
  def self.mana = 100
  def self.stamina = 100
  def self.native_mana = 100
  def self.tdps = 0
  def self.strength = 30
  def self.agility = 30
  def self.discipline = 30
  def self.reflex = 30
  def self.charisma = 30
  def self.wisdom = 30
  def self.intelligence = 30
  def self.stamina_stat = 30
  def self.luck = 30
end

class StubSkill
  attr_reader :name

  def initialize(name) = @name = name
end

module DRSkill
  # Three skills, one per skillset, with ranks that are obviously placeholder.
  # `lich-scripts/test/protocol_harness.rb` has a six-skill table of its own
  # tuned to what `server_test.rb` asserts; these are deliberately different
  # numbers rather than a copy of it, so nobody can read the two as one table
  # that has to agree.
  SKILLS = {
    'Small Edged' => [100, 0, 'Weapon'],
    'Light Armor' => [100, 0, 'Armor'],
    'Athletics' => [100, 0, 'Survival']
  }.freeze

  def self.list = SKILLS.keys.map { |k| StubSkill.new(k) }
  def self.getrank(name) = SKILLS.dig(name, 0).to_i
  def self.getxp(name) = SKILLS.dig(name, 1).to_i
  def self.getskillset(name) = SKILLS.dig(name, 2).to_s
end

module DRRoom
  def self.title = '[Crossing, Town Square Central]'
  def self.npcs = []
  def self.dead_npcs = []
  def self.pcs = []
  def self.group_members = []
end

module DRCI
  def self.get_worn_containers = %w[backpack]
  def self.remove_item?(item) = LichStub::Recorder.send!(:remove_item, item)
  def self.wear_item?(item) = LichStub::Recorder.send!(:wear_item, item)
  def self.stow_item?(item) = LichStub::Recorder.send!(:stow_item, item)
end

module DRC
  def self.assess_teach = nil
  def self.listen?(*_args) = false
  def self.bput(cmd, *_patterns) = LichStub::Recorder.send!(:bput, cmd)
  def self.message(text) = LichStub::Recorder.echo!(text)
end

module DRCH
  def self.check_health = { 'health' => 100, 'bleeders' => {}, 'wounds' => {}, 'parasites' => {} }
end

module DRSpells
  def self.active_spells = {}
end

module DRInfomon
  def self.startup_complete? = true
end

module GameObj
  Thing = Struct.new(:id, :noun, :name, :type)

  def self.inv = []
  def self.loot = []
  def self.right_hand = Thing.new(nil, nil, nil, nil)
  def self.left_hand = Thing.new(nil, nil, nil, nil)
  def self.npcs = []
  def self.pcs = []
  def self.type = nil
end

class StubRoom
  def id = 792
  def location = 'Crossing'
  def title = ['[Crossing, Town Square Central]']
  def description = ['A stub room, for a script that is not in the game.']
  def tags = []
end

module Room
  def self.current = StubRoom.new
end

module Map
  def self.current = StubRoom.new
  def self.by_genie_ref(_ref) = nil
  def self.list = []
end

class StubScript
  attr_reader :name, :vars

  def initialize(name, paused: false)
    @name = name
    @paused = paused
    @vars = [name]
  end

  def paused? = @paused
  def want_downstream = false
  def want_downstream=(value)
    @want_downstream = value
  end
  def kill = LichStub::Recorder.note!("kill #{@name}")
end

module Script
  CONTAINED = StubScript.new('contained_candidate')
  RUNNING = [CONTAINED].freeze

  def self.current = CONTAINED
  def self.running = RUNNING
  def self.exists?(_name) = false
  def self.start(name, *_args) = LichStub::Recorder.send!(:start_script, name)
  def self.run(name, *_args) = LichStub::Recorder.send!(:run_script, name)
  def self.kill(name) = LichStub::Recorder.note!("Script.kill #{name}")
  def self.pause(name = nil) = LichStub::Recorder.note!("Script.pause #{name}")
  def self.unpause(name = nil) = LichStub::Recorder.note!("Script.unpause #{name}")
  def self.at_exit(&_block) = nil
  def self.self_kill = LichStub::Recorder.note!('Script.self_kill')
end

module Lich
  module DragonRealms
    module Creature
      def self.in_room = []
    end
  end

  module Common
    # W1: companion_bridge.lic's stance readback (State.install_stance_watcher)
    # registers a read-only line observer here rather than draining its own
    # per-script downstream buffer - see that method's own comment for why.
    # Contained the same way every other Lich call in this file is: recorded,
    # never actually wired to a socket, because there is no socket in this
    # process (see runner.rb).
    module SocketReadHook
      def self.add(name, *_args, &_block)
        LichStub::Recorder.note!("SocketReadHook.add #{name}")
        name
      end

      def self.remove(name)
        LichStub::Recorder.note!("SocketReadHook.remove #{name}")
        nil
      end
    end
  end
end

module LichStub
  # The whole surface, as data, so it can be printed and compared rather than
  # described. `runner.rb --shim` emits this; the suite checks it against what
  # `companion_bridge.lic` actually calls.
  SURFACE = {
    'functions' => %w[
      fput put move walk goto start_script kill_script dothistimeout dothis
      echo _echo respond _respond
      get reget waitfor waitforre matchwait matchfind
      pause waitrt waitrt? waitcastrt? checkrt checkcastrt checkpaused running? variable script_error
      checkhealth checkmana checkstamina checkspirit checkname checkbleeding checkstunned
      checkdead checkhidden checkstanding checkloot checkpcs checknpcs checkroom
      get_data
    ].freeze,
    'constants' => {
      'Vars' => %w[list [] []=],
      'CharSettings' => %w[[] []= fetch key?],
      'Settings' => %w[[] []= fetch key?],
      'LICH_VERSION' => %w[to_s],
      'XMLData' => %w[
        game name indicator roundtime_end cast_roundtime_end health mana stamina spirit
        concentration max_health max_mana max_stamina max_spirit max_concentration
      ],
      'DRStats' => %w[
        name guild race circle favors encumbrance position balance health spirit fatigue
        concentration mana stamina native_mana tdps strength agility discipline reflex
        charisma wisdom intelligence luck
      ],
      'DRSkill' => %w[list getrank getxp getskillset],
      'DRRoom' => %w[title npcs dead_npcs pcs group_members],
      'DRCI' => %w[get_worn_containers remove_item? wear_item? stow_item? respond_to?],
      'DRC' => %w[assess_teach listen? bput message respond_to?],
      'DRCH' => %w[check_health],
      'DRSpells' => %w[active_spells],
      'DRInfomon' => %w[startup_complete?],
      'GameObj' => %w[inv loot right_hand left_hand npcs pcs type],
      'Room' => %w[current],
      'Map' => %w[current by_genie_ref list],
      'Script' => %w[current running exists? start run kill pause unpause at_exit self_kill],
      'Lich::DragonRealms::Creature' => %w[in_room],
      'Lich::Common::SocketReadHook' => %w[add remove]
    }.freeze
  }.freeze

  # Does the shim actually respond to everything it advertises? Asked of the
  # live objects rather than of the table, so a table entry with no method
  # behind it is a failure here instead of a NoMethodError inside somebody's
  # candidate script an hour later.
  def self.surface_check
    missing = []
    SURFACE['functions'].each do |name|
      missing << name unless Object.private_method_defined?(name.to_sym) || Object.method_defined?(name.to_sym)
    end
    SURFACE['constants'].each do |const, methods|
      begin
        object = Object.const_get(const)
      rescue NameError
        missing << const
        next
      end
      methods.each do |m|
        missing << "#{const}.#{m}" unless object.respond_to?(m.to_sym)
      end
    end
    missing
  end

  def self.surface_size
    SURFACE['functions'].length + SURFACE['constants'].values.sum(&:length)
  end
end
