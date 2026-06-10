import { writeFile, unlink, access, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { constants } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const COOKIES_FILE = join(tmpdir(), "yt-cookies.txt");
const PYTHON = "/home/runner/workspace/.pythonlibs/bin/python3";
const VALIDATE_SCRIPT = join(process.cwd(), "validate_gemini_cookies.py");

export function getCookiesPath(): string {
  return COOKIES_FILE;
}

export type CookieStatus = "working" | "expired" | "invalid" | "incomplete" | "unchecked";

export interface CookieValidation {
  status: CookieStatus;
  hasPSID: boolean;
  hasPSIDTS: boolean;
  hasYouTube: boolean;
  hasGemini: boolean;
  message: string;
  geminiValid?: boolean;
  geminiMessage?: string;
}

function quickParseCookies(content: string) {
  const hasPSID = content.includes("__Secure-1PSID");
  const hasPSIDTS = content.includes("__Secure-1PSIDTS");
  const hasYouTube = content.includes(".youtube.com");
  const hasGoogle = content.includes(".google.com");
  const hasGemini = content.includes(".gemini.google.com") || (hasGoogle && hasPSID);
  return { hasPSID, hasPSIDTS, hasYouTube, hasGoogle, hasGemini };
}

export async function getDetailedCookiesStatus(): Promise<CookieValidation> {
  try {
    await access(COOKIES_FILE, constants.F_OK);
    const content = await readFile(COOKIES_FILE, "utf-8");
    const { hasPSID, hasPSIDTS, hasYouTube, hasGemini } = quickParseCookies(content);

    if (!hasPSID && !hasYouTube) {
      return { status: "incomplete", hasPSID: false, hasPSIDTS: false, hasYouTube, hasGemini: false, message: "ناقصة: مفقود __Secure-1PSID" };
    }

    const lines = content.split("\n");
    const now = Math.floor(Date.now() / 1000);
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length >= 5) {
        const expiry = parseInt(parts[4]);
        if (!isNaN(expiry) && expiry > 0 && expiry < now) {
          return { status: "expired", hasPSID, hasPSIDTS, hasYouTube, hasGemini, message: "منتهية الصلاحية ⚠️" };
        }
      }
    }

    const msg = hasGemini && hasYouTube ? "محفوظة (Google + يوتيوب + Gemini)" :
      hasGemini ? "محفوظة (Google/Gemini) ✅" : "محفوظة (يوتيوب) ✅";
    return { status: "unchecked", hasPSID, hasPSIDTS, hasYouTube, hasGemini, message: msg };
  } catch {
    return { status: "invalid", hasPSID: false, hasPSIDTS: false, hasYouTube: false, hasGemini: false, message: "لا توجد كوكيز محفوظة" };
  }
}

export async function hasCookies(): Promise<boolean> {
  const s = await getDetailedCookiesStatus();
  return s.status !== "invalid" && s.status !== "incomplete" && s.hasPSID;
}

async function notifyGeminiReload(): Promise<void> {
  try {
    await fetch("http://127.0.0.1:19999/reload", {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* server might not be running yet — that's fine */ }
}

export async function saveCookies(content: string): Promise<void> {
  const { hasPSID, hasYouTube, hasGoogle } = quickParseCookies(content);
  if (!hasPSID && !hasYouTube && !hasGoogle) {
    throw new Error("الكوكيز لا تحتوي على القيم المطلوبة (__Secure-1PSID أو .google.com)");
  }

  const important = [
    "__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-3PSID",
    "__Secure-1PSIDCC", "__Secure-3PSIDCC",
    "SID", "HSID", "SSID", "APISID", "SAPISID",
    "__Secure-1PAPISID", "__Secure-3PAPISID",
    "SIDCC", "NID", "COMPASS",
  ];

  // Cookies shared between google.com and youtube.com — copied to youtube.com
  // so yt-dlp can authenticate with YouTube using Google SSO cookies.
  const sharedWithYouTube = ["SID", "HSID", "SSID", "APISID", "SAPISID", "SIDCC"];

  const lines = content.split("\n");
  const filtered = lines.filter(line => {
    if (line.startsWith("#") || line.trim() === "") return true;
    return important.some(n => line.includes(n)) || line.includes(".youtube.com");
  });

  // Auto-generate .youtube.com versions of shared auth cookies
  // This allows yt-dlp to find YouTube domain cookies for bot-check bypass.
  const ytLines: string[] = [];
  if (!filtered.some(l => l.includes(".youtube.com"))) {
    for (const line of filtered) {
      if (line.startsWith("#") || line.trim() === "") continue;
      const parts = line.split("\t");
      if (parts.length < 7) continue;
      const cookieName = parts[5];
      if (sharedWithYouTube.includes(cookieName) && parts[0].includes(".google.com")) {
        // Clone the line for .youtube.com domain
        const ytLine = [".youtube.com", "TRUE", "/", parts[3], parts[4], cookieName, parts[6]].join("\t");
        ytLines.push(ytLine);
      }
    }
  }

  const allLines = [...filtered, ...ytLines];
  await writeFile(COOKIES_FILE, allLines.join("\n") + "\n", "utf-8");
  notifyGeminiReload().catch(() => {});
}

export async function deleteCookies(): Promise<void> {
  try { await unlink(COOKIES_FILE); } catch { /* ignore */ }
}

// ── YouTube-specific cookies (used by yt-dlp) ────────────────────────────────

const YT_COOKIES_FILE = join(tmpdir(), "yt-cookies-direct.txt");

export function getYtCookiesPath(): string {
  return YT_COOKIES_FILE;
}

export interface YtCookieStatus {
  hasYtCookies: boolean;
  hasSID: boolean;
  hasLogin: boolean;
  message: string;
}

export async function getYtCookiesStatus(): Promise<YtCookieStatus> {
  try {
    await access(YT_COOKIES_FILE, constants.F_OK);
    const content = await readFile(YT_COOKIES_FILE, "utf-8");
    const hasSID = content.includes("\tSID\t") || content.includes("__Secure-1PSID");
    const hasLogin = content.includes("LOGIN_INFO") || content.includes("SAPISID");
    const msg = hasSID && hasLogin ? "محفوظة ومكتملة ✅" : hasSID ? "محفوظة (SID موجود)" : "محفوظة";
    return { hasYtCookies: true, hasSID, hasLogin, message: msg };
  } catch {
    return { hasYtCookies: false, hasSID: false, hasLogin: false, message: "لا توجد كوكيز يوتيوب" };
  }
}

export async function hasYtCookies(): Promise<boolean> {
  try {
    await access(YT_COOKIES_FILE, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function saveYtCookies(content: string): Promise<void> {
  if (!content.includes(".youtube.com") && !content.includes("youtube")) {
    throw new Error("يجب أن تحتوي الكوكيز على نطاق .youtube.com");
  }
  await writeFile(YT_COOKIES_FILE, content.trim() + "\n", "utf-8");
}

export async function deleteYtCookies(): Promise<void> {
  try { await unlink(YT_COOKIES_FILE); } catch { /* ignore */ }
}

export interface GeminiCookieValidation {
  valid: boolean;
  message: string;
  hasPSID?: boolean;
  hasPSIDTS?: boolean;
  testResponse?: string;
  error?: string;
}

export async function validateGeminiCookies(): Promise<GeminiCookieValidation> {
  try {
    const { stdout } = await execFileAsync(
      PYTHON,
      [VALIDATE_SCRIPT, COOKIES_FILE],
      { timeout: 40_000, maxBuffer: 1024 * 1024 }
    );
    return JSON.parse(stdout.trim()) as GeminiCookieValidation;
  } catch (err: any) {
    return { valid: false, message: `فشل التحقق: ${err.message?.slice(0, 80)}` };
  }
}
