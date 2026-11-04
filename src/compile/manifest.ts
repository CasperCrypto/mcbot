import { COMPILE_SCHEMA, type CompiledFile, type Manifest } from "../contracts/compile";

/**
 * <root>/.mcbot/manifest.json — the list of files McBot owns under the output
 * root. The engine deletes a file on recompile only if the previous manifest
 * lists it, and never touches anything else (Hermes writes state.db, sessions/,
 * logs/, memories/ and seeded skills into the same profile dirs).
 */
export function buildManifest(graphId: string, profiles: readonly string[], files: readonly CompiledFile[]): Manifest {
  return {
    schema: COMPILE_SCHEMA,
    graphId,
    profiles: [...profiles].sort(),
    files: files
      .map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

export function renderManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
