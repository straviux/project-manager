/**
 * Find a build/run command in a project's README.md.
 *
 * A README usually documents the run command in a fenced code block
 * (e.g. `npm run tauri dev`) or as inline code, among other commands
 * that must NOT be picked (install, icon generation, tests). So the
 * scan collects command-like lines, strips shell prompts and list
 * markers, and prefers, in order:
 *   1. a dev/run command: `npm|pnpm|yarn|bun run dev|start`,
 *      `npm run tauri dev`, `cargo run`, `dotnet run`, `go run`,
 *      `npx tauri dev`
 *   2. a build command: `npm|pnpm|yarn|bun run build|tauri build`
 * Anything else (install, ci, icon, test, lint) is ignored, and
 * nothing is returned when no dev/run/build command is found —
 * the caller then tells the user instead of running a guess.
 */
const DEV_RUN =
  /^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:tauri\s+dev|dev|start|serve)\b|^npx\s+tauri\s+dev\b|^(?:cargo|dotnet|go)\s+run\b|^python(?:3)?\s+\S+\.py\b|^node\s+\S+/;
const BUILD =
  /^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:tauri\s+build|build)\b/;

function cleanLine(raw: string): string {
  let line = raw.trim();
  // Fenced-code markers and list markers are not part of the command.
  line = line.replace(/^```.*$/, "").trim();
  line = line.replace(/^(?:[-*]\s+|\d+[.)]\s+|\$\s+|>\s+)/, "").trim();
  // Trailing comment and trailing backtick, e.g. `npm run dev  # watch`.
  line = line.replace(/\s+#.*$/, "").replace(/`+$/, "").trim();
  return line;
}

function candidatesFromLine(raw: string): string[] {
  const line = cleanLine(raw);
  if (!line) return [];
  // Inline code in prose: `run \`npm run dev\` to start`.
  const inlined = [...line.matchAll(/`([^`]+)`/g)]
    .map((m) => cleanLine(m[1]))
    .filter(Boolean);
  if (inlined.length) return inlined;
  return [line];
}

export function findRunCommand(readme: string | null): string | null {
  if (!readme) return null;
  let build: string | null = null;
  for (const raw of readme.split(/\r?\n/)) {
    for (const cmd of candidatesFromLine(raw)) {
      if (DEV_RUN.test(cmd)) return cmd;
      if (!build && BUILD.test(cmd)) build = cmd;
    }
  }
  return build;
}
