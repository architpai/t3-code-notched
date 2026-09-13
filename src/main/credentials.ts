import { safeStorage } from "electron";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { z } from "zod";
import type { Credential } from "./client";
const schema = z.object({
  origin: z.string(),
  environmentId: z.string(),
  token: z.string().min(1).max(8192),
  allowAnswers: z.boolean().optional(),
});
export async function saveCredential(file: string, value: Credential) {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    throw new Error(
      "Secure storage is unavailable. Connect without Remember securely.",
    );
  await writeFile(
    file + ".tmp",
    safeStorage.encryptString(JSON.stringify(value)),
    { mode: 0o600 },
  );
  await rename(file + ".tmp", file);
}
export async function loadCredential(file: string): Promise<Credential | null> {
  try {
    const data = await readFile(file);
    if (data.length > 32_768) return null;
    return schema.parse(JSON.parse(safeStorage.decryptString(data)));
  } catch {
    return null;
  }
}
export async function forgetCredential(file: string) {
  await rm(file, { force: true });
}
