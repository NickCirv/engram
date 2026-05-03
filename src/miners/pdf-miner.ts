import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile as any) as (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

/**
 * Try to extract text from a PDF.
 * - Prefer `pdf-parse` if available via node_modules (async import).
 * - Fallback to `pdftotext` binary if present (`pdftotext file -`).
 * - Returns extracted text or null on failure.
 */
export async function extractTextFromPdf(filePath: string): Promise<string | null> {
  // 1) Try dynamic import of pdf-parse (npm module)
  try {
    // pdf-parse is a CommonJS module; dynamic import may return a namespace
    // where the default export is the function we want.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = await import("pdf-parse");
    const pdfParse = (m && (m.default ?? m)) as any;
    if (typeof pdfParse === "function") {
      const data = readFileSync(filePath);
      try {
        const r = await pdfParse(data as any);
        if (r && typeof r.text === "string") return r.text;
      } catch {
        // fallthrough to other methods
      }
    }
  } catch {
    // dynamic import failed — try pdftotext
  }

  // 2) Try pdftotext CLI
  try {
    const { stdout } = await execFileP("pdftotext", [filePath, "-"]);
    if (stdout && stdout.length > 0) return stdout;
  } catch {
    // can't run pdftotext or it failed
  }

  return null;
}

/**
 * Wrapper for extracting text from a file. For PDF paths, calls extractTextFromPdf.
 * For other files, reads UTF-8 text. Returns null if extraction failed.
 */
export async function extractTextFromFile(filePath: string): Promise<string | null> {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  try {
    if (ext === "pdf") {
      return await extractTextFromPdf(filePath);
    }
    // Plain text fallback
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
