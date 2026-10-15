using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Updater
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length < 6 || args[0] != "--apply") { Environment.ExitCode = 1; return; }
        if (Array.IndexOf(args, "--no-restart") >= 0) { Apply(args, null); return; }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new UpdateForm(args));
    }

    internal static bool Apply(string[] args, Action<string, int> report)
    {
        string root = Path.GetFullPath(args[1]);
        try
        {
            if (report != null) report("Aguardando o inicializador encerrar…", 0);
            int parent = int.Parse(args[5]);
            if (parent > 0)
            {
                try { using (Process launcher = Process.GetProcessById(parent)) if (!launcher.WaitForExit(30000)) throw new IOException("O inicializador ainda está aberto."); }
                catch (ArgumentException) { }
            }
            // Block a second launcher while files are being replaced.
            string identity;
            using (SHA256 hash = SHA256.Create())
                identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(root.TrimEnd('\\', '/') .ToLowerInvariant() + Path.DirectorySeparatorChar))).Replace("-", "");
            using (System.Threading.Mutex mutex = new System.Threading.Mutex(false, "Local\\PokemonSimulator-" + identity))
            {
                bool acquired;
                try { acquired = mutex.WaitOne(30000); }
                catch (System.Threading.AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new IOException("Outra instância desta pasta está aberta. Feche o jogo e tente novamente.");
                try { Install(root, Path.GetFullPath(args[2]), args[3], args[4], report); }
                finally { mutex.ReleaseMutex(); }
            }
            Log(root, "Atualização " + args[4] + " concluída. Saves e configuração local preservados.");
            return true;
        }
        catch (Exception error)
        {
            Environment.ExitCode = 1;
            Log(root, "Falha na atualização: " + error);
            if (report != null) report("A atualização não foi aplicada. " + error.Message + "\nDetalhes em logs/update.log. Você pode iniciar a versão anterior pelo botão abaixo.", 0);
            return false;
        }
    }

    internal static void Restart(string root)
    {
        Process child = Process.Start(new ProcessStartInfo(Path.Combine(root, "PokemonSimulator.exe"), "--skip-update") { UseShellExecute = true, WorkingDirectory = root });
        Log(root, "Reiniciando o jogo (PID " + child.Id + ").");
    }

    internal static void SignalReady(string[] args)
    {
        string root = Path.GetFullPath(args[1]);
        if (!Directory.Exists(root) || !File.Exists(args[2])) throw new IOException("Pasta do jogo ou pacote de atualização ausente.");
        string logDirectory = Path.Combine(root, "logs");
        Directory.CreateDirectory(logDirectory);
        string probe = Path.Combine(logDirectory, Guid.NewGuid().ToString("N") + ".tmp");
        File.WriteAllText(probe, "ready");
        File.Delete(probe);
        int ready = Array.IndexOf(args, "--ready-file");
        if (ready >= 0 && ready + 1 < args.Length) File.WriteAllText(args[ready + 1], "ready");
        Log(root, "Instalador iniciado para " + args[4] + ".");
    }

    internal static void Install(string root, string archive, string checksum, string version, Action<string, int> report = null)
    {
        if (report != null) report("Verificando a integridade do pacote…", 0);
        string actual;
        using (SHA256 hash = SHA256.Create())
        using (FileStream stream = File.OpenRead(archive)) actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        if (!string.Equals(actual, checksum, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Checksum do pacote não confere.");
        // The downloaded ZIP lives in a deep AppData directory. Keep extraction
        // and rollback paths short enough for .NET Framework's Windows limit.
        string temporary = Path.Combine(Path.GetTempPath(), "PSU-" + Guid.NewGuid().ToString("N").Substring(0, 12));
        string stage = Path.Combine(temporary, "new");
        string backup = Path.Combine(temporary, "backup");
        Directory.CreateDirectory(stage);
        HashSet<string> extracted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long size = 0;
        using (ZipArchive zip = ZipFile.OpenRead(archive))
        {
            int index = 0;
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                string relative = entry.FullName.Replace('\\', '/');
                string target = Within(stage, relative);
                if (relative.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                if (!Allowed(relative) || !extracted.Add(relative) || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw new InvalidDataException("Arquivo não permitido no pacote: " + relative);
                size += entry.Length;
                if (size > 4L * 1024 * 1024 * 1024) throw new InvalidDataException("Pacote descompactado grande demais.");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                entry.ExtractToFile(target);
                if (report != null && ++index % 100 == 0) report("Descompactando os arquivos…", index * 60 / zip.Entries.Count);
            }
        }
        Dictionary<string, object> manifest = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 }.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(stage, "distribution.json")));
        if ((string)manifest["version"] != version || (string)manifest["kind"] != "update" || (string)manifest["platform"] != "win-x64") throw new InvalidDataException("Manifesto de atualização incompatível.");
        List<string> files = new List<string>();
        foreach (object item in (System.Collections.IEnumerable)manifest["files"])
        {
            string relative = (string)item;
            if (!Allowed(relative) || !extracted.Contains(relative) || files.Contains(relative)) throw new InvalidDataException("Manifesto de arquivos inválido.");
            if (relative != "distribution.json") files.Add(relative);
        }
        files.Add("distribution.json");
        if (extracted.Count != files.Count) throw new InvalidDataException("O conteúdo do pacote difere do manifesto.");
        List<string> attempted = new List<string>();
        HashSet<string> originals = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (string relative in files)
            {
                string target = Within(root, relative);
                string original = Within(backup, relative);
                if (File.Exists(target))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(original));
                    File.Copy(target, original);
                    originals.Add(relative);
                }
                attempted.Add(relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.Copy(Within(stage, relative), target, true);
                if (report != null && attempted.Count % 100 == 0) report("Instalando a versão " + version + "…", 60 + attempted.Count * 39 / files.Count);
            }
            // app/ é inteiramente do jogo: apaga o que a nova versão não usa mais (ex.: arquivos antigos da interface).
            HashSet<string> wanted = new HashSet<string>(files, StringComparer.OrdinalIgnoreCase);
            string appRoot = Path.Combine(root, "app");
            if (Directory.Exists(appRoot))
                foreach (string file in Directory.GetFiles(appRoot, "*", SearchOption.AllDirectories))
                {
                    string relative = file.Substring(root.TrimEnd(Path.DirectorySeparatorChar).Length + 1).Replace('\\', '/');
                    if (wanted.Contains(relative)) continue;
                    try { File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            if (report != null) report("Atualização " + version + " instalada. Iniciando o jogo…", 100);
        }
        catch
        {
            attempted.Reverse();
            foreach (string relative in attempted)
            {
                string target = Within(root, relative);
                try
                {
                    if (originals.Contains(relative)) File.Copy(Within(backup, relative), target, true);
                    else if (File.Exists(target)) File.Delete(target);
                }
                catch (Exception error) { Log(root, "Recuperação pendente de " + relative + ": " + error.Message + ". Backup em " + backup); }
            }
            throw;
        }
    }

    private static string Within(string root, string relative)
    {
        if (Path.IsPathRooted(relative) || relative.Contains(":")) throw new InvalidDataException("Caminho absoluto no pacote.");
        string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string target = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Caminho fora da pasta do jogo.");
        if (File.Exists(target) && (File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Arquivo redirecionado não permitido na atualização.");
        string directory = Path.GetDirectoryName(target);
        while (directory != null && directory.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            if (Directory.Exists(directory) && (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Pasta redirecionada não permitida na atualização.");
            directory = Path.GetDirectoryName(directory);
        }
        return target;
    }

    private static bool Allowed(string relative)
    {
        string normalized = relative.Replace('\\', '/');
        string name = Path.GetFileName(normalized);
        if (name.StartsWith(".env", StringComparison.OrdinalIgnoreCase) && name != ".env.example") return false;
        if ((normalized.EndsWith(".db", StringComparison.OrdinalIgnoreCase) || normalized.EndsWith(".db-wal", StringComparison.OrdinalIgnoreCase) || normalized.EndsWith(".db-shm", StringComparison.OrdinalIgnoreCase) || normalized.EndsWith(".db-journal", StringComparison.OrdinalIgnoreCase))) return false;
        if (normalized.EndsWith(".log", StringComparison.OrdinalIgnoreCase) || normalized.Contains("/.git/")) return false;
        foreach (string prefix in new string[] { "app/", "runtime/" }) if (normalized.StartsWith(prefix, StringComparison.Ordinal)) return true;
        foreach (string file in new string[] { "PokemonSimulator.exe", "PokemonSimulatorUpdater.exe", "release-config.json", "distribution.json", "README.md", "THIRD_PARTY_NOTICES.txt", "RELEASE_NOTES.md" }) if (normalized == file) return true;
        return false;
    }

    internal static void Log(string root, string message)
    {
        try { string directory = Path.Combine(root, "logs"); Directory.CreateDirectory(directory); File.AppendAllText(Path.Combine(directory, "update.log"), DateTime.Now.ToString("s") + " " + message + Environment.NewLine, Encoding.UTF8); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}

internal sealed class UpdateForm : Form
{
    private readonly Label status = new Label();
    private readonly ProgressBar progress = new ProgressBar();
    private readonly Button launch = new Button();
    private bool finished;
    private readonly string[] args;

    internal UpdateForm(string[] args)
    {
        this.args = args;
        Text = "Pokémon Simulator — Atualização " + args[4];
        ClientSize = new Size(580, 235);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        Font = new Font("Segoe UI", 10F);
        status.SetBounds(24, 24, 532, 110);
        status.Text = "Preparando a instalação. Seus saves e sprites serão preservados…";
        progress.SetBounds(24, 142, 532, 24);
        launch.SetBounds(316, 183, 240, 32);
        launch.Text = "Iniciar a versão instalada";
        launch.Visible = false;
        launch.Click += delegate { Restart(); };
        Controls.AddRange(new Control[] { status, progress, launch });
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!finished) e.Cancel = true; };
        Shown += delegate
        {
            try { Updater.SignalReady(args); }
            catch (Exception error)
            {
                Updater.Log(args[1], "Instalador não pôde iniciar: " + error);
                finished = true; Environment.ExitCode = 1; Close(); return;
            }
            System.Threading.ThreadPool.QueueUserWorkItem(delegate
            {
                bool success = Updater.Apply(args, Report);
                BeginInvoke((Action)delegate
                {
                    finished = true;
                    if (success) Restart();
                    else launch.Visible = true;
                });
            });
        };
    }

    private void Report(string message, int percent)
    {
        BeginInvoke((Action)delegate { status.Text = message; progress.Value = Math.Max(0, Math.Min(100, percent)); });
    }

    private void Restart()
    {
        try { Updater.Restart(Path.GetFullPath(args[1])); Close(); }
        catch (Exception error)
        {
            Updater.Log(args[1], "Não foi possível reiniciar: " + error);
            status.Text = "A instalação terminou, mas o jogo não pôde abrir: " + error.Message;
            launch.Visible = true;
        }
    }
}
