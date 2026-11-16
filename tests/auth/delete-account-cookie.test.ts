import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

import { DELETE } from "@/app/api/user/me/route";
import { generateToken } from "@/lib/jwt";
import Playlist from "@/models/Playlist";
import User from "@/models/User";

describe("DELETE /api/user/me cookie", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
  });

  it("deletes the authenticated user and their playlists, and clears the token cookie", async () => {
    const user = await User.create({
      name: "Delete Cookie User",
      email: "delete-cookie@example.com",
      password: "stored-password",
    });
    const otherUser = await User.create({
      name: "Other Playlist Owner",
      email: "other-playlist-owner@example.com",
      password: "stored-password",
    });
    const ownedPlaylist = await Playlist.create({
      userId: user._id,
      name: "Soundtrack Picks",
    });
    const otherPlaylist = await Playlist.create({
      userId: otherUser._id,
      name: "Soundtrack Picks",
    });

    cookieGetMock.mockReturnValue({
      name: "token",
      value: generateToken({
        id: user._id.toString(),
        email: user.email,
      }),
    });

    const response = await DELETE(
      new Request("http://localhost/api/user/me", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({
      message: "Account deleted successfully",
    });
    await expect(User.findById(user._id)).resolves.toBeNull();
    await expect(Playlist.exists({ _id: ownedPlaylist._id })).resolves.toBeNull();
    await expect(Playlist.exists({ _id: otherPlaylist._id })).resolves.not.toBeNull();

    const cookie = response.cookies.get("token");
    expect(cookie?.value).toBe("");

    const expires = cookie?.expires;
    expect(expires instanceof Date ? expires.getTime() : expires).toBe(0);

    const setCookie = response.headers.get("set-cookie")?.toLowerCase() ?? "";
    expect(setCookie).toContain("token=;");
    expect(setCookie).toContain("expires=thu, 01 jan 1970 00:00:00 gmt");
    expect(setCookie).toContain("path=/");
  });
});
