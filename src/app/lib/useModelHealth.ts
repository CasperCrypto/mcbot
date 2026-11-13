import { useEffect, useState } from "react";
import type { ModelNode } from "../../contracts/graph";
import { engine, REMOTE } from "./engine";
import { localHealth, type ModelHealth } from "./models";

/** Ask each local model's server whether it is up and has the model (refreshed every 20 s). */
export function useModelHealth(models: ModelNode[]): Record<string, ModelHealth> {
  const [health, setHealth] = useState<Record<string, ModelHealth>>({});
  const key = models.filter((m) => m.data.endpoint === "local").map((m) => `${m.id}|${m.data.baseUrl}|${m.data.model}`).join(",");
  useEffect(() => {
    // A teammate's window can't ask the sharing computer's local servers.
    if (REMOTE || !key) return;
    let alive = true;
    const check = async () => {
      const locals = models.filter((m) => m.data.endpoint === "local");
      const bases = [...new Set(locals.map((m) => m.data.baseUrl))];
      const served = new Map(await Promise.all(bases.map(async (b) => [b, (await engine.setupModels(b).catch(() => ({ models: null }))).models] as const)));
      if (alive) setHealth(Object.fromEntries(locals.map((m) => [m.id, localHealth(m.data.model, served.get(m.data.baseUrl) ?? null)])));
    };
    void check();
    const t = setInterval(() => void check(), 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return health;
}
