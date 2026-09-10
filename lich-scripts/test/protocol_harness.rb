# Test harness: stubs the Lich runtime so companion_bridge.lic can run
# outside the game, then starts the server. Used to verify the WebSocket
# implementation against an independent client.

def respond(msg) = warn("[lich] #{msg}")
LICH_VERSION = '5.20.1-harness'

CharSettings = { 'companion_account_tier' => 'basic', 'companion_province' => 'Zoluren' }

class FakeSkill
  attr_reader :name
  def initialize(name) = @name = name
end

module DRSkill
  SKILLS = {
    'Small Edged'  => [412, 12, 'Weapon'],
    'Light Armor'  => [388, 33, 'Armor'],
    'Evasion'      => [401, 34, 'Survival'],
    'Athletics'    => [205, 4,  'Survival'],
    'Locksmithing' => [150, 30, 'Survival'],
    'Appraisal'    => [90,  0,  'Lore']
  }
  def self.list = SKILLS.keys.map { |k| FakeSkill.new(k) }
  def self.getrank(n) = SKILLS.dig(n, 0).to_i
  def self.getxp(n) = SKILLS.dig(n, 1).to_i
  def self.getskillset(n) = SKILLS.dig(n, 2).to_s
end

module DRStats
  def self.name = 'Testchar'
  def self.guild = 'Moon Mage'
  def self.race = 'Elothean'
  def self.circle = 42
  def self.favors = 7
  # A real DragonRealms phrase, not an invented one. This used to be 'Light',
  # which is not in Lich's ENC_MAP at all - a fixture that could only ever
  # exercise the "we could not tell" branch of W4's encumbrance rank. 'Light
  # Burden' is rank 1 of 11, so server_test.rb can assert a number crosses the
  # socket. encumbrance_test.rb keeps the unrecognised-phrase case.
  def self.encumbrance = 'Light Burden'
  def self.health = 88
  def self.spirit = 100
  def self.fatigue = 71
  def self.concentration = 95
  def self.mana = 60
end

module DRRoom
  def self.title = '[Crossing, Town Square Central]'
  def self.npcs = []
  def self.pcs = %w[Someguy]
  def self.group_members = []
end

module XMLData
  def self.game = 'DR'
  def self.indicator = { 'IconDEAD' => 'n', 'IconSTUNNED' => 'n', 'IconBLEEDING' => 'y' }
  def self.roundtime_end = 0
end

class FakeRoom
  def id = 792
  def location = 'Crossing'
end
module Room
  def self.current = FakeRoom.new
end

module GameObj
  def self.inv = (1..11).to_a

  # Lich's own {container id => contents} registry, which is what the bridge
  # reads for container counts. Empty here: this harness exercises the
  # protocol, not the inventory, and an empty registry is the honest answer
  # for a script that is not in the game. There is deliberately no
  # DRCI.get_worn_containers stub any more - that method does not exist in
  # Lich, the bridge called it for months and got a silent NoMethodError, and
  # a stub that answered it is why no test could see that.
  def self.containers = {}
  def self.right_hand = Struct.new(:id).new(nil)
  def self.left_hand = Struct.new(:id).new(nil)
end

class FakeScript
  attr_reader :name
  def initialize(name, paused = false)
    @name = name
    @paused = paused
  end
  def paused? = @paused
end

module Script
  @@running = [FakeScript.new('companion_bridge'), FakeScript.new('uber'), FakeScript.new('travel', true)]
  # Named scripts this fake Lich install has on disk. 'buff' is here for R1
  # (docs/PLAN_TO_1_0.md §6b Lane R) so the harness can exercise the buffs
  # intent's happy path — start it, see it appear in `scripts` — rather than
  # only its "not installed" refusal, which is all Script.exists? returning
  # false for everything would let this harness prove.
  INSTALLED = %w[companion_bridge uber travel buff go2].freeze
  def self.current = FakeScript.new('companion_bridge')
  def self.running = @@running
  def self.exists?(name) = INSTALLED.include?(name.to_s)
  def self.start(name, *_args)
    started = FakeScript.new(name.to_s)
    @@running << started
    started
  end
  def self.kill(n) = @@running.reject! { |s| s.name == n }
  def self.pause(_n) = nil
  def self.unpause(_n) = nil
  def self.at_exit(&_blk) = nil
end

# W4: the encumbrance ladder the bridge turns DRStats.encumbrance into a rank
# with. A **fixture subset**, not a copy of Lich's twelve-entry ENC_MAP: this
# harness only has to prove a real phrase becomes a real number and reaches the
# socket, and a partial table that admits to being partial is safer than one
# that looks authoritative and silently drifts. `ruby/lich_stub.rb` carries the
# full ladder, because standing in for Lich is its whole job.
module Lich
  module DragonRealms
    ENC_MAP = {
      'None'              => 0,
      'Light Burden'      => 1,
      'Somewhat Burdened' => 2,
      'Burdened'          => 3
    }.freeze
  end
end

# Load the bridge, minus its entry-point block (which reads Script.current.vars).
src = File.read(ARGV[0], encoding: 'UTF-8')
src = src.split('# -------------------------------------------------------------------- entry --').first
eval(src, TOPLEVEL_BINDING, ARGV[0])

port = (ARGV[1] || 7415).to_i
server = Companion::Server.new(port)
abort 'failed to start' unless server.start
sleep 20
server.stop
