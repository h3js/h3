import { describe, it, expect } from "vitest";
import { mockEvent, getValidatedCookies } from "../../src/index.ts";
import { z } from "zod/v4";

describe("getValidatedCookies", () => {
  it("validates cookies with zod schema", async () => {
    const event = mockEvent("/", {
      headers: { cookie: "session=abc123; theme=dark" },
    });

    const cookies = await getValidatedCookies(
      event,
      z.object({
        session: z.string(),
        theme: z.enum(["light", "dark"]),
      }),
    );

    expect(cookies).toEqual({ session: "abc123", theme: "dark" });
  });

  it("throws on invalid cookies", async () => {
    const event = mockEvent("/", {
      headers: { cookie: "session=abc123" },
    });

    await expect(
      getValidatedCookies(
        event,
        z.object({
          session: z.string(),
          required_field: z.string(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("validates with custom function", async () => {
    const event = mockEvent("/", {
      headers: { cookie: "token=xyz" },
    });

    const cookies = await getValidatedCookies(event, (data) => {
      if (!data.token) throw new Error("Missing token");
      return { token: data.token };
    });

    expect(cookies).toEqual({ token: "xyz" });
  });

  it("returns empty object when no cookies", async () => {
    const event = mockEvent("/");

    const cookies = await getValidatedCookies(event, z.object({}).passthrough());

    expect(cookies).toEqual({});
  });

  it("supports custom onError handler", async () => {
    const event = mockEvent("/", {
      headers: { cookie: "bad=value" },
    });

    await expect(
      getValidatedCookies(event, z.object({ required: z.string() }), {
        onError: ({ issues }) => ({
          status: 422,
          statusText: "Cookie validation failed",
          message: issues.map((i: { message: string }) => i.message).join(", "),
        }),
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
