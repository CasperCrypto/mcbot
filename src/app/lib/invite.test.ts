import { describe, expect, it } from "vitest";
import { composeUrl, inviteMessage, parseEmails } from "./invite";

describe("emailing an invite", () => {
  it("reads one or more addresses and refuses a wrong one", () => {
    expect(parseEmails("ana@acme.com")).toEqual(["ana@acme.com"]);
    expect(parseEmails("ana@acme.com, sam@acme.com;bo@x.io")).toEqual(["ana@acme.com", "sam@acme.com", "bo@x.io"]);
    expect(parseEmails("ana@acme")).toBeNull();
    expect(parseEmails("  ")).toBeNull();
  });

  it("opens a filled-in message in Gmail, Outlook or the mail app", () => {
    const { subject, body } = inviteMessage("Kacper", "http://192.168.1.20:4318/join?code=K7Q-4XM");
    expect(body).toContain("http://192.168.1.20:4318/join?code=K7Q-4XM");
    const gmail = new URL(composeUrl("gmail", ["ana@acme.com"], subject, body));
    expect(gmail.host).toBe("mail.google.com");
    expect(gmail.searchParams.get("to")).toBe("ana@acme.com");
    expect(gmail.searchParams.get("su")).toBe("Kacper invited you to McBot");
    expect(gmail.searchParams.get("body")).toBe(body);
    const outlook = new URL(composeUrl("outlook", ["a@x.io", "b@x.io"], subject, body));
    expect(outlook.searchParams.get("to")).toBe("a@x.io,b@x.io");
    expect(composeUrl("app", ["a@x.io"], "Hi there", "Body")).toBe("mailto:a%40x.io?subject=Hi%20there&body=Body");
  });
});
