#!/usr/bin/env ruby
# frozen_string_literal: true

# Run one Lich script out of process, in a sandbox, and report what it tried
# to do.
#
#     ruby -W0 --disable-gems ruby/runner.rb --sandbox DIR --script NAME.lic
#     ruby ruby/runner.rb --shim                 the stub API surface, as JSON
#     ruby ruby/runner.rb --surface FILE.lic     the Lich surface FILE calls
#
# # Why this exists
#
# E7 says a candidate script - one the local model proposed as a repair - runs
# out of process, in a sandbox, against fixtures, *before* anybody is offered
# it. `python/runner.py` and `typescript/runner.ts` made that possible for
# their languages. Ruby had nothing, so `tools/ai-script-repair-test.mjs`
# printed an honest skip for two months: "a Ruby script is a Lich script and
# runs only inside Lich". The precondition it named for lifting the skip was
# "an out-of-process Ruby runner that takes its task directory as an
# argument". This is that runner.
#
# It is deliberately *not* a Ruby counterpart to the other two runners' task
# catalogs. There is no catalog of runnable Ruby tasks in this app: a Ruby
# script here goes into Lich's own scripts folder and Lich starts it
# (`src-tauri/src/scripts.rs` says so, and means it). The one thing missing was
# a way to run such a script where it cannot do any harm, which is what a
# review of an AI-written patch needs and what a player's Lich must never be
# asked to provide.
#
# # What "contained" means here, mechanism by mechanism
#
# Each of these is a separate, removable block below, because a containment
# property nobody can switch off is a property nobody can prove works. The
# suite sabotages them one at a time.
#
#   * **No interpreter conveniences.** `-W0 --disable-gems`. Checked rather
#     than assumed - the run refuses to start without them and says which was
#     missing, because a caller that forgets a flag would otherwise get a run
#     that looks contained and is not.
#   * **A restricted load path.** Ruby dropped `$SAFE` in 3.0 and nothing
#     replaced it, so the equivalent is built from what a script can reach:
#     `$LOAD_PATH` is emptied and `require`/`require_relative`/`load` are
#     overridden. A short allowlist is pre-loaded before the path goes; every
#     other name is a violation, so `require 'socket'` cannot be the first
#     line of an escape.
#   * **No filesystem outside the sandbox.** `File`, `IO` and `Dir` are
#     prepended with a guard that resolves the path and refuses anything not
#     under the sandbox directory. Absolute paths, `..`, and symlink-shaped
#     tricks all resolve before the comparison.
#   * **No network.** `TCPSocket`, `TCPServer`, `UDPSocket`, `Socket`,
#     `UNIXSocket` and `Net::HTTP` are defined here as classes that raise on
#     use. Blocking `require 'socket'` alone would give a `NameError`, which
#     reads to a reviewer as a broken script rather than as an escape attempt;
#     these make the attempt legible.
#   * **No subprocesses.** `system`, backticks, `exec`, `spawn`, `fork` and
#     `IO.popen` are violations outright. There is no sandboxed shell.
#   * **A wall clock.** A watchdog thread ends the run at `--timeout` seconds
#     and emits the result it has, so a candidate that loops forever is
#     reported as a timeout rather than as a hung child nobody can read.
#
# A violation raises `Contain::Violation`, which descends from `Exception`
# rather than `StandardError` on purpose: a candidate wrapping its escape in
# `begin ... rescue => e` would otherwise swallow the evidence.
#
# # What it cannot do
#
# This is not an OS sandbox. A Ruby process determined to escape a Ruby-level
# guard has options this does not close - `Fiddle` and `ObjectSpace` among
# them, both of which need a `require` that is refused here, and neither of
# which is what an AI-written repair to a hunting script looks like. The
# threat model is a plausible patch that is *wrong*, not a hostile one that is
# clever. Where that stops being true the answer is a real sandbox at the OS
# level, not more monkey-patching, and this comment is the marker for it.
#
# # Output
#
# One JSON object on real stdout, always, whatever happened:
#
#     {"sent": [{"via": "fput", "text": "kill rat"}],
#      "echoed": ["..."], "errors": ["..."], "violations": ["..."],
#      "timedOut": false, "notes": [...], "shim": {...}}
#
# Anything the script prints is captured into `echoed`/`errors` rather than
# left to interleave with that object, so the caller parses one thing.
#
# Exit codes: 0 ran clean, 3 violation, 4 timeout, 5 the script raised,
# 2 the runner was called wrong.

# `$stderr.puts` and never `Kernel#warn` below. `warn` is a no-op when
# warnings are off, and this runner is started with `-W0` on purpose - so
# every refusal it printed through `warn` (no such sandbox, script outside the
# sandbox, missing flags) reached nobody, and a caller saw a bare exit code 2
# with an empty stderr. Found by a test that asserted the message rather than
# only the status.
require 'json'
require 'stringio'

module Contain
  # Deliberately not a StandardError - see the header.
  class Violation < Exception; end # rubocop:disable Lint/InheritException

  EXIT_OK = 0
  EXIT_VIOLATION = 3
  EXIT_TIMEOUT = 4
  EXIT_SCRIPT_ERROR = 5
  EXIT_USAGE = 2

  # Everything the runner needs before the guards go up, kept in one place so
  # the order is obvious: read the world, then close the door.
  class << self
    attr_reader :sandbox, :violations

    def arm(sandbox)
      @sandbox = normalize(sandbox)
      @violations = []
    end

    def normalize(path)
      File.expand_path(path.to_s).tr('\\', '/').downcase.sub(%r{/+\z}, '')
    end

    def inside?(path)
      return false if path.nil?

      abs = normalize(path)
      abs == @sandbox || abs.start_with?("#{@sandbox}/")
    end

    # Record and raise. Both halves matter: the raise stops the operation, the
    # record survives a candidate that catches and continues.
    def violation!(operation, detail)
      message = "#{operation}: #{detail}"
      @violations << message
      raise Violation, message
    end

    def check_path!(operation, path)
      return if inside?(path)

      violation!(operation, "#{path} is outside the sandbox #{@sandbox}")
    end
  end
end

# --------------------------------------------------------------------------
# GUARD: the filesystem. Removing this block is the suite's first sabotage.
# --------------------------------------------------------------------------
module Contain
  FILE_READS = %i[read binread readlines foreach open new sysopen].freeze
  FILE_WRITES = %i[write binwrite delete unlink rename truncate chmod chown utime symlink link mkfifo].freeze
  DIR_OPS = %i[mkdir rmdir delete unlink open children entries each_child glob chdir].freeze

  def self.install_filesystem_guard!
    file_guard = Module.new do
      (FILE_READS + FILE_WRITES).each do |op|
        define_method(op) do |*args, **kwargs, &block|
          Contain.check_path!("File.#{op}", args.first)
          super(*args, **kwargs, &block)
        end
      end
    end
    File.singleton_class.prepend(file_guard)

    io_guard = Module.new do
      %i[read binread readlines foreach write binwrite sysopen].each do |op|
        define_method(op) do |*args, **kwargs, &block|
          Contain.check_path!("IO.#{op}", args.first)
          super(*args, **kwargs, &block)
        end
      end

      def popen(*args, **_kwargs, &_block)
        Contain.violation!('IO.popen', args.first.to_s)
      end
    end
    IO.singleton_class.prepend(io_guard)

    dir_guard = Module.new do
      DIR_OPS.each do |op|
        define_method(op) do |*args, **kwargs, &block|
          Contain.check_path!("Dir.#{op}", args.first || Dir.pwd)
          super(*args, **kwargs, &block)
        end
      end

      def [](*args)
        Contain.check_path!('Dir.[]', args.first)
        super
      end
    end
    Dir.singleton_class.prepend(dir_guard)

    kernel_guard = Module.new do
      def open(*args, **kwargs, &block)
        Contain.check_path!('Kernel#open', args.first)
        super
      end
    end
    Object.prepend(kernel_guard)
  end
end

# --------------------------------------------------------------------------
# GUARD: the network. Classes that exist only to say no.
# --------------------------------------------------------------------------
module Contain
  SOCKET_CLASSES = %w[TCPSocket TCPServer UDPSocket Socket BasicSocket UNIXSocket UNIXServer].freeze

  def self.install_network_guard!
    SOCKET_CLASSES.each do |name|
      klass = Class.new do
        class << self
          def new(*args, **_kwargs)
            Contain.violation!("#{self}.new", args.map(&:to_s).join(' '))
          end

          def open(*args, **_kwargs)
            Contain.violation!("#{self}.open", args.map(&:to_s).join(' '))
          end
        end
      end
      # A name the violation message can print. Redefined rather than skipped
      # when something already claimed it: a real socket class reaching a
      # candidate is exactly what this exists to prevent.
      Object.send(:remove_const, name) if Object.const_defined?(name, false)
      Object.const_set(name, klass)
    end

    net = Module.new do
      def self.const_missing(name)
        Contain.violation!('Net', name.to_s)
      end
    end
    http = Class.new do
      class << self
        %i[new get get_response post start].each do |op|
          define_method(op) do |*args, **_kwargs|
            Contain.violation!("Net::HTTP.#{op}", args.map(&:to_s).join(' '))
          end
        end
      end
    end
    Object.send(:remove_const, :Net) if Object.const_defined?(:Net, false)
    Object.const_set(:Net, net)
    net.const_set(:HTTP, http)
  end
end

# --------------------------------------------------------------------------
# GUARD: subprocesses, and the restricted load path that stands in for $SAFE.
# --------------------------------------------------------------------------
module Contain
  # Pre-loaded before `$LOAD_PATH` is emptied, so an allowlisted require is a
  # no-op rather than a search. Everything a plausible Lich script needs to
  # format a line or hold a set; nothing that reaches outside the process.
  ALLOWED_REQUIRES = %w[json set time date].freeze

  def self.install_process_guard!
    process_guard = Module.new do
      def system(*args, **_kwargs)
        Contain.violation!('Kernel#system', args.map(&:to_s).join(' '))
      end

      def `(command) # rubocop:disable Naming/MethodName
        Contain.violation!('Kernel#`', command.to_s)
      end

      def exec(*args)
        Contain.violation!('Kernel#exec', args.map(&:to_s).join(' '))
      end

      def spawn(*args)
        Contain.violation!('Kernel#spawn', args.map(&:to_s).join(' '))
      end

      def fork(&_block)
        Contain.violation!('Kernel#fork', '')
      end
    end
    Object.prepend(process_guard)

    proc_guard = Module.new do
      %i[spawn exec fork kill daemon].each do |op|
        define_method(op) do |*args|
          Contain.violation!("Process.#{op}", args.map(&:to_s).join(' '))
        end
      end
    end
    Process.singleton_class.prepend(proc_guard)
  end

  def self.install_load_guard!
    ALLOWED_REQUIRES.each { |lib| require lib }
    # The restricted load path: with nowhere to search, a require that slips
    # past the check below still finds nothing.
    $LOAD_PATH.clear

    load_guard = Module.new do
      def require(name)
        return false if Contain::ALLOWED_REQUIRES.include?(name.to_s)

        Contain.violation!('require', name.to_s)
      end

      def require_relative(name)
        Contain.violation!('require_relative', name.to_s)
      end

      def load(name, *_args)
        Contain.violation!('load', name.to_s)
      end
    end
    Object.prepend(load_guard)
  end
end

# --------------------------------------------------------------------------
# The result, and the wall clock that can emit it from another thread.
# --------------------------------------------------------------------------
module Contain
  REAL_STDOUT = $stdout.dup

  class Result
    attr_accessor :timed_out

    def initialize
      @errors = []
      @timed_out = false
    end

    attr_reader :errors

    def to_h
      {
        'sent' => LichStub::Recorder.sent,
        'echoed' => LichStub::Recorder.echoed,
        'errors' => @errors,
        'violations' => Contain.violations,
        'notes' => LichStub::Recorder.notes,
        'timedOut' => @timed_out,
        'shim' => { 'methods' => LichStub.surface_size }
      }
    end

    # At most once. The watchdog and the main path can both reach here - the
    # watchdog kills the process immediately afterwards, but "immediately" is
    # a scheduler's word and the first version of this printed the object
    # twice, which the caller parses as a syntax error rather than as a
    # timeout. A second emit is dropped rather than allowed to race.
    def emit
      return if @emitted

      @emitted = true
      REAL_STDOUT.puts(JSON.generate(to_h))
      REAL_STDOUT.flush
    end
  end
end

# --------------------------------------------------------------------------
# Modes.
# --------------------------------------------------------------------------

def flag(argv, name)
  at = argv.index(name)
  at && argv[at + 1]
end

argv = ARGV.dup

if argv.include?('--shim')
  require_relative 'lich_stub'
  missing = LichStub.surface_check
  puts JSON.generate(
    'surface' => LichStub::SURFACE,
    'methods' => LichStub.surface_size,
    'missing' => missing
  )
  exit(missing.empty? ? 0 : 1)
end

if argv.include?('--surface')
  # What Lich surface does a given script actually call? Ruby's own parser
  # answers, not a regexp: a grep over source text cannot tell a call from a
  # word in a comment, and the whole point of this list is that the shim is
  # measured against it.
  path = flag(argv, '--surface')
  unless path && File.file?(path)
    $stderr.puts('--surface needs a readable file')
    exit(Contain::EXIT_USAGE)
  end
  require 'prism'
  require 'set'

  parsed = Prism.parse_file(path)
  defined_methods = Set.new
  defined_consts = Set.new
  bare = Set.new
  consts = Set.new

  walk = lambda do |node|
    return if node.nil?

    case node
    when Prism::DefNode then defined_methods << node.name.to_s
    when Prism::ModuleNode, Prism::ClassNode
      defined_consts << node.constant_path.slice.split('::').last
    when Prism::ConstantWriteNode then defined_consts << node.name.to_s
    when Prism::CallNode
      receiver = node.receiver
      if receiver.nil?
        bare << node.name.to_s
      elsif receiver.is_a?(Prism::ConstantReadNode) || receiver.is_a?(Prism::ConstantPathNode)
        head = receiver.is_a?(Prism::ConstantReadNode) ? receiver.name.to_s : receiver.slice
        consts << "#{head}.#{node.name}"
      end
    end
    node.compact_child_nodes.each { |child| walk.call(child) }
  end
  walk.call(parsed.value)

  # Ruby's own methods and constants come from Ruby, not from a list somebody
  # typed and nobody updated.
  core_methods = Set.new(
    Object.new.methods.map(&:to_s) +
    Kernel.private_instance_methods(false).map(&:to_s) +
    Module.private_instance_methods(false).map(&:to_s) +
    Module.instance_methods(false).map(&:to_s)
  )
  %w[json yaml base64 digest securerandom socket set time date].each do |lib|
    require lib
  rescue LoadError
    nil
  end
  core_consts = Set.new(Object.constants.map(&:to_s))

  external_bare = bare.reject { |n| defined_methods.include?(n) || core_methods.include?(n) }.sort
  external_consts = consts.reject do |call|
    head = call.split('.').first.split('::').first
    defined_consts.include?(head) || core_consts.include?(head)
  end.sort

  puts JSON.generate(
    'file' => path,
    'functions' => external_bare,
    'constants' => external_consts,
    'total' => external_bare.length + external_consts.length
  )
  exit(0)
end

sandbox = flag(argv, '--sandbox')
script = flag(argv, '--script')
fixture = flag(argv, '--fixture')
timeout = (flag(argv, '--timeout') || '10').to_f

if sandbox.nil? || script.nil?
  $stderr.puts('usage: ruby -W0 --disable-gems ruby/runner.rb --sandbox DIR --script NAME.lic [--fixture F] [--timeout S]')
  exit(Contain::EXIT_USAGE)
end

# The flags are a containment mechanism, so they are checked rather than
# trusted to a caller's memory. `--disable-gems` leaves `Gem` undefined;
# `-W0` sets `$VERBOSE` to nil.
missing_flags = []
missing_flags << '--disable-gems' if defined?(Gem)
missing_flags << '-W0' unless $VERBOSE.nil?
unless missing_flags.empty?
  $stderr.puts("refusing to run: started without #{missing_flags.join(' and ')}")
  exit(Contain::EXIT_USAGE)
end

unless File.directory?(sandbox)
  $stderr.puts("no such sandbox directory: #{sandbox}")
  exit(Contain::EXIT_USAGE)
end

Contain.arm(sandbox)

script_path = File.expand_path(File.join(sandbox, script))
unless Contain.inside?(script_path)
  $stderr.puts("the script is outside the sandbox: #{script_path}")
  exit(Contain::EXIT_USAGE)
end
unless File.file?(script_path)
  $stderr.puts("no such script: #{script_path}")
  exit(Contain::EXIT_USAGE)
end

# Everything read from disk happens here, before the door closes.
source = File.read(script_path, encoding: 'UTF-8')
stream_lines =
  if fixture && File.file?(fixture)
    File.readlines(fixture, chomp: true)
  else
    []
  end

require_relative 'lich_stub'
LichStub::Recorder.reset
LichStub::Stream.load(stream_lines)

result = Contain::Result.new

Contain.install_filesystem_guard!
Contain.install_network_guard!
Contain.install_process_guard!
Contain.install_load_guard!

# ------------------------------------------------------------------------
# GUARD: the wall clock. Removing this block is the suite's second sabotage.
# ------------------------------------------------------------------------
watchdog = Thread.new do
  sleep(timeout)
  result.timed_out = true
  result.errors << "the script did not finish within #{timeout}s"
  result.emit
  # `exit!` and not `Thread#kill` on the main thread: killing it runs the
  # main path's `ensure`, which then falls through to a second emit and a
  # success exit code - a timeout that reports itself as a clean run.
  exit!(Contain::EXIT_TIMEOUT)
end

# The script's own printing is captured, not silenced: `puts` is a reasonable
# thing for a Lich script to do and a reviewer should see it. It just must not
# land in the middle of the JSON object the caller is parsing.
captured_out = StringIO.new
captured_err = StringIO.new
$stdout = captured_out
$stderr = captured_err

code = Contain::EXIT_OK
begin
  eval(source, TOPLEVEL_BINDING, script_path) # rubocop:disable Security/Eval
rescue Contain::Violation => e
  code = Contain::EXIT_VIOLATION
  result.errors << "containment violation: #{e.message}"
rescue SystemExit => e
  result.errors << "the script called exit(#{e.status})" unless e.success?
rescue Exception => e # rubocop:disable Lint/RescueException
  code = Contain::EXIT_SCRIPT_ERROR
  result.errors << "#{e.class}: #{e.message}"
  result.errors.concat(Array(e.backtrace).first(3))
ensure
  watchdog.kill
  $stdout = Contain::REAL_STDOUT
  $stderr = STDERR
end

captured_out.string.split("\n").each { |line| LichStub::Recorder.echoed << line }
captured_err.string.split("\n").each { |line| result.errors << line }

# A violation recorded but not raised past the top - a candidate that caught
# it and carried on - is still a violation. The exit code says so.
code = Contain::EXIT_VIOLATION if code == Contain::EXIT_OK && !Contain.violations.empty?

result.emit
exit(code)
