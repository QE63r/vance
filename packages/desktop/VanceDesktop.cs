using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace VanceDesktop
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "VanceDesktop.SingleInstance", out created))
            {
                if (!created)
                {
                    MessageBox.Show("梵境桌面壳已经在运行，请从托盘打开。", "梵境 Vance",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                bool background = Array.IndexOf(args, "--background") >= 0;
                Application.Run(new TrayContext(background));
                GC.KeepAlive(mutex);
            }
        }
    }

    internal sealed class TrayContext : ApplicationContext
    {
        private const string PanelUrl = "http://127.0.0.1:8787/pc?shell=1&view=home";
        private const string HealthUrl = "http://127.0.0.1:8787/health";
        private readonly string _repo;
        private readonly string _logPath;
        private readonly string _edge;
        private readonly string _profile;
        private readonly NotifyIcon _tray;
        private Process _host;
        private bool _startedHost;

        public TrayContext(bool background)
        {
            _repo = FindRepo();
            _logPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".vance", "desktop-host.log");
            _edge = FindEdge();
            _profile = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vance", "EdgeProfile");
            Directory.CreateDirectory(Path.GetDirectoryName(_logPath));
            Directory.CreateDirectory(_profile);

            _tray = new NotifyIcon();
            _tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            _tray.Text = "梵境 Vance";
            _tray.Visible = true;
            _tray.DoubleClick += delegate { OpenPanel(); };
            _tray.ContextMenuStrip = BuildMenu();

            try
            {
                StartHostIfNeeded();
            }
            catch (Exception ex)
            {
                AppendLog("start host failed: " + ex);
                _tray.ShowBalloonTip(4000, "梵境", "Host 启动失败，查看日志。", ToolTipIcon.Error);
            }

            if (WaitHealth(30000))
            {
                if (!background) OpenPanel();
                else _tray.ShowBalloonTip(2500, "梵境", "桌面壳已在后台运行，双击托盘打开面板。", ToolTipIcon.Info);
            }
            else
            {
                _tray.ShowBalloonTip(5000, "梵境", "Host 未就绪；右键托盘 → 打开日志。", ToolTipIcon.Warning);
            }
        }

        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开梵境面板", null, delegate { OpenPanel(); });
            menu.Items.Add("在手机上继续", null, delegate { OpenPanel(); });
            menu.Items.Add(new ToolStripSeparator());

            var startup = new ToolStripMenuItem("开机自启");
            startup.Checked = IsStartupEnabled();
            startup.Click += delegate
            {
                SetStartup(!startup.Checked);
                startup.Checked = IsStartupEnabled();
            };
            menu.Items.Add(startup);

            menu.Items.Add("打开日志", null, delegate
            {
                try { Process.Start(SystemExe("notepad.exe"), _logPath); } catch { }
            });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitShell(); });
            return menu;
        }

        private void OpenPanel()
        {
            try
            {
                if (!string.IsNullOrEmpty(_edge))
                {
                    var args = string.Format(
                        "--app={0} --user-data-dir=\"{1}\" --no-first-run --no-default-browser-check --window-size=1280,860",
                        PanelUrl, _profile);
                    Process.Start(new ProcessStartInfo(_edge, args)
                    {
                        UseShellExecute = false,
                        WorkingDirectory = _repo,
                    });
                }
                else
                {
                    Process.Start(PanelUrl);
                }
            }
            catch (Exception ex)
            {
                AppendLog("open panel failed: " + ex.Message);
                _tray.ShowBalloonTip(4000, "梵境", "打不开面板，请查看日志。", ToolTipIcon.Error);
            }
        }

        private void StartHostIfNeeded()
        {
            if (PortOpen(8787))
            {
                AppendLog("host already running; reuse");
                _startedHost = false;
                return;
            }

            var node = FindNode();
            if (node == null) throw new InvalidOperationException("node.exe not found");
            var sandbox = Path.GetFullPath(Path.Combine(_repo, "..", "sandbox"));
            var psi = new ProcessStartInfo(node, string.Format("\"{0}\" \"{1}\" --tunnel",
                Path.Combine(_repo, "tools", "host-demo.mjs"), sandbox))
            {
                WorkingDirectory = _repo,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.EnvironmentVariables["VANCE_FUNNEL"] = "1";
            psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            var key = Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY");
            if (string.IsNullOrEmpty(key))
                key = Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY", EnvironmentVariableTarget.User);
            if (!string.IsNullOrEmpty(key)) psi.EnvironmentVariables["DEEPSEEK_API_KEY"] = key;

            _host = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _host.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { AppendLog(e.Data); };
            _host.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { AppendLog(e.Data); };
            _host.Start();
            _host.BeginOutputReadLine();
            _host.BeginErrorReadLine();
            _startedHost = true;
            AppendLog("host started pid=" + _host.Id);
        }

        private bool WaitHealth(int milliseconds)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) })
            {
                while (DateTime.UtcNow < deadline)
                {
                    try
                    {
                        var res = http.GetAsync(HealthUrl).Result;
                        if (res.IsSuccessStatusCode) return true;
                    }
                    catch { }
                    Thread.Sleep(500);
                }
            }
            return false;
        }

        private static bool PortOpen(int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var task = client.ConnectAsync("127.0.0.1", port);
                    if (!task.Wait(400)) return false;
                    return client.Connected;
                }
            }
            catch { return false; }
        }

        private void ExitShell()
        {
            try
            {
                if (_startedHost && _host != null && !_host.HasExited)
                {
                    Process.Start(new ProcessStartInfo(SystemExe("taskkill.exe"),
                        "/PID " + _host.Id + " /T /F")
                    {
                        CreateNoWindow = true,
                        UseShellExecute = false,
                    });
                }
            }
            catch { }
            _tray.Visible = false;
            _tray.Dispose();
            ExitThread();
        }

        private void AppendLog(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            try
            {
                lock (this)
                {
                    File.AppendAllText(_logPath,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine,
                        Encoding.UTF8);
                }
            }
            catch { }
        }

        private static string FindRepo()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (var i = 0; i < 8 && dir != null; i++)
            {
                if (File.Exists(Path.Combine(dir.FullName, "tools", "host-demo.mjs"))) return dir.FullName;
                dir = dir.Parent;
            }
            var cwd = Directory.GetCurrentDirectory();
            if (File.Exists(Path.Combine(cwd, "tools", "host-demo.mjs"))) return cwd;
            throw new InvalidOperationException("Cannot find Vance repo (tools/host-demo.mjs)");
        }

        private static string FindNode()
        {
            var candidates = new[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
            };
            foreach (var p in candidates) if (File.Exists(p)) return p;
            return null;
        }

        private static string SystemExe(string name)
        {
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System), name);
            return File.Exists(path) ? path : name;
        }

        private static string FindEdge()
        {
            var candidates = new[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Microsoft", "Edge", "Application", "msedge.exe"),
            };
            foreach (var p in candidates) if (File.Exists(p)) return p;
            return null;
        }

        private static bool IsStartupEnabled()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", false))
            {
                return key != null && key.GetValue("VanceDesktop") != null;
            }
        }

        private static void SetStartup(bool enabled)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", true))
            {
                if (key == null) return;
                if (enabled)
                    key.SetValue("VanceDesktop", "\"" + Application.ExecutablePath + "\" --background");
                else
                    key.DeleteValue("VanceDesktop", false);
            }
        }
    }
}
