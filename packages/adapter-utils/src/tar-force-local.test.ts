import { describe, expect, it } from "vitest";
import { tarForceLocalArgs } from "./tar-force-local.js";

describe("tarForceLocalArgs", () => {
  const gnu = "tar (GNU tar) 1.35\nCopyright (C) 2023 Free Software Foundation, Inc.";
  const bsd = "bsdtar 3.7.2 - libarchive 3.7.2 zlib/1.2.13.1-motley";

  it("tells GNU tar on Windows that C:\\... paths are local files, not host:path", () => {
    expect(tarForceLocalArgs(gnu, "win32")).toEqual(["--force-local"]);
  });

  it("adds nothing for bsdtar on Windows (it does not know the flag)", () => {
    expect(tarForceLocalArgs(bsd, "win32")).toEqual([]);
  });

  it("adds nothing on other platforms, even with GNU tar", () => {
    expect(tarForceLocalArgs(gnu, "linux")).toEqual([]);
    expect(tarForceLocalArgs(gnu, "darwin")).toEqual([]);
  });

  it("adds nothing when the version is unknown", () => {
    expect(tarForceLocalArgs(null, "win32")).toEqual([]);
  });
});
