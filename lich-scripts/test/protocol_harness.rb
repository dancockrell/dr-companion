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
  def self.encumbrance = 'Light'
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
  def self.right_hand = Struct.new(:id).new(nil)
  def self.left_hand = Struct.new(:id).new(nil)
end

module DRCI
  def self.get_worn_containers = %w[backpack]
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
  def self.current = FakeScript.new('companion_bridge')
  def self.running = @@running
  def self.kill(n) = @@running.reject! { |s| s.name == n }
  def self.pause(_n) = nil
  def self.unpause(_n) = nil
  def self.at_exit(&_blk) = nil
end

# Load the bridge, minus its entry-point block (which reads Script.current.vars).
src = File.read(ARGV[0])
src = src.split('# -------------------------------------------------------------------- entry --').first
eval(src, TOPLEVEL_BINDING, ARGV[0])

port = (ARGV[1] || 7415).to_i
server = Companion::Server.new(port)
abort 'failed to start' unless server.start
sleep 20
server.stop
