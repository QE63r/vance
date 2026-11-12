using System.Diagnostics;
using System.Drawing;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace VanceDesktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool created;
        using var mutex = new Mutex(true, @"Local\VanceDesktop.SingleInstance", out created);
        if (!created)
        {
            SignalExisting();
            return;
        }

        Application.Run(new ShellContext(args));
        GC.KeepAlive(mutex);
    }

    private static void SignalExisting()
    {
        try
        {
            using var show = EventWaitHandle.OpenExisting(@"Local\VanceDesktop.Show");
            show.Set();
        }
        catch
        {
            MessageBox.Show("梵境桌面壳已经在运行，请从托盘打开。", "梵境 Vance",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }
}

internal sealed class ShellContext : ApplicationContext
{
    private const string PanelUrl = "http://127.0.0.1:8787/pc?shell=1&frameless=1&view=home";
    private const string HealthUrl = "http://127.0.0.1:8787/health";

    private readonly string _repo;
    private readonly string _logPath;
    private readonly FramelessForm _form;
    private readonly WebView2 _web;
    private readonly NotifyIcon _tray;
    private readonly EventWaitHandle _showEvent;
    private Process? _host;
    private bool _startedHost;
    private bool _ready;
    private bool _exiting;

    public ShellContext(string[] args)
    {
        _repo = FindRepo();
        _logPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".vance", "desktop-host.log");
        Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);

        _form = new FramelessForm
        {
            Text = "梵境",
            StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new Size(1280, 820),
            MinimumSize = new Size(1000, 700),
            BackColor = Color.FromArgb(15, 19, 24),
            Padding = new Padding(5),
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
        };
        _form.FormClosing += OnFormClosing;

        _web = new WebView2 { Dock = DockStyle.Fill };
        _web.DefaultBackgroundColor = Color.FromArgb(15, 19, 24);
        _form.Controls.Add(_web);

        _tray = new NotifyIcon
        {
            Icon = _form.Icon,
            Text = "梵境 Vance",
            Visible = true,
            ContextMenuStrip = BuildMenu(),
        };
        _tray.DoubleClick += (_, _) => ShowPanel();

        _showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\VanceDesktop.Show");
        ThreadPool.RegisterWaitForSingleObject(
            _showEvent,
            (_, _) =>
            {
                try
                {
                    if (_form.IsHandleCreated) _form.BeginInvoke(new Action(ShowPanel));
                }
                catch { }
            },
            null,
            Timeout.Infinite,
            false);

        _ = InitializeAsync(args.Contains("--background"));
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开梵境面板", null, (_, _) => ShowPanel());
        menu.Items.Add("在手机上继续", null, (_, _) => ShowPanel());
        menu.Items.Add(new ToolStripSeparator());

        var startup = new ToolStripMenuItem("开机自启") { Checked = IsStartupEnabled() };
        startup.Click += (_, _) =>
        {
            SetStartup(!startup.Checked);
            startup.Checked = IsStartupEnabled();
        };
        menu.Items.Add(startup);

        menu.Items.Add("打开日志", null, (_, _) =>
        {
            try { Process.Start(SystemExe("notepad.exe"), _logPath); } catch { }
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, (_, _) => ExitShell());
        return menu;
    }

    private async Task InitializeAsync(bool background)
    {
        try
        {
            await Task.Run(StartHostIfNeeded);
        }
        catch (Exception ex)
        {
            AppendLog("start host failed: " + ex);
            _tray.ShowBalloonTip(4000, "梵境", "Host 启动失败，打开日志查看。", ToolTipIcon.Error);
        }

        if (!await WaitHealthAsync(30000))
        {
            AppendLog("host health timeout");
            _tray.ShowBalloonTip(5000, "梵境", "Host 未就绪；右键托盘 → 打开日志。", ToolTipIcon.Warning);
            return;
        }

        try
        {
            await InitWebViewAsync();
            _ready = true;
        }
        catch (Exception ex)
        {
            AppendLog("webview init failed: " + ex);
            MessageBox.Show(
                "WebView2 初始化失败。请确认已安装 Microsoft Edge WebView2 Runtime。\n\n" + ex.Message,
                "梵境 Vance", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        if (!background) ShowPanel();
        else _tray.ShowBalloonTip(2500, "梵境", "已在后台运行，双击托盘打开面板。", ToolTipIcon.Info);
    }

    private async Task InitWebViewAsync()
    {
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vance", "WebView2");
        Directory.CreateDirectory(userData);
        var env = await CoreWebView2Environment.CreateAsync(null, userData);
        await _web.EnsureCoreWebView2Async(env);

        _web.ZoomFactor = 1.0;
        _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _web.CoreWebView2.Settings.IsZoomControlEnabled = false;
        _web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
        _web.CoreWebView2.ProcessFailed += (_, e) =>
        {
            AppendLog("webview process failed: " + e.ProcessFailedKind);
            _tray.ShowBalloonTip(4000, "梵境", "页面进程异常，托盘退出后重开。", ToolTipIcon.Error);
        };
        _web.CoreWebView2.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) AppendLog("navigation failed: " + e.WebErrorStatus);
        };
        _web.CoreWebView2.WebMessageReceived += (_, e) =>
        {
            string message;
            try { message = e.TryGetWebMessageAsString(); }
            catch { return; }
            switch (message)
            {
                case "minimize":
                    _form.WindowState = FormWindowState.Minimized;
                    break;
                case "maximize":
                    _form.ToggleMaximize();
                    break;
                case "close":
                    _form.Hide();
                    break;
                case "drag":
                    _form.BeginDrag();
                    break;
            }
        };
        _web.Source = new Uri(PanelUrl);
    }

    private void ShowPanel()
    {
        if (!_ready || _form.IsDisposed) return;
        if (_form.WindowState == FormWindowState.Minimized) _form.WindowState = FormWindowState.Normal;
        _form.Show();
        _form.Activate();
        _form.BringToFront();
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_exiting) return;
        e.Cancel = true;
        _form.Hide();
    }

    private void ExitShell()
    {
        _exiting = true;
        _tray.Visible = false;
        StopHost();
        try { _showEvent.Dispose(); } catch { }
        _web.Dispose();
        _form.Close();
        _form.Dispose();
        _tray.Dispose();
        ExitThread();
    }

    private void StartHostIfNeeded()
    {
        if (PortOpen(8787))
        {
            AppendLog("host already running; reuse");
            return;
        }

        var node = FindNode() ?? throw new InvalidOperationException("node.exe not found");
        var sandbox = Path.GetFullPath(Path.Combine(_repo, "..", "sandbox"));
        var psi = new ProcessStartInfo(node)
        {
            WorkingDirectory = _repo,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add(Path.Combine(_repo, "tools", "host-demo.mjs"));
        psi.ArgumentList.Add(sandbox);
        psi.ArgumentList.Add("--tunnel");
        psi.Environment["VANCE_FUNNEL"] = "1";
        psi.Environment["PYTHONUTF8"] = "1";
        var key = Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY")
                  ?? Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY", EnvironmentVariableTarget.User);
        if (!string.IsNullOrEmpty(key)) psi.Environment["DEEPSEEK_API_KEY"] = key;

        _host = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _host.OutputDataReceived += (_, e) => AppendLog(e.Data);
        _host.ErrorDataReceived += (_, e) => AppendLog(e.Data);
        _host.Start();
        _host.BeginOutputReadLine();
        _host.BeginErrorReadLine();
        _startedHost = true;
        AppendLog("host started pid=" + _host.Id);
    }

    private async Task<bool> WaitHealthAsync(int milliseconds)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using var res = await http.GetAsync(HealthUrl);
                if (res.IsSuccessStatusCode) return true;
            }
            catch { }
            await Task.Delay(400);
        }
        return false;
    }

    private void StopHost()
    {
        try
        {
            if (_startedHost && _host is { HasExited: false })
            {
                Process.Start(new ProcessStartInfo(SystemExe("taskkill.exe"), $"/PID {_host.Id} /T /F")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                });
            }
        }
        catch { }
    }

    private void AppendLog(string? line)
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

    private static bool PortOpen(int port)
    {
        try
        {
            using var client = new TcpClient();
            return client.ConnectAsync("127.0.0.1", port).Wait(400) && client.Connected;
        }
        catch { return false; }
    }

    private static string FindRepo()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir != null; i++)
        {
            if (File.Exists(Path.Combine(dir.FullName, "tools", "host-demo.mjs"))) return dir.FullName;
            dir = dir.Parent;
        }
        var cwd = Directory.GetCurrentDirectory();
        if (File.Exists(Path.Combine(cwd, "tools", "host-demo.mjs"))) return cwd;
        throw new InvalidOperationException("Cannot find Vance repo (tools/host-demo.mjs)");
    }

    private static string? FindNode()
    {
        var candidates = new[]
        {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "nodejs", "node.exe"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private static string SystemExe(string name)
    {
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), name);
        return File.Exists(path) ? path : name;
    }

    private static bool IsStartupEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run", false);
        return key?.GetValue("VanceDesktop") != null;
    }

    private static void SetStartup(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (key == null) return;
        if (enabled)
            key.SetValue("VanceDesktop", $"\"{Application.ExecutablePath}\" --background");
        else
            key.DeleteValue("VanceDesktop", false);
    }
}

internal sealed class FramelessForm : Form
{
    private const int WM_NCHITTEST = 0x0084;
    private const int WM_NCLBUTTONDOWN = 0x00A1;
    private const int HTCLIENT = 1;
    private const int HTCAPTION = 2;
    private const int HTLEFT = 10;
    private const int HTRIGHT = 11;
    private const int HTTOP = 12;
    private const int HTTOPLEFT = 13;
    private const int HTTOPRIGHT = 14;
    private const int HTBOTTOM = 15;
    private const int HTBOTTOMLEFT = 16;
    private const int HTBOTTOMRIGHT = 17;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

    public FramelessForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        DoubleBuffered = true;
        ResizeRedraw = true;
    }

    public void ToggleMaximize()
    {
        if (WindowState == FormWindowState.Maximized)
        {
            WindowState = FormWindowState.Normal;
        }
        else
        {
            MaximizedBounds = Screen.FromControl(this).WorkingArea;
            WindowState = FormWindowState.Maximized;
        }
    }

    public void BeginDrag()
    {
        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        UpdateMaximizedBounds();
    }

    protected override void OnLocationChanged(EventArgs e)
    {
        base.OnLocationChanged(e);
        UpdateMaximizedBounds();
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        UpdateMaximizedBounds();
    }

    private void UpdateMaximizedBounds()
    {
        if (WindowState == FormWindowState.Normal)
            MaximizedBounds = Screen.FromControl(this).WorkingArea;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
        {
            base.WndProc(ref m);
            if (m.Result.ToInt32() == HTCLIENT)
            {
                var point = PointToClient(Cursor.Position);
                const int border = 6;
                var left = point.X <= border;
                var right = point.X >= ClientSize.Width - border;
                var top = point.Y <= border;
                var bottom = point.Y >= ClientSize.Height - border;

                if (top && left) m.Result = (IntPtr)HTTOPLEFT;
                else if (top && right) m.Result = (IntPtr)HTTOPRIGHT;
                else if (bottom && left) m.Result = (IntPtr)HTBOTTOMLEFT;
                else if (bottom && right) m.Result = (IntPtr)HTBOTTOMRIGHT;
                else if (left) m.Result = (IntPtr)HTLEFT;
                else if (right) m.Result = (IntPtr)HTRIGHT;
                else if (top) m.Result = (IntPtr)HTTOP;
                else if (bottom) m.Result = (IntPtr)HTBOTTOM;
            }
            return;
        }
        base.WndProc(ref m);
    }
}
