import type { PlatformField } from "../../contracts/platforms.generated";

/**
 * What a chat app needs, in a few words, for the catalog: "2 keys · api.slack.com",
 * "A key and a setting · open-dev.dingtalk.com". The full list of what Hermes asks for stays in
 * the tooltip; the inspector asks for each one.
 */
export function chatAppNeeds(required: readonly PlatformField[]): string {
  const keys = required.filter((f) => f.secret).length;
  const settings = required.length - keys;
  const count = (n: number, one: string, many: string) => (n === 0 ? "" : n === 1 ? one : `${n} ${many}`);
  const what = [count(keys, "A key", "keys"), count(settings, keys ? "a setting" : "A setting", "settings")].filter(Boolean).join(" and ");
  const url = required.find((f) => f.url)?.url;
  let host = "";
  try {
    host = url ? new URL(url).host.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  return [what || "Nothing to set up", host].filter(Boolean).join(" · ");
}
