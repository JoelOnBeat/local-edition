import { describe, expect, it } from "vitest";
import { assertPublicSiteUrl } from "./site-url";

const code = (raw: string) => {
  try {
    assertPublicSiteUrl(raw);
    return "ok";
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe("T4 chain site URL guard", () => {
  it("accepts a public http(s) site and drops the fragment", () => {
    expect(assertPublicSiteUrl(" https://www.kettleandkiln.com/about#team ").toString()).toBe("https://www.kettleandkiln.com/about");
    expect(code("http://cafe.example.org:8080/")).toBe("invalid_url");
    expect(code("https://cafe.example.org:443/")).toBe("ok");
  });

  it.each([
    "http://localhost/", "http://localhost:3000", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/",
    "http://10.0.0.5/", "http://172.16.4.4/", "http://172.31.255.1/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/", "http://0.0.0.0/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/", "http://intranet/", "http://printer.local/", "http://db.internal/", "http://foo.localhost/", "http://224.0.0.1/",
  ])("refuses the private or internal address %s", (u) => {
    expect(code(u)).toBe("private_url");
  });

  it.each(["", "kettleandkiln.com", "ftp://kettleandkiln.com/", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@kettleandkiln.com/", "not a url"])(
    "refuses a malformed or non-http address %j",
    (u) => {
      expect(code(u)).toBe("invalid_url");
    },
  );

  it("lets a public IP literal through", () => {
    expect(code("http://93.184.216.34/")).toBe("ok");
    expect(code("http://172.32.0.1/")).toBe("ok");
    expect(code("http://[2606:2800:220:1:248:1893:25c8:1946]/")).toBe("ok");
  });
});
