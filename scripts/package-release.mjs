import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const releaseBaseDir = path.resolve(rootDir, "..", "release");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const releaseName = `wecom-recorder-h5-mysql-${stamp}`;
const outputDir = path.join(releaseBaseDir, releaseName);
const archivePath = path.join(releaseBaseDir, `${releaseName}.zip`);

const excludedDirectoryNames = new Set([".git", ".npm-cache", "node_modules", "logs", "tmp"]);
const excludedRelativePaths = new Set([
  "server/data",
  "server/storage/audio",
  "server/storage/attachments",
  "server/storage/bin",
  "server/storage/transcripts",
  "server/storage/tmp",
  "server/storage/tts",
]);

function normalizedRelative(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function assertInside(child, parent) {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Refusing to write outside release folder: ${resolvedChild}`);
  }
}

function shouldSkip(relativePath, entry) {
  const normalized = normalizedRelative(relativePath);
  if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) return true;
  if (excludedRelativePaths.has(normalized)) return true;
  for (const excluded of excludedRelativePaths) {
    if (normalized.startsWith(`${excluded}/`)) return true;
  }
  if (entry.isFile() && (entry.name.endsWith(".log") || entry.name.endsWith(".err"))) return true;
  return false;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(sourceDir, targetDir, relativeBase = "") {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeBase, entry.name);
    if (shouldSkip(relativePath, entry)) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, targetPath, relativePath);
    } else if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}

function readEnvValue(raw, key) {
  const match = raw.match(new RegExp(`^\\s*${key}\\s*=([^\\r\\n]*)`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function setEnvValue(raw, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  if (pattern.test(raw)) return raw.replace(pattern, line);
  return `${raw.replace(/\s*$/, "")}\n${line}\n`;
}

async function ensurePackageEnv() {
  const envPath = path.join(outputDir, ".env");
  if (!(await exists(envPath))) {
    const examplePath = path.join(rootDir, ".env.example");
    const fallback = (await exists(examplePath)) ? await readFile(examplePath, "utf8") : "";
    await writeFile(envPath, fallback, "utf8");
  }

  let raw = await readFile(envPath, "utf8");
  const hasConfiguredMysql = Boolean(readEnvValue(raw, "DATABASE_URL") || readEnvValue(raw, "MYSQL_HOST"));
  if (!hasConfiguredMysql) {
    raw = setEnvValue(raw, "MYSQL_HOST", "127.0.0.1");
    raw = setEnvValue(raw, "MYSQL_PORT", "3306");
    raw = setEnvValue(raw, "MYSQL_USER", "wecom_recorder");
    raw = setEnvValue(raw, "MYSQL_PASSWORD", "wecom_recorder");
    raw = setEnvValue(raw, "MYSQL_DATABASE", "wecom_recorder");
  }
  await writeFile(envPath, raw.replace(/\s*$/, "\n"), "utf8");
}

async function createEmptyRuntimeFolders() {
  const folders = [
    "server/data",
    "server/storage/accounts",
    "server/storage/audio",
    "server/storage/attachments",
    "server/storage/bin",
    "server/storage/transcripts",
    "server/storage/tmp",
    "server/storage/tts",
  ];

  for (const folder of folders) {
    const absolute = path.join(outputDir, folder);
    await mkdir(absolute, { recursive: true });
    await writeFile(path.join(absolute, ".gitkeep"), "", "utf8");
  }
}

async function writeDeploymentHelpers() {
  const schemaPath = path.join(outputDir, "docs", "mysql-schema.sql");
  if (await exists(schemaPath)) {
    await copyFile(schemaPath, path.join(outputDir, "mysql-init.sql"));
  }

  await writeFile(
    path.join(outputDir, "启动.bat"),
    [
      "@echo off",
      "chcp 65001 >nul",
      "cd /d \"%~dp0\"",
      "if not exist node_modules (",
      "  echo 正在安装程序依赖，请稍等...",
      "  npm install",
      "  if errorlevel 1 (",
      "    echo 依赖安装失败，请确认已安装 Node.js。",
      "    pause",
      "    exit /b 1",
      "  )",
      ")",
      "echo 正在启动企业微信录音 H5...",
      "npm run start",
      "pause",
      "",
    ].join("\r\n"),
    "utf8",
  );
  await copyFile(path.join(outputDir, "启动.bat"), path.join(outputDir, "START.bat"));

  await writeFile(
    path.join(outputDir, "初始化MySQL.bat"),
    [
      "@echo off",
      "chcp 65001 >nul",
      "cd /d \"%~dp0\"",
      "where mysql >nul 2>nul",
      "if errorlevel 1 (",
      "  echo 没有找到 mysql 命令，请先安装 MySQL 并把 mysql 加入系统 PATH。",
      "  pause",
      "  exit /b 1",
      ")",
      "echo 将使用 root 账号初始化 wecom_recorder 数据库和账号。",
      "echo 系统稍后会要求输入 MySQL root 密码。",
      "mysql -u root -p < mysql-init.sql",
      "pause",
      "",
    ].join("\r\n"),
    "utf8",
  );
  await copyFile(path.join(outputDir, "初始化MySQL.bat"), path.join(outputDir, "INIT_MYSQL.bat"));

  await writeFile(
    path.join(outputDir, "README-部署说明.txt"),
    [
      "企业微信录音 H5 部署包",
      "",
      "1. 本包已包含当前 .env 中的 API KEY 等配置，请不要公开传播这个压缩包。",
      "2. 本包不包含之前上传过的录音、文字稿、附件、日志和本地 db.json。",
      "3. 数据存储使用 MySQL。首次在新电脑使用时，请先安装 MySQL，再双击“初始化MySQL.bat”。",
      "4. 初始化完成后，双击“启动.bat”即可启动程序。默认服务地址为 http://127.0.0.1:8787/。",
      "",
      "目录说明：",
      "- server/storage/accounts/：账号相关独立文件目录，便于后续管理头像等账号资产。",
      "- server/storage/audio/：新电脑后续上传的 MP3 录音文件会放在这里。",
      "- server/storage/transcripts/YYYY-MM-DD/：新电脑后续生成的录音文字稿会按日期分类保存。",
      "- MySQL 表 transcript_segments、recording_questions、app_accounts、daily_meeting_briefs 会保存文字段落、问答、账号和每日简报数据。",
      "",
      "默认 MySQL 配置：",
      "- 数据库：wecom_recorder",
      "- 用户名：wecom_recorder",
      "- 密码：wecom_recorder",
      "如需改成自己的 MySQL 账号，请修改 .env 里的 MYSQL_HOST、MYSQL_USER、MYSQL_PASSWORD、MYSQL_DATABASE。",
      "",
    ].join("\r\n"),
    "utf8",
  );
  await copyFile(path.join(outputDir, "README-部署说明.txt"), path.join(outputDir, "README_DEPLOY.txt"));
}

async function refreshTimestamps(targetDir) {
  const now = new Date();
  const entries = await readdir(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await refreshTimestamps(entryPath);
    }
    await utimes(entryPath, now, now).catch(() => {});
  }
  await utimes(targetDir, now, now).catch(() => {});
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed${result.error ? `: ${result.error.message}` : ""}`);
  }
}

async function main() {
  await mkdir(releaseBaseDir, { recursive: true });
  assertInside(outputDir, releaseBaseDir);
  assertInside(archivePath, releaseBaseDir);

  if (process.platform === "win32") {
    run("cmd.exe", ["/d", "/s", "/c", "npm run build"]);
  } else {
    run("npm", ["run", "build"]);
  }

  await rm(outputDir, { recursive: true, force: true });
  await rm(archivePath, { force: true });
  await copyTree(rootDir, outputDir);
  await ensurePackageEnv();
  await createEmptyRuntimeFolders();
  await writeDeploymentHelpers();
  await refreshTimestamps(outputDir);

  if (process.platform === "win32") {
    run("tar.exe", ["-a", "-cf", archivePath, "-C", releaseBaseDir, releaseName]);
  } else {
    run("zip", ["-qr", archivePath, releaseName]);
  }

  console.log(`PACKAGE_FOLDER=${outputDir}`);
  console.log(`PACKAGE_ARCHIVE=${archivePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
