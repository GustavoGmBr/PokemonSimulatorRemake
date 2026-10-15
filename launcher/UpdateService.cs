using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class UpdateService
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };

    // Versões como 2.0.0-alpha.12: números principais e, se houver, o sufixo de pré-lançamento.
    internal sealed class SemVer : IComparable<SemVer>
    {
        internal int Major, Minor, Patch;
        internal string[] Pre = new string[0];
        internal static readonly Regex Pattern = new Regex(@"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$");

        internal static SemVer Parse(string text)
        {
            Match m = Pattern.Match(text);
            if (!m.Success) return null;
            SemVer v = new SemVer();
            v.Major = int.Parse(m.Groups[1].Value);
            v.Minor = int.Parse(m.Groups[2].Value);
            v.Patch = int.Parse(m.Groups[3].Value);
            if (m.Groups[4].Success) v.Pre = m.Groups[4].Value.Split('.');
            return v;
        }

        public int CompareTo(SemVer other)
        {
            int c = Major.CompareTo(other.Major);
            if (c == 0) c = Minor.CompareTo(other.Minor);
            if (c == 0) c = Patch.CompareTo(other.Patch);
            if (c != 0) return c;
            if (Pre.Length == 0 && other.Pre.Length == 0) return 0;
            if (Pre.Length == 0) return 1;       // 1.0.0 > 1.0.0-alpha
            if (other.Pre.Length == 0) return -1;
            for (int i = 0; i < Math.Min(Pre.Length, other.Pre.Length); i++)
            {
                int a, b;
                bool an = int.TryParse(Pre[i], out a), bn = int.TryParse(other.Pre[i], out b);
                if (an && bn) { c = a.CompareTo(b); if (c != 0) return c; }
                else if (an) return -1;
                else if (bn) return 1;
                else { c = string.CompareOrdinal(Pre[i], other.Pre[i]); if (c != 0) return c; }
            }
            return Pre.Length.CompareTo(other.Pre.Length);
        }

        public override string ToString()
        {
            return Major + "." + Minor + "." + Patch + (Pre.Length > 0 ? "-" + string.Join(".", Pre) : "");
        }
    }

    internal static bool Check(string root, Action<string> report, Func<bool> cancelled)
    {
        try
        {
            string configPath = Path.Combine(root, "release-config.json");
            string manifestPath = Path.Combine(root, "distribution.json");
            if (!File.Exists(configPath) || !File.Exists(manifestPath)) return false;
            Dictionary<string, object> config = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath));
            Dictionary<string, object> manifest = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(manifestPath));
            string repository = (string)config["repository"];
            if (!Regex.IsMatch(repository, @"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")) throw new InvalidDataException("Repositório de atualização inválido.");
            SemVer installed = SemVer.Parse((string)manifest["version"]);
            if (installed == null) throw new InvalidDataException("Versão instalada inválida.");
            report("Verificando atualizações…");
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            // Lista as releases (a rota "latest" ignora pré-lançamentos como as versões alpha).
            object[] releases = Json.Deserialize<object[]>(ReadText("https://api.github.com/repos/" + repository + "/releases?per_page=20"));
            Dictionary<string, object> release = null;
            SemVer latest = installed;
            string tag = null;
            foreach (object value in releases)
            {
                Dictionary<string, object> candidate = (Dictionary<string, object>)value;
                if ((bool)candidate["draft"]) continue;
                string candidateTag = (string)candidate["tag_name"];
                if (!candidateTag.StartsWith("v")) continue;
                SemVer version = SemVer.Parse(candidateTag.Substring(1));
                if (version == null) continue;
                // Quem usa uma versão estável só recebe estáveis; quem usa alpha/beta recebe também pré-lançamentos.
                if (version.Pre.Length > 0 && installed.Pre.Length == 0) continue;
                if (version.CompareTo(latest) > 0) { latest = version; release = candidate; tag = candidateTag; }
            }
            if (release == null)
            {
                report("A versão instalada está atualizada. Iniciando o jogo…");
                return false;
            }
            string name = (string)config["assetPrefix"] + "-" + tag + "-update-win-x64.zip";
            string archiveUrl = null;
            string checksumUrl = null;
            foreach (object value in (System.Collections.IEnumerable)release["assets"])
            {
                Dictionary<string, object> asset = (Dictionary<string, object>)value;
                if ((string)asset["name"] == name) archiveUrl = (string)asset["browser_download_url"];
                if ((string)asset["name"] == name + ".sha256") checksumUrl = (string)asset["browser_download_url"];
            }
            if (archiveUrl == null || checksumUrl == null) throw new InvalidDataException("A versão publicada ainda não contém o pacote completo de atualização.");
            string expectedPrefix = "https://github.com/" + repository + "/releases/download/" + tag + "/";
            if (!archiveUrl.StartsWith(expectedPrefix, StringComparison.Ordinal) || !checksumUrl.StartsWith(expectedPrefix, StringComparison.Ordinal)) throw new InvalidDataException("Endereço de atualização inválido.");
            string checksum = ReadText(checksumUrl).Trim().Split(' ', '\t', '\r', '\n')[0].ToLowerInvariant();
            if (!Regex.IsMatch(checksum, @"^[a-f0-9]{64}$")) throw new InvalidDataException("Checksum inválido.");
            if (cancelled()) return false;
            string temporary = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PokemonSimulator", "updates", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            string archive = Path.Combine(temporary, name);
            Download(archiveUrl, archive, report, tag, cancelled);
            string actual;
            using (SHA256 hash = SHA256.Create())
            using (FileStream stream = File.OpenRead(archive)) actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            if (actual != checksum) throw new InvalidDataException("O download não passou na verificação de integridade. A versão instalada será mantida.");
            if (cancelled()) return false;
            string helper = Path.Combine(temporary, "PokemonSimulatorUpdater.exe");
            // Use the installer shipped with the verified release, including its fixes.
            using (ZipArchive zip = ZipFile.OpenRead(archive))
            {
                ZipArchiveEntry entry = zip.GetEntry("PokemonSimulatorUpdater.exe");
                if (entry == null || entry.Length < 1024 || entry.Length > 2 * 1024 * 1024) throw new InvalidDataException("Instalador ausente ou inválido no pacote.");
                entry.ExtractToFile(helper);
            }
            string ready = Path.Combine(temporary, "installer.ready");
            report("Download concluído. Preparando a instalação de " + tag + "…");
            ProcessStartInfo start = new ProcessStartInfo(helper);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WorkingDirectory = temporary;
            start.Arguments = "--apply " + Quote(root) + " " + Quote(archive) + " " + checksum + " " + latest.ToString() + " " + Process.GetCurrentProcess().Id + " --ready-file " + Quote(ready);
            using (Process installer = Process.Start(start))
            {
                DateTime deadline = DateTime.UtcNow.AddSeconds(20);
                while (!File.Exists(ready))
                {
                    if (installer.HasExited) throw new IOException("O instalador não iniciou. Consulte logs/update.log.");
                    if (cancelled() || DateTime.UtcNow > deadline)
                    {
                        try { installer.Kill(); } catch (InvalidOperationException) { }
                        throw new IOException("O instalador não confirmou a inicialização. A versão instalada foi mantida.");
                    }
                    System.Threading.Thread.Sleep(100);
                }
            }
            report("Instalador iniciado. Aguarde a conclusão na janela de atualização; o jogo abrirá automaticamente.");
            return true;
        }
        catch (Exception error)
        {
            report("Atualização indisponível: " + error.Message + " Iniciando a versão instalada.");
            return false;
        }
    }

    internal static string Quote(string value)
    {
        // Windows doubles trailing backslashes before a closing quote.
        // BaseDirectory ends in a slash; quoting it verbatim corrupts --apply args.
        StringBuilder quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { quoted.Append('\\', slashes * 2 + 1); quoted.Append('"'); }
            else { quoted.Append('\\', slashes); quoted.Append(character); }
            slashes = 0;
        }
        quoted.Append('\\', slashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }

    private static HttpWebRequest Request(string url, int timeout)
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.UserAgent = "PokemonSimulator-Updater";
        request.Accept = "application/vnd.github+json";
        request.Timeout = timeout;
        request.ReadWriteTimeout = timeout;
        request.AutomaticDecompression = DecompressionMethods.GZip;
        return request;
    }

    private static string ReadText(string url)
    {
        using (WebResponse response = Request(url, 4000).GetResponse())
        using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
        {
            if (response.ContentLength > 4 * 1024 * 1024) throw new InvalidDataException("Resposta de atualização grande demais.");
            return reader.ReadToEnd();
        }
    }

    private static void Download(string url, string destination, Action<string> report, string version, Func<bool> cancelled)
    {
        HttpWebRequest request = Request(url, 30000);
        using (WebResponse response = request.GetResponse())
        using (Stream source = response.GetResponseStream())
        using (FileStream output = File.Create(destination))
        {
            long total = response.ContentLength;
            long received = 0;
            byte[] buffer = new byte[65536];
            DateTime deadline = DateTime.UtcNow.AddMinutes(10);
            DateTime reported = DateTime.MinValue;
            int count;
            while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (cancelled()) throw new OperationCanceledException();
                if (DateTime.UtcNow > deadline || received > 2L * 1024 * 1024 * 1024) throw new IOException("O download excedeu o limite permitido.");
                output.Write(buffer, 0, count);
                received += count;
                if ((DateTime.UtcNow - reported).TotalSeconds >= 1)
                {
                    report("Baixando " + version + "… " + (total > 0 ? (received * 100 / total) + "%" : (received / 1024 / 1024) + " MB"));
                    reported = DateTime.UtcNow;
                }
            }
            if (total >= 0 && received != total) throw new IOException("Download incompleto.");
        }
    }
}
