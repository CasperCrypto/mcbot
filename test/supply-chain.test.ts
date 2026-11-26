/**
 * The supply chain: what keeps a pull request, a dependency or an action from slipping code into
 * the installers people download (SECURITY.md, "How releases are made"). Each rule below fails a
 * pull request that would weaken it, so a change to it is a decision someone reads, not an accident.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { permissions?: Permissions; steps?: Step[] };
type Permissions = Record<string, string> | string;
type Workflow = { on?: unknown; permissions?: Permissions; jobs: Record<string, Job> };

const workflows = readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((file) => ({ file, wf: parse(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow }));
const jobs = workflows.flatMap(({ file, wf }) => Object.entries(wf.jobs).map(([id, job]) => ({ where: `${file}:${id}`, wf, job, steps: job.steps ?? [] })));

/** Triggers that run a fork's pull request with this repository's secrets or a write token. */
const RISKY_TRIGGERS = ["pull_request_target", "workflow_run", "issue_comment"];
/** Jobs that push with the checkout's credentials. Nothing from the repository or a release runs in them. */
const PUSHES = new Set(["hermes-sync.yml:propose"]);
/** Jobs that install and run the dependencies while holding a write token: they build and upload the installers. */
const BUILDS_WITH_WRITE = new Set(["release.yml:build"]);
/** Actions from outside GitHub's own organisations that a workflow may use. */
const THIRD_PARTY = new Set(["tauri-apps/tauri-action"]);
/**
 * Third-party actions not pinned to a commit yet. A tag can be moved by whoever controls that
 * repository; a commit cannot. Pin it (`uses: owner/action@<40-hex sha> # v1.2.3`) and remove it here.
 */
const NOT_PINNED_YET = new Set(["tauri-apps/tauri-action"]);
/** Packages allowed to run code while `npm ci` installs them. A new one is a decision, not a bump. */
const INSTALL_SCRIPTS = new Set(["node_modules/esbuild", "node_modules/fsevents"]);

const perms = (job: Job, wf: Workflow): Permissions | undefined => job.permissions ?? wf.permissions;
const writes = (p: Permissions | undefined) => p === undefined || p === "write-all" || (typeof p === "object" && Object.values(p).includes("write"));
const triggers = (on: unknown): string[] => (typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : on && typeof on === "object" ? Object.keys(on) : []);
/** Text in backticks is a command named in a message (a PR body), not one that runs. */
const runsDependencies = (steps: Step[]) =>
  steps.some((s) => /\bnpm (ci|install|i|test|run)\b|\bnpx\b/.test((s.run ?? "").replace(/`[^`]*`/g, "")) || /^tauri-apps\/tauri-action@/.test(s.uses ?? ""));

describe("GitHub workflows", () => {
  it("never run a fork's code with secrets or a write token", () => {
    for (const { file, wf } of workflows) {
      for (const t of triggers(wf.on)) expect(RISKY_TRIGGERS, `${file} is triggered by ${t}`).not.toContain(t);
    }
  });

  it("say what their token may do (least privilege, never the repository's default)", () => {
    for (const { file, wf } of workflows) expect(wf.permissions, `${file} has no top-level permissions`).toBeDefined();
  });

  it("keep no git credentials on disk, except the job that pushes", () => {
    for (const { where, steps } of jobs) {
      for (const s of steps.filter((s) => s.uses?.startsWith("actions/checkout@"))) {
        if (PUSHES.has(where)) continue;
        expect(s.with?.["persist-credentials"], `${where}: actions/checkout needs persist-credentials: false`).toBe(false);
      }
    }
  });

  it("install and run the dependencies only with a read-only token (the installers' build aside)", () => {
    for (const { where, wf, job, steps } of jobs) {
      if (!runsDependencies(steps) || BUILDS_WITH_WRITE.has(where)) continue;
      expect(writes(perms(job, wf)), `${where} runs dependencies with a token that can write`).toBe(false);
    }
    for (const where of PUSHES) {
      const j = jobs.find((x) => x.where === where)!;
      expect(runsDependencies(j.steps), `${where} pushes, so it must not run the repository's code`).toBe(false);
    }
  });

  it("build releases without caches another workflow could have written", () => {
    for (const { where, wf, job, steps } of jobs) {
      if (!writes(perms(job, wf))) continue;
      for (const s of steps) {
        const uses = s.uses ?? "";
        expect(/^(actions\/cache|swatinem\/rust-cache)@/.test(uses), `${where} uses ${uses}`).toBe(false);
        if (uses.startsWith("actions/setup-node@")) expect(s.with?.cache, `${where}: setup-node with a cache`).toBeUndefined();
      }
    }
  });

  it("keep event data and inputs out of shell scripts (pass them as env)", () => {
    for (const { where, steps } of jobs) {
      for (const s of steps) {
        for (const expr of (s.run ?? "").match(/\$\{\{[^}]*\}\}/g) ?? []) {
          expect(/^\$\{\{\s*matrix\.[\w-]+\s*\}\}$/.test(expr), `${where}: ${expr} inside run:`).toBe(true);
        }
      }
    }
  });

  it("use only GitHub's own actions and the few listed, pinned to a commit", () => {
    for (const { where, steps } of jobs) {
      for (const uses of steps.map((s) => s.uses).filter((u): u is string => !!u)) {
        if (uses.startsWith("./")) continue;
        const [name, ref = ""] = uses.split("@");
        const owner = name!.split("/")[0]!;
        if (owner === "actions" || owner === "github") continue;
        const action = name!.split("/").slice(0, 2).join("/");
        expect(THIRD_PARTY.has(action), `${where} uses ${uses}: not on the list of allowed actions`).toBe(true);
        if (!NOT_PINNED_YET.has(action)) expect(/^[0-9a-f]{40}$/.test(ref), `${where} uses ${uses}: pin it to a commit`).toBe(true);
      }
    }
  });

  it("build installers only from the default branch", () => {
    const release = workflows.find((w) => w.file === "release.yml")!;
    const check = (release.wf.jobs.check?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(check).toMatch(/git merge-base --is-ancestor "\$GITHUB_SHA" "origin\/\$DEFAULT"/);
    expect(release.wf.jobs.build).toBeDefined();
  });
});

describe("dependencies", () => {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, { resolved?: string; integrity?: string; link?: boolean; hasInstallScript?: boolean }>;
  };
  const pkgs = Object.entries(lock.packages).filter(([path, p]) => path && !p.link);

  it("come from the npm registry, each with its integrity hash", () => {
    for (const [path, p] of pkgs) {
      expect(p.resolved?.startsWith("https://registry.npmjs.org/"), `${path} comes from ${p.resolved}`).toBe(true);
      expect(p.integrity?.startsWith("sha512-"), `${path} has no sha512 integrity`).toBe(true);
    }
  });

  it("run install scripts only where we chose to", () => {
    const scripted = pkgs.filter(([, p]) => p.hasInstallScript).map(([path]) => path);
    for (const path of scripted) expect(INSTALL_SCRIPTS.has(path), `${path} runs an install script`).toBe(true);
  });

  it("in the desktop shell come from crates.io", () => {
    const sources = readFileSync(join(ROOT, "src-tauri", "Cargo.lock"), "utf8").match(/^source = ".*"$/gm) ?? [];
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(s).toBe('source = "registry+https://github.com/rust-lang/crates.io-index"');
  });

  it("are watched by Dependabot, actions included", () => {
    const dependabot = parse(readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf8")) as { updates: { "package-ecosystem": string }[] };
    expect(dependabot.updates.map((u) => u["package-ecosystem"]).sort()).toEqual(["cargo", "github-actions", "npm"]);
  });
});
