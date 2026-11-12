using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class ScreenCapture
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    private static int Main(string[] args)
    {
        var fps = 20;
        var width = 720;
        var quality = 50L;
        for (var i = 0; i + 1 < args.Length; i++)
        {
            if (args[i] == "-fps") int.TryParse(args[i + 1], out fps);
            else if (args[i] == "-width") int.TryParse(args[i + 1], out width);
            else if (args[i] == "-quality") long.TryParse(args[i + 1], out quality);
        }
        fps = Math.Max(1, Math.Min(30, fps));
        width = Math.Max(320, Math.Min(1920, width));
        quality = Math.Max(20, Math.Min(90, quality));

        SetProcessDPIAware();
        var sw = GetSystemMetrics(0);
        var sh = GetSystemMetrics(1);
        if (sw <= 0 || sh <= 0) return 2;
        var ratio = Math.Min(1.0, width / (double)sw);
        var ow = Math.Max(1, (int)(sw * ratio));
        var oh = Math.Max(1, (int)(sh * ratio));

        var codec = GetEncoder();
        var encoderParams = new EncoderParameters(1);
        encoderParams.Param[0] = new EncoderParameter(Encoder.Quality, quality);
        var frameBudget = 1000 / fps;
        var clock = Stopwatch.StartNew();

        try
        {
            using (var stdout = Console.OpenStandardOutput())
            {
                while (true)
                {
                    var started = clock.ElapsedMilliseconds;
                    using (var full = new Bitmap(sw, sh, PixelFormat.Format24bppRgb))
                    {
                        using (var g = Graphics.FromImage(full))
                            g.CopyFromScreen(0, 0, 0, 0, new Size(sw, sh), CopyPixelOperation.SourceCopy);

                        using (var small = new Bitmap(ow, oh, PixelFormat.Format24bppRgb))
                        {
                            using (var g = Graphics.FromImage(small))
                            {
                                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                                g.DrawImage(full, 0, 0, ow, oh);

                                // CopyFromScreen 不画系统光标；补一个高对比圆环，手机上能看见位置。
                                var cursor = Cursor.Position;
                                var cx = (int)(cursor.X * (ow / (double)sw));
                                var cy = (int)(cursor.Y * (oh / (double)sh));
                                using (var black = new Pen(Color.FromArgb(210, 0, 0, 0), 3))
                                using (var white = new Pen(Color.FromArgb(240, 255, 255, 255), 1.5f))
                                {
                                    g.DrawEllipse(black, cx - 6, cy - 6, 12, 12);
                                    g.DrawEllipse(white, cx - 6, cy - 6, 12, 12);
                                }
                            }

                            using (var ms = new MemoryStream())
                            {
                                small.Save(ms, codec, encoderParams);
                                var bytes = ms.ToArray();
                                var len = BitConverter.GetBytes(bytes.Length);
                                stdout.Write(len, 0, 4);
                                stdout.Write(bytes, 0, bytes.Length);
                                stdout.Flush();
                            }
                        }
                    }

                    var spent = clock.ElapsedMilliseconds - started;
                    var sleep = frameBudget - (int)spent;
                    if (sleep > 0) Thread.Sleep(sleep);
                }
            }
        }
        catch (IOException)
        {
            return 0;
        }
        catch
        {
            return 1;
        }
        finally
        {
            encoderParams.Dispose();
        }
    }

    private static ImageCodecInfo GetEncoder()
    {
        foreach (var codec in ImageCodecInfo.GetImageEncoders())
            if (codec.FormatID == ImageFormat.Jpeg.Guid) return codec;
        throw new InvalidOperationException("JPEG encoder not found");
    }
}
