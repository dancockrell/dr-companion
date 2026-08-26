// A Genie plugin that gives the companion the same access Lich gives it,
// plus a socket so anything else can drive the game too.
//
// Why this exists: Genie connects straight to DragonRealms and Lich is a
// separate step nobody takes by default. Confirmed by connecting a real
// character and watching the companion sit empty beside a working game. So
// the Lich bridge, which is the whole product, reaches only players who have
// already done a four-line setup most of them never hear about.
//
// Genie's own plugin API is better placed for this than Lich is:
//
//   ParseXML     the raw Simutronics stream, before Genie touches it
//   ParseText    every line as rendered, after highlights and substitutions
//   ParseInput   every command the player types, including their own macros
//   Variable[]   Genie's parsed state: vitals, room, hands, spells
//   SendText     send a command to the game
//
// That is both halves of the conversation plus everything Genie worked out in
// between, which is more than Lich sees.
//
// The transport is newline-delimited JSON over plain TCP rather than the
// WebSocket the Lich bridge speaks. Not laziness: .NET Framework 4.0 has no
// usable WebSocket server, hand-rolling the framing would be the largest and
// least interesting part of this file, and a JSON line is something anything
// can read. The companion gets a small adapter instead.
//
// Two rules this file holds to, because it sits in the path of somebody's
// game:
//
//   Nothing here may block. Every callback runs on Genie's thread, so work is
//   queued and a writer thread deals with it. A slow reader must cost that
//   reader, never the player.
//
//   Nothing here may swallow. ParseText and ParseInput must return what they
//   were given. A bridge that can eat game output or drop a typed command is
//   one nobody should install, and a bug here would look like the game
//   misbehaving.
//
// Built against .NETFramework 4.0, which is what Genie 4.0.2.9 targets.
// Compile with the framework csc, not the dotnet SDK.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using GeniePlugin.Interfaces;

namespace DrCompanion
{
    public class CompanionBridge : IPlugin
    {
        private const int Port = 7416;

        /// <summary>
        /// How many events may pile up for a client before they are dropped.
        ///
        /// Bounded on purpose. A client that stops reading must not grow this
        /// queue until Genie runs out of memory mid-fight, and the honest
        /// failure is to lose events and say so rather than to take the game
        /// down with it.
        /// </summary>
        private const int MaxQueued = 2000;

        private IHost _host;
        private bool _enabled = true;

        private TcpListener _listener;
        private Thread _acceptThread;
        private volatile bool _running;

        private readonly List<Client> _clients = new List<Client>();
        private readonly object _clientLock = new object();

        private long _xml, _text, _input, _vars, _sent, _dropped;

        public string Name { get { return "DR Companion Bridge"; } }
        public string Version { get { return "0.2.0"; } }
        public string Description { get { return "Streams the game to DR Companion on 127.0.0.1:7416, and takes commands back."; } }
        public string Author { get { return "dancockrell"; } }

        public bool Enabled
        {
            get { return _enabled; }
            set { _enabled = value; }
        }

        // ------------------------------------------------------------ setup --

        public void Initialize(IHost host)
        {
            _host = host;
            try
            {
                // Loopback only, and not configurable. This accepts commands
                // that are executed as the player, so it must not be reachable
                // from anywhere but this machine.
                _listener = new TcpListener(IPAddress.Loopback, Port);
                _listener.Start();
                _running = true;

                _acceptThread = new Thread(AcceptLoop);
                _acceptThread.IsBackground = true;
                _acceptThread.Name = "companion-accept";
                _acceptThread.Start();

                Echo("[companion] listening on 127.0.0.1:" + Port + ", interface version " + _host.InterfaceVersion);
            }
            catch (Exception e)
            {
                // A port already taken must not stop Genie loading. The plugin
                // simply does nothing, and says so once.
                Echo("[companion] could not listen on " + Port + ": " + e.Message);
                _running = false;
            }
        }

        public void ParentClosing()
        {
            _running = false;
            try { if (_listener != null) _listener.Stop(); } catch { }
            lock (_clientLock)
            {
                foreach (var c in _clients) c.Close();
                _clients.Clear();
            }
            _host = null;
        }

        /// <summary>Menu click: report what has actually flowed.</summary>
        public void Show()
        {
            int n;
            lock (_clientLock) n = _clients.Count;
            Echo(string.Format(
                "[companion] {0} client(s) on :{1}  |  xml {2}  text {3}  input {4}  vars {5}  sent {6}  dropped {7}",
                n, Port, _xml, _text, _input, _vars, _sent, _dropped));
        }

        // ------------------------------------------------------- the callbacks --

        public void ParseXML(string xml)
        {
            if (!_enabled) return;
            _xml++;
            Publish("xml", xml, null);
        }

        /// <summary>
        /// One rendered line, and the window it belongs to.
        ///
        /// Returns its input unchanged, always. See the header.
        /// </summary>
        public string ParseText(string text, string window)
        {
            if (_enabled)
            {
                _text++;
                Publish("text", text, window);
            }
            return text;
        }

        /// <summary>A command the player typed. Also passed straight through.</summary>
        public string ParseInput(string text)
        {
            if (_enabled)
            {
                _input++;
                Publish("input", text, null);
            }
            return text;
        }

        public void VariableChanged(string variable)
        {
            if (!_enabled) return;
            _vars++;
            string value = null;
            try { if (_host != null) value = _host.get_Variable(variable); } catch { }
            Publish("variable", variable, value);
        }

        // ------------------------------------------------------------ sockets --

        private void AcceptLoop()
        {
            while (_running)
            {
                try
                {
                    TcpClient tcp = _listener.AcceptTcpClient();
                    var client = new Client(tcp, this);
                    lock (_clientLock) _clients.Add(client);
                    client.Start();
                    // A hello, so a connecting tool knows what it is talking to
                    // without having to wait for the game to say something.
                    client.Enqueue(Json("hello",
                        "plugin", Name,
                        "version", Version,
                        "port", Port.ToString()));
                }
                catch (Exception)
                {
                    // Stop() on shutdown lands here. Anything else is a socket
                    // fault we cannot usefully report from this thread.
                    if (!_running) return;
                    Thread.Sleep(200);
                }
            }
        }

        /// <summary>Called by a client thread when the far end sends a line.</summary>
        internal void OnClientLine(string line)
        {
            if (line == null) return;
            line = line.Trim();
            if (line.Length == 0) return;

            // The command form is deliberately trivial: a bare line is sent to
            // the game as typed. JSON in this direction would buy nothing and
            // cost a parser in a file that must not throw.
            if (line.StartsWith("send "))
            {
                string cmd = line.Substring(5);
                try
                {
                    if (_host != null)
                    {
                        _host.SendText(cmd);
                        _sent++;
                    }
                }
                catch (Exception e)
                {
                    Echo("[companion] send failed: " + e.Message);
                }
            }
            else if (line.StartsWith("echo "))
            {
                Echo(line.Substring(5));
            }
            else if (line.StartsWith("var "))
            {
                string name = line.Substring(4);
                string value = null;
                try { if (_host != null) value = _host.get_Variable(name); } catch { }
                Broadcast(Json("variable", "name", name, "value", value));
            }
        }

        internal void Remove(Client c)
        {
            lock (_clientLock) _clients.Remove(c);
        }

        private void Publish(string kind, string a, string b)
        {
            string payload = kind == "variable"
                ? Json(kind, "name", a, "value", b)
                : (b == null ? Json(kind, "line", a) : Json(kind, "line", a, "window", b));
            Broadcast(payload);
        }

        private void Broadcast(string payload)
        {
            lock (_clientLock)
            {
                for (int i = _clients.Count - 1; i >= 0; i--)
                {
                    if (!_clients[i].Enqueue(payload)) _dropped++;
                }
            }
        }

        private void Echo(string s)
        {
            try { if (_host != null) _host.EchoText(s + Environment.NewLine); } catch { }
        }

        // -------------------------------------------------------------- json --

        /// <summary>
        /// A tiny JSON writer, because .NET 4.0 ships no usable one and a
        /// dependency in a plugin DLL is a file somebody has to also install.
        /// </summary>
        private static string Json(string type, params string[] pairs)
        {
            var sb = new StringBuilder(128);
            sb.Append("{\"t\":\"").Append(Escape(type)).Append('"');
            for (int i = 0; i + 1 < pairs.Length; i += 2)
            {
                sb.Append(",\"").Append(Escape(pairs[i])).Append("\":");
                if (pairs[i + 1] == null) sb.Append("null");
                else sb.Append('"').Append(Escape(pairs[i + 1])).Append('"');
            }
            sb.Append('}');
            return sb.ToString();
        }

        private static string Escape(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            var sb = new StringBuilder(s.Length + 16);
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        // Control characters would produce invalid JSON, and the
                        // game stream carries them.
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        // ------------------------------------------------------------ client --

        internal class Client
        {
            private readonly TcpClient _tcp;
            private readonly CompanionBridge _owner;
            private readonly BlockingCollection<string> _out =
                new BlockingCollection<string>(new ConcurrentQueue<string>(), MaxQueued);
            private Thread _writer, _reader;
            private volatile bool _open = true;

            internal Client(TcpClient tcp, CompanionBridge owner)
            {
                _tcp = tcp;
                _tcp.NoDelay = true;
                _owner = owner;
            }

            internal void Start()
            {
                _writer = new Thread(WriteLoop) { IsBackground = true, Name = "companion-write" };
                _reader = new Thread(ReadLoop) { IsBackground = true, Name = "companion-read" };
                _writer.Start();
                _reader.Start();
            }

            /// <summary>False when the queue is full, so the caller can count it.</summary>
            internal bool Enqueue(string line)
            {
                if (!_open) return false;
                return _out.TryAdd(line);
            }

            private void WriteLoop()
            {
                try
                {
                    var stream = _tcp.GetStream();
                    foreach (string line in _out.GetConsumingEnumerable())
                    {
                        byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
                        stream.Write(bytes, 0, bytes.Length);
                        stream.Flush();
                    }
                }
                catch (Exception) { }
                finally { Close(); }
            }

            private void ReadLoop()
            {
                try
                {
                    var reader = new StreamReader(_tcp.GetStream(), Encoding.UTF8);
                    string line;
                    while (_open && (line = reader.ReadLine()) != null)
                    {
                        _owner.OnClientLine(line);
                    }
                }
                catch (Exception) { }
                finally { Close(); }
            }

            internal void Close()
            {
                if (!_open) return;
                _open = false;
                try { _out.CompleteAdding(); } catch { }
                try { _tcp.Close(); } catch { }
                _owner.Remove(this);
            }
        }
    }
}
