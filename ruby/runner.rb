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
# # The measured escape table
#
# Every class below was run against this runner for real, one fixture each so
# that none is shadowed by another raising first, with an instrument proof
# first - an *unguarded* script doing `File.write`, `system` and `IO.popen`
# into a directory outside the sandbox, all three of which landed and were
# visible - so that an absent side-effect downstream means the guard stopped it
# rather than that the harness is blind. Review pass 7 (#460) found four of
# these open; six more turned up while closing them. The right-hand column is
# the state now, and `tools/ai-script-repair-test.mjs` asserts every row: a
# class that escapes is a FAIL in that suite and not a note here.
#
#   #   class                                    before (#460)       now
#   1   require / load, a name or absolute path  refused             refused
#   1b  `Kernel.load '<outside>/payload.rb'`     ESCAPED, ran it     refused
#   1c  `Kernel.require 'socket'`                LoadError, silent   refused
#   2   junction / symlink inside -> outside     ESCAPED, wrote      refused
#   3   `IO.popen`                               refused             refused
#   4   backticks                                refused             refused
#   5   `system` / `Process.spawn`, bare         refused             refused
#   5b  `Kernel.system` / `Kernel.spawn`         ESCAPED, ran it     refused
#   5c  `Kernel.instance_method(:system).bind`   ESCAPED, ran it     refused
#   5d  `Process.method(:spawn).super_method`    ESCAPED, ran it     refused
#   6   `ObjectSpace` to reach the guard         ESCAPED, wrote      refused
#   7   redefining the guard's own methods       ESCAPED, wrote      refused
#   8   a violation inside `at_exit`             blocked, unreported reported
#   9   `File.read` / `File.open` outside        refused             refused
#   9b  `Kernel.open` outside                    ESCAPED, wrote      refused
#   9c  `IO.method(:write).super_method`         ESCAPED, wrote      refused
#   --  `Object.remove_const(:Contain)`          no JSON at all      reported
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
#     `$LOAD_PATH` is emptied and `require`/`require_relative`/`load`/`autoload`
#     are replaced. A short allowlist is pre-loaded before the path goes; every
#     other name is a violation, so `require 'socket'` cannot be the first
#     line of an escape.
#   * **No filesystem outside the sandbox.** `File`, `IO` and `Dir` have every
#     path-taking method replaced by one that **resolves the path on disk**
#     with `File.realpath` - not `File.expand_path`, which is lexical and let a
#     junction inside the sandbox write outside it - and refuses anything not
#     under the resolved sandbox root.
#   * **No network.** `TCPSocket`, `TCPServer`, `UDPSocket`, `Socket`,
#     `UNIXSocket` and `Net::HTTP` are defined here as classes that raise on
#     use. Blocking `require 'socket'` alone would give a `NameError`, which
#     reads to a reviewer as a broken script rather than as an escape attempt;
#     these make the attempt legible.
#   * **No subprocesses.** `system`, backticks, `exec`, `spawn`, `fork` and
#     `IO.popen` are violations outright. There is no sandboxed shell.
#   * **No reflection route back to the guard.** `ObjectSpace`, `TracePoint`
#     and `RubyVM` are replaced by stubs that refuse, and the guard module and
#     every singleton class it owns are frozen.
#   * **A wall clock.** A watchdog thread ends the run at `--timeout` seconds
#     and emits the result it has, so a candidate that loops forever is
#     reported as a timeout rather than as a hung child nobody can read.
#
# A violation raises `Contain::Violation`, which descends from `Exception`
# rather than `StandardError` on purpose: a candidate wrapping its escape in
# `begin ... rescue => e` would otherwise swallow the evidence.
#
# ## Why the guards replace methods instead of prepending modules
#
# The first version prepended anonymous guard modules to `File`, `IO`, `Dir`,
# `Process` and `Object`. Prepending is the idiomatic way to wrap a method, and
# it is the wrong tool here for three measured reasons:
#
#   * `Object.prepend` sits in front of *bare* calls on `main` only. It does
#     not touch `Kernel.system`, because `module_function` gave `Kernel` its
#     own singleton copy of every one of these. Measured: `Kernel.system` and
#     `Kernel.spawn` reached a real subprocess and `Kernel.open` wrote a file
#     outside the sandbox, through a guard that was working perfectly for the
#     bare forms of the same calls.
#   * `Kernel.instance_method(:system).bind(self).call(...)` reads the
#     definition out of `Kernel` directly and never consults `Object`'s
#     ancestors, so no prepend anywhere can be in its way. Measured: reached.
#   * `Method#super_method` walks *past* a prepended module to the definition
#     it shadows. `IO.method(:write).super_method` wrote outside the sandbox
#     and `Process.method(:spawn).super_method` started a process. A prepended
#     guard cannot close this, because the thing being guarded is still sitting
#     there underneath it by construction.
#
# So each guarded method is **removed from its owner and replaced**, with the
# original kept only as an `UnboundMethod` in a closure local that no candidate
# can name. There is one definition and it is ours, so `super`,
# `super_method`, `instance_method`, `method` and the `module_function`
# singleton copies all find the same guarded method. That is what Ruby
# enforces; a prepend is only what Ruby prefers.
#
# Replacement happens on the class that actually owns the method, which is not
# always the one a script names: `File.read`, `File.write`, `File.open` and
# `File.new` are `IO`'s, inherited. The violation message names the
# **receiver** - `self` in a singleton method - so a script that wrote
# `File.read` is still told about `File.read`.
#
# ## Why the guard is frozen
#
# `Contain` and its singleton class are frozen once everything is installed.
# Ruby enforces two things on a frozen module, and they are exactly the two
# escapes review pass 7 found: defining or redefining a method on it raises
# `FrozenError`, and so does `instance_variable_set`. The second is the one
# that mattered. The `ObjectSpace` escape was never really about
# `ObjectSpace` - it was `contain.instance_variable_set(:@sandbox, 'c:')`
# widening the fence to the drive root, and freezing closes that whether the
# module was found by name, by enumeration, or by any other means. That is a
# better answer than playing whack-a-mole with the ways of finding it.
# `ObjectSpace` is stubbed as well, because a violation a reviewer can read
# beats a `NoMethodError` they have to interpret.
#
# The guards do not look `Contain` up by name either. Every one of them closes
# over the module object in a local, so `Object.send(:remove_const, :Contain)`
# - which used to kill the runner with no JSON at all, the worst reporting
# failure available - now changes nothing. `GUARD` is the same handle for code
# that is lexically inside `module Contain`: lexical constant lookup goes
# through `Module.nesting`, which holds the module object itself rather than a
# name to be resolved through `Object`.
#
# # What it cannot do
#
# This is still not an OS sandbox, and the threat model is still a plausible
# patch that is *wrong* rather than a hostile one that is clever. Two holes are
# known and open, both measured rather than supposed:
#
#   * `Fiddle` would reach libc directly. It needs a `require`, which is
#     refused, and `$LOAD_PATH` is empty - but a Ruby build carrying it
#     preloaded would not be stopped by anything here.
#   * The candidate is evaluated in `TOPLEVEL_BINDING`, so it shares this
#     file's toplevel locals and can read them with `binding`. The things worth
#     protecting are no longer among them - the result object, the watchdog and
#     the violation list live on the frozen `Contain` module, so a candidate
#     cannot swap the reporter or kill the clock - but a determined script can
#     still read a path or two out of the binding.
#
# Where that stops being good enough the answer is a real sandbox at the OS
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
# left to interleave with that object, so the caller parses one thing. The one
# exception is a violation raised inside a candidate's `at_exit`, which happens
# *after* the object has gone out: a corrected second object is printed after
# it and the exit code changes. The caller reads the last object on stdout.
# The alternative was a first object saying `violations: []` about a run that
# had one, which is the shape of every bug this file's tests exist to catch.
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

  # A handle on this module that survives `Object.send(:remove_const,
  # :Contain)`. Lexical constant lookup resolves through `Module.nesting`,
  # which holds module objects, so every `GUARD.` below keeps working after the
  # name is gone from `Object`.
  GUARD = self

  # Everything the runner needs before the guards go up, kept in one place so
  # the order is obvious: read the world, then close the door.
  class << self
    attr_reader :sandbox, :violations, :notes, :result, :watchdog

    def arm(sandbox)
      @violations = []
      @notes = []
      lexical = canonical(File.expand_path(sandbox.to_s))
      @sandbox = resolve(sandbox)
      return false if @sandbox.nil?

      # Recorded, not refused. A sandbox root that is itself a link, or spelled
      # with a Windows 8.3 short name (`RUNNER~1` on a GitHub Windows runner),
      # is ordinary and legitimate. What would be wrong is comparing a
      # *resolved* child against an *unresolved* root, which refuses
      # everything - so both sides resolve, and the difference is worth a note
      # rather than a failure.
      @notes << "the sandbox root #{lexical} resolves on disk to #{@sandbox}; the fence is the resolved one" if lexical != @sandbox
      true
    end

    # Hold the objects a candidate must not be able to swap. Set before
    # `seal!`, read afterwards, so `binding` in `TOPLEVEL_BINDING` reaches
    # nothing that matters.
    def stow(result: nil, watchdog: nil)
      @result = result if result
      @watchdog = watchdog if watchdog
    end

    # One spelling of a path, for comparing and for printing. Lexical, and
    # never a substitute for `resolve`.
    def canonical(path)
      path.to_s.tr('\\', '/').downcase.sub(%r{/+\z}, '')
    end

    # The comparison path, and the fix for #460's first finding.
    #
    # `File.expand_path` is lexical. It does not touch the filesystem, so a
    # junction created inside the sandbox expands to a name that is still under
    # the sandbox while the write lands wherever the junction points. Measured
    # end to end before this change: `EXIT=0`, empty `violations`, and the file
    # sitting outside. `File.realpath` asks the filesystem. The target usually
    # does not exist yet, which is the ordinary case for a write, so the parent
    # is resolved and the basename appended - `File.realdirpath` in one call,
    # except that it cannot say which of the two failed when the parent is
    # missing too.
    #
    # A path that resolves nowhere returns nil, and `check_path!` treats that
    # as a refusal. The direction is deliberate: failing to resolve is not
    # evidence of being inside.
    def resolve(path)
      raw = path.to_s
      return nil if raw.empty?

      abs = File.expand_path(raw)
      begin
        return canonical(File.realpath(abs))
      rescue StandardError
        nil # falls through to the parent, below
      end
      begin
        canonical(File.join(File.realpath(File.dirname(abs)), File.basename(abs)))
      rescue StandardError
        nil
      end
    end

    def inside?(path)
      abs = resolve(path)
      return false if abs.nil?

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
      raw = path.to_s
      # `File.open('|cmd')` and `IO.read('|cmd')` are a subprocess wearing a
      # path's clothes, and they would pass every check below: the string
      # expands to a name inside the sandbox that merely does not exist.
      violation!(operation, "#{raw} is a pipe, not a path") if raw.start_with?('|')

      return if inside?(raw)

      resolved = resolve(raw)
      detail =
        if resolved.nil?
          "#{raw} does not resolve on disk, so it cannot be shown to be inside the sandbox #{@sandbox}"
        elsif resolved == canonical(File.expand_path(raw))
          "#{raw} is outside the sandbox #{@sandbox}"
        else
          # The junction case, and the reason to name the resolved target: the
          # path the script wrote reads as perfectly innocent.
          "#{raw} resolves to #{resolved}, which is outside the sandbox #{@sandbox}"
        end
      violation!(operation, detail)
    end

    def check_paths!(operation, *paths)
      paths.each { |p| check_path!(operation, p) unless p.nil? }
    end

    # A glob pattern is not a path and must not be resolved as one:
    # `Dir.glob('**/*.txt')` has no parent directory on disk, so resolving it
    # would refuse an ordinary listing *inside* the sandbox. Check the longest
    # leading run with no magic in it instead.
    def check_glob!(operation, pattern)
      raw = pattern.to_s
      cut = raw.each_char.find_index { |c| '*?[{'.include?(c) }
      head = cut ? raw[0, cut] : raw
      base = head.end_with?('/') ? head : File.dirname(head)
      base = Dir.pwd if base.empty? || base == '.'
      check_path!(operation, base)
    end

    # Replace `mod`'s singleton method `name`, handing the original to
    # `handler` as an `UnboundMethod` that lives only in this closure. See the
    # header for why this is a replacement and not a prepend.
    # `defined_here?` rather than `method_defined?` alone, because Ruby marks a
    # method its platform does not implement - `Process.fork` on Windows - with
    # `rb_f_notimplement`, and such a method IS listed by `instance_methods`
    # while `method_defined?` answers false. Asking only the second left
    # `Process.fork` unreplaced, and the fixture got a `NotImplementedError`
    # rather than a violation: refused by the operating system instead of by
    # this file, which is a pass nobody earned and would have quietly become a
    # real hole the day this ran on Linux, where fork works.
    def defined_here?(mod, name)
      mod.instance_methods(false).include?(name) ||
        mod.private_instance_methods(false).include?(name) ||
        mod.method_defined?(name) ||
        mod.private_method_defined?(name)
    end

    def replace_singleton!(mod, name, &handler)
      sc = mod.singleton_class
      return false unless defined_here?(sc, name)

      original = sc.instance_method(name)
      sc.send(:remove_method, name) if sc.instance_methods(false).include?(name) || sc.private_instance_methods(false).include?(name)
      sc.send(:define_method, name) { |*args, **kwargs, &block| handler.call(self, original, args, kwargs, block) }
      true
    end

    # The same, for a method `Kernel` provides. `module_function` rebuilds the
    # singleton copy from the new definition, so `Kernel.system` and a bare
    # `system` are one method again rather than two.
    def replace_kernel!(name, &handler)
      original = (Kernel.instance_method(name) if defined_here?(Kernel, name))
      Kernel.send(:remove_method, name) if Kernel.instance_methods(false).include?(name) || Kernel.private_instance_methods(false).include?(name)
      Kernel.send(:define_method, name) { |*args, **kwargs, &block| handler.call(self, original, args, kwargs, block) }
      Kernel.send(:module_function, name)
      true
    end

    # Close the door on the guard itself. Everything above must already be
    # installed, and every object the runner needs must already be stowed.
    def seal!
      [File, IO, Dir, Process, Kernel].each { |m| m.singleton_class.freeze }
      Kernel.freeze
      freeze
      singleton_class.freeze
    end
  end
end

# --------------------------------------------------------------------------
# GUARD: the filesystem. Removing this block is the suite's first sabotage.
# --------------------------------------------------------------------------
module Contain
  # Where each of these is actually defined, which is not where a script names
  # it: `File.read`, `File.write`, `File.open`, `File.new` and their kin belong
  # to `IO`, and `File` inherits them. Replacing them on the owner is one
  # definition rather than two, and `self` in the replacement is still the
  # receiver, so the message says what the script said.
  IO_PATH_OPS = %i[read binread readlines foreach write binwrite open new sysopen].freeze
  IO_REFUSED = %i[popen for_fd copy_stream pipe].freeze
  FILE_PATH_OPS = %i[delete unlink truncate chmod chown utime lchmod lchown lutime readlink mkfifo].freeze
  # Reading a file's *metadata* outside the sandbox is not an escape, and it is
  # not nothing either: `File.exist?` over a list of candidate paths maps a
  # player's disk. The header claims "no filesystem outside the sandbox", and a
  # claim about a boundary that is only three-quarters true is the defect #460
  # ranked above the holes themselves. Deliberately NOT on this list:
  # `expand_path`, `realpath`, `realdirpath`, `dirname`, `basename`, `join`,
  # `split`, `extname` and `fnmatch`, which are string arithmetic - and the
  # first three of which `Contain.resolve` itself calls, so guarding them would
  # be an infinite loop rather than a fence.
  FILE_STAT_OPS = %i[exist? file? directory? size size? zero? empty? stat lstat ftype
                     atime mtime ctime birthtime readable? readable_real? writable?
                     writable_real? executable? executable_real? owned? grpowned?
                     world_readable? world_writable? symlink? blockdev? chardev?
                     pipe? socket? setuid? setgid? sticky?].freeze
  FILE_TWO_PATH_OPS = %i[rename symlink link identical?].freeze
  DIR_PATH_OPS = %i[mkdir rmdir delete unlink open children entries each_child foreach chdir exist? empty?].freeze
  DIR_GLOB_OPS = %i[glob []].freeze
  DIR_REFUSED = %i[chroot for_fd].freeze

  def self.install_filesystem_guard!
    contain = self

    IO_PATH_OPS.each do |op|
      replace_singleton!(IO, op) do |receiver, original, args, kwargs, block|
        contain.check_path!("#{receiver}.#{op}", args.first)
        original.bind(receiver).call(*args, **kwargs, &block)
      end
    end
    IO_REFUSED.each do |op|
      replace_singleton!(IO, op) do |receiver, _original, args, _kwargs, _block|
        contain.violation!("#{receiver}.#{op}", args.map(&:to_s).join(' '))
      end
    end

    (FILE_PATH_OPS + FILE_STAT_OPS).each do |op|
      replace_singleton!(File, op) do |receiver, original, args, kwargs, block|
        contain.check_path!("#{receiver}.#{op}", args.first)
        original.bind(receiver).call(*args, **kwargs, &block)
      end
    end
    # Both ends. A rename whose destination is outside the sandbox moves a file
    # out of it just as surely as a write puts one there.
    FILE_TWO_PATH_OPS.each do |op|
      replace_singleton!(File, op) do |receiver, original, args, kwargs, block|
        contain.check_paths!("#{receiver}.#{op}", args[0], args[1])
        original.bind(receiver).call(*args, **kwargs, &block)
      end
    end

    DIR_PATH_OPS.each do |op|
      replace_singleton!(Dir, op) do |receiver, original, args, kwargs, block|
        contain.check_path!("#{receiver}.#{op}", args.first || Dir.pwd)
        original.bind(receiver).call(*args, **kwargs, &block)
      end
    end
    DIR_GLOB_OPS.each do |op|
      replace_singleton!(Dir, op) do |receiver, original, args, kwargs, block|
        contain.check_glob!("#{receiver}.#{op}", args.first)
        original.bind(receiver).call(*args, **kwargs, &block)
      end
    end
    DIR_REFUSED.each do |op|
      replace_singleton!(Dir, op) do |receiver, _original, args, _kwargs, _block|
        contain.violation!("#{receiver}.#{op}", args.map(&:to_s).join(' '))
      end
    end

    # `Kernel#open` takes a path and hands off to `File.open`, and it is also
    # the oldest subprocess trick in Ruby: `open('|cmd')`. `check_path!`
    # refuses the pipe form by name rather than by resolving it.
    replace_kernel!(:open) do |receiver, original, args, kwargs, block|
      contain.check_path!('Kernel#open', args.first)
      original.bind(receiver).call(*args, **kwargs, &block)
    end
  end
end

# --------------------------------------------------------------------------
# GUARD: the network. Classes that exist only to say no.
# --------------------------------------------------------------------------
module Contain
  SOCKET_CLASSES = %w[TCPSocket TCPServer UDPSocket Socket BasicSocket UNIXSocket UNIXServer].freeze

  def self.install_network_guard!
    contain = self

    SOCKET_CLASSES.each do |name|
      klass = Class.new
      %i[new open].each do |op|
        klass.singleton_class.send(:define_method, op) do |*args, **_kwargs|
          contain.violation!("#{self}.#{op}", args.map(&:to_s).join(' '))
        end
      end
      # A name the violation message can print. Redefined rather than skipped
      # when something already claimed it: a real socket class reaching a
      # candidate is exactly what this exists to prevent.
      Object.send(:remove_const, name) if Object.const_defined?(name, false)
      Object.const_set(name, klass)
      klass.singleton_class.freeze
    end

    net = Module.new
    net.singleton_class.send(:define_method, :const_missing) do |name|
      contain.violation!('Net', name.to_s)
    end
    http = Class.new
    %i[new get get_response post start].each do |op|
      http.singleton_class.send(:define_method, op) do |*args, **_kwargs|
        contain.violation!("Net::HTTP.#{op}", args.map(&:to_s).join(' '))
      end
    end
    Object.send(:remove_const, :Net) if Object.const_defined?(:Net, false)
    Object.const_set(:Net, net)
    net.const_set(:HTTP, http)
    http.singleton_class.freeze
    net.singleton_class.freeze
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

  KERNEL_SUBPROCESS_OPS = %i[system exec spawn fork].freeze
  PROCESS_REFUSED = %i[spawn exec fork _fork kill daemon detach].freeze

  def self.install_process_guard!
    contain = self

    KERNEL_SUBPROCESS_OPS.each do |op|
      replace_kernel!(op) do |_receiver, _original, args, _kwargs, _block|
        contain.violation!("Kernel##{op}", args.map(&:to_s).join(' '))
      end
    end
    # `Kernel#\`` is a method like any other, and is spelled like nothing else.
    replace_kernel!(:"`") do |_receiver, _original, args, _kwargs, _block|
      contain.violation!('Kernel#`', args.map(&:to_s).join(' '))
    end

    PROCESS_REFUSED.each do |op|
      replace_singleton!(Process, op) do |receiver, _original, args, _kwargs, _block|
        contain.violation!("#{receiver}.#{op}", args.map(&:to_s).join(' '))
      end
    end
  end

  def self.install_load_guard!
    contain = self

    # Before anything is replaced: these have to be loadable while there is
    # still a load path and a working `require` to load them with.
    ALLOWED_REQUIRES.each { |lib| require lib }
    # The restricted load path: with nowhere to search, a require that slips
    # past the check below still finds nothing.
    $LOAD_PATH.clear

    replace_kernel!(:require) do |_receiver, _original, args, _kwargs, _block|
      name = args.first.to_s
      next false if ALLOWED_REQUIRES.include?(name)

      contain.violation!('require', name)
    end
    replace_kernel!(:require_relative) do |_receiver, _original, args, _kwargs, _block|
      contain.violation!('require_relative', args.first.to_s)
    end
    replace_kernel!(:load) do |_receiver, _original, args, _kwargs, _block|
      contain.violation!('load', args.first.to_s)
    end
    replace_kernel!(:autoload) do |_receiver, _original, args, _kwargs, _block|
      contain.violation!('autoload', args.map(&:to_s).join(' '))
    end
    # `Object.autoload(:X, '/outside/payload.rb')` is the same escape with a
    # different receiver, and it does not go through `Kernel#require`.
    if Module.private_instance_methods(false).include?(:autoload) || Module.instance_methods(false).include?(:autoload)
      Module.send(:remove_method, :autoload)
      Module.send(:define_method, :autoload) do |*args|
        contain.violation!('Module#autoload', args.map(&:to_s).join(' '))
      end
    end
  end
end

# --------------------------------------------------------------------------
# GUARD: reflection. Removing this block is the suite's third sabotage.
# --------------------------------------------------------------------------
module Contain
  # `ObjectSpace` needs no `require`: `defined?(ObjectSpace)` is `"constant"`
  # under `--disable-gems -W0`, which is what made #460's second finding work.
  # Enumerate every `Module`, find this one, `instance_variable_set` the
  # sandbox to `'c:'`, and every path is inside. Freezing (in `seal!`) is what
  # actually stops that. These stubs exist so the attempt is *legible*: a
  # violation naming `ObjectSpace.each_object` tells a reviewer what the
  # candidate reached for, and a bare `NoMethodError` does not.
  REFLECTION_STUBS = {
    'ObjectSpace' => %i[each_object _id2ref define_finalizer undefine_finalizer count_objects
                        garbage_collect reachable_objects_from memsize_of dump dump_all],
    'TracePoint' => %i[new trace allow_reentry stat],
    'RubyVM' => %i[stat],
  }.freeze

  def self.install_reflection_guard!
    contain = self

    REFLECTION_STUBS.each do |name, ops|
      next unless Object.const_defined?(name, false)

      stub = Module.new
      ops.each do |op|
        stub.singleton_class.send(:define_method, op) do |*args, **_kwargs, &_block|
          contain.violation!("#{name}.#{op}", args.map(&:to_s).join(' '))
        end
      end
      # Anything not on the list above is an attempt at the same thing.
      stub.singleton_class.send(:define_method, :method_missing) do |op, *args, **_kwargs, &_block|
        contain.violation!("#{name}.#{op}", args.map(&:to_s).join(' '))
      end
      stub.singleton_class.send(:define_method, :respond_to_missing?) { |*| true }
      stub.singleton_class.send(:define_method, :const_missing) do |const|
        contain.violation!("#{name}::#{const}", '')
      end
      Object.send(:remove_const, name)
      Object.const_set(name, stub)
      stub.singleton_class.freeze
    end
  end
end

# --------------------------------------------------------------------------
# The result, and the wall clock that can emit it from another thread.
# --------------------------------------------------------------------------
module Contain
  REAL_STDOUT = $stdout.dup

  class Result
    attr_accessor :timed_out
    attr_reader :errors, :emitted_violations

    def initialize
      @errors = []
      @timed_out = false
      @emitted_violations = 0
    end

    def to_h
      {
        'sent' => LichStub::Recorder.sent,
        'echoed' => LichStub::Recorder.echoed,
        'errors' => @errors,
        'violations' => GUARD.violations,
        'notes' => LichStub::Recorder.notes + GUARD.notes,
        'timedOut' => @timed_out,
        'shim' => { 'methods' => LichStub.surface_size }
      }
    end

    # At most once, unless forced. The watchdog and the main path can both
    # reach here - the watchdog kills the process immediately afterwards, but
    # "immediately" is a scheduler's word and the first version of this printed
    # the object twice, which the caller parses as a syntax error rather than
    # as a timeout. A second emit is dropped rather than allowed to race.
    #
    # `force` is the single case that must print twice: see the header's
    # section on `at_exit`.
    def emit(force: false)
      return if @emitted && !force

      @emitted = true
      @emitted_violations = GUARD.violations.length
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

unless Contain.arm(sandbox)
  $stderr.puts("the sandbox directory does not resolve on disk: #{sandbox}")
  exit(Contain::EXIT_USAGE)
end

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
Contain.stow(result: result)

# Names captured as locals rather than looked up when they are needed. A
# candidate doing `Object.send(:remove_const, :Contain)` used to kill the
# runner outright: the rescue clause below could not resolve
# `Contain::Violation`, nothing was ever emitted, and the caller saw exit 1
# with no JSON at all - which is the one failure the suite singles out as the
# interesting one.
guard = Contain
violation_class = Contain::Violation
real_stdout = Contain::REAL_STDOUT
exit_ok = Contain::EXIT_OK
exit_violation = Contain::EXIT_VIOLATION
exit_timeout = Contain::EXIT_TIMEOUT
exit_script_error = Contain::EXIT_SCRIPT_ERROR

# ------------------------------------------------------------------------
# GUARD: the honesty of the record when the escape is deferred to `at_exit`.
# Registered FIRST so that it runs LAST - `at_exit` handlers run in reverse
# order of registration - which is the only way to see a violation raised by a
# candidate's own `at_exit`. The guards never tear down, so such an escape was
# always blocked; what was missing was any trace of it in the object a reviewer
# reads. Removing this block is the suite's fourth sabotage.
# ------------------------------------------------------------------------
at_exit do
  reporter = guard.result
  extra = guard.violations.length - reporter.emitted_violations
  if extra.positive?
    reporter.errors << "#{extra} containment violation(s) happened during at_exit, after the first result was printed"
    reporter.emit(force: true)
    # This is the last handler, so exiting hard here skips nothing, and a
    # plain `exit` from inside `at_exit` would not change a status already set.
    exit!(exit_violation)
  end
end

Contain.install_filesystem_guard!
Contain.install_network_guard!
Contain.install_process_guard!
Contain.install_load_guard!
Contain.install_reflection_guard!

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
  exit!(exit_timeout)
end
Contain.stow(watchdog: watchdog)

# The door closes here. Nothing above may be redefined, reopened, or reached
# through `ObjectSpace` from this line on.
Contain.seal!

# The script's own printing is captured, not silenced: `puts` is a reasonable
# thing for a Lich script to do and a reviewer should see it. It just must not
# land in the middle of the JSON object the caller is parsing.
captured_out = StringIO.new
captured_err = StringIO.new
$stdout = captured_out
$stderr = captured_err

code = exit_ok
begin
  eval(source, TOPLEVEL_BINDING, script_path) # rubocop:disable Security/Eval
rescue violation_class => e
  code = exit_violation
  result.errors << "containment violation: #{e.message}"
rescue SystemExit => e
  result.errors << "the script called exit(#{e.status})" unless e.success?
rescue Exception => e # rubocop:disable Lint/RescueException
  code = exit_script_error
  result.errors << "#{e.class}: #{e.message}"
  result.errors.concat(Array(e.backtrace).first(3))
ensure
  guard.watchdog.kill
  $stdout = real_stdout
  $stderr = STDERR
end

captured_out.string.split("\n").each { |line| LichStub::Recorder.echoed << line }
captured_err.string.split("\n").each { |line| result.errors << line }

# A violation recorded but not raised past the top - a candidate that caught
# it and carried on - is still a violation. The exit code says so.
code = exit_violation if code == exit_ok && !guard.violations.empty?

result.emit
exit(code)
