import { describe, expect, it } from "vitest";
import { composeUrl, inviteMessage, isEmail, parseEmails } from "./invite";

describe("emailing an invite", () => {
  it("reads one or more addresses and refuses a wrong one", () => {
    expect(parseEmails("ana@example.com")).toEqual(["ana@example.com"]);
    expect(parseEmails("ana@example.com, sam@example.com;bo@x.io")).toEqual(["ana@example.com", "sam@example.com", "bo@x.io"]);
    expect(parseEmails("ana@example")).toBeNull();
    expect(parseEmails("  ")).toBeNull();
    expect(isEmail(" bo@x.io ")).toBe(true);
    expect(isEmail("bo@x")).toBe(false);
  });

  it("opens a filled-in message in Gmail, Outlook or the mail app", () => {
    const link = "https://quiet-river.trycloudflare.com/join?code=K7Q-4XM-2PD";
    const { subject, body } = inviteMessage("Kacper", link);
    expect(body).toContain(link);
    expect(body).toContain("nothing to install");
    const gmail = new URL(composeUrl("gmail", ["ana@example.com"], subject, body));
    expect(gmail.host).toBe("mail.google.com");
    expect(gmail.searchParams.get("to")).toBe("ana@example.com");
    expect(gmail.searchParams.get("su")).toBe("Kacper invited you to McBot Studio");
    expect(gmail.searchParams.get("body")).toBe(body);
    const outlook = new URL(composeUrl("outlook", ["a@x.io", "b@x.io"], subject, body));
    expect(outlook.searchParams.get("to")).toBe("a@x.io,b@x.io");
    expect(composeUrl("app", ["a@x.io"], "Hi there", "Body")).toBe("mailto:a%40x.io?subject=Hi%20there&body=Body");
  });

  it("says what a guest is invited to, and how to join without the app in a browser", () => {
    const chat = inviteMessage("Kacper", "https://x.trycloudflare.com/join?code=AAA-BBB-CCC", { role: "chat", agents: ["Support", "Sales"] });
    expect(chat.subject).toBe("Kacper invited you to chat with Support and Sales");
    const lan = inviteMessage("Kacper", "http://192.168.1.20:4318/join?code=AAA-BBB-CCC", { web: false, network: true });
    expect(lan.body).toContain("Join someone else's");
    expect(lan.body).toContain("on the same network");
  });
});
