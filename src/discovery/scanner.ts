import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { matchesPatterns } from "./exclusions.js";

const AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".m4a"]);
const TEMP_NAMES = /(?:^|\.)(?:tmp|temp|part|partial|download)$/iu;

export interface DiscoveryOptions { include: readonly string[]; exclude: readonly string[]; maxTracks: number | null }

export async function discoverAudioFiles(root: string, options: DiscoveryOptions): Promise<string[]> {
  const found: string[] = [];
  await walk(root);
  return found;

  async function walk(directory: string): Promise<void> {
    if (options.maxTracks !== null && found.length >= options.maxTracks) return;
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (options.maxTracks !== null && found.length >= options.maxTracks) return;
      const fullPath = join(directory, entry.name);
      const relativePath = relative(root, fullPath).split("\\").join("/");
      if (matchesPatterns(relativePath, options.exclude)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || TEMP_NAMES.test(entry.name)) continue;
      if (!AUDIO_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase("en-US"))) continue;
      if (options.include.length > 0 && !matchesPatterns(relativePath, options.include)) continue;
      found.push(fullPath);
    }
  }
}
