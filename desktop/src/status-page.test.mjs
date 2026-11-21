import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExitCode, statusPageUrl, stripAnsi } from "./status-page.mjs";

const ESC = "\u001b";

function decode(url) {
  const prefix = "data:text/html;charset=utf-8,";
  assert.ok(url.startsWith(prefix));
  return decodeURIComponent(url.slice(prefix.length));
}

test("stripAnsi removes SGR colour sequences", () => {
  assert.equal(stripAnsi(`${ESC}[32mINFO${ESC}[39m: ready`), "INFO: ready");
  assert.equal(stripAnsi(`${ESC}[1;36mbold cyan${ESC}[0m`), "bold cyan");
  assert.equal(stripAnsi(`${ESC}[90m12:00${ESC}[m text`), "12:00 text");
  assert.equal(stripAnsi(`${ESC}[38;5;208morange${ESC}[0m`), "orange");
});

test("stripAnsi removes other ESC[ CSI sequences and OSC sequences", () => {
  assert.equal(stripAnsi(`${ESC}[2K${ESC}[1Gprogress`), "progress");
  assert.equal(stripAnsi(`${ESC}[?25lhidden cursor${ESC}[?25h`), "hidden cursor");
  assert.equal(stripAnsi(`${ESC}]0;title\u0007after`), "after");
  assert.equal(stripAnsi(`${ESC}]8;;https://x${ESC}\\link${ESC}]8;;${ESC}\\`), "link");
});

test("stripAnsi keeps plain text, line breaks and non-ASCII characters", () => {
  const text = "línea 1\r\nlínea 2\ttab — ok\n";
  assert.equal(stripAnsi(text), text);
  assert.equal(stripAnsi(""), "");
});

test("statusPageUrl shows a coloured log as plain, escaped text", () => {
  const html = decode(
    statusPageUrl({
      title: "El servidor de Paperclip se ha detenido",
      log: `${ESC}[32mINFO${ESC}[39m: <started>\n${ESC}[90m[db]${ESC}[39m ready`,
    }),
  );
  assert.ok(html.includes("<pre>INFO: &lt;started&gt;\n[db] ready</pre>"), html);
  assert.ok(!html.includes(ESC));
  assert.ok(!/\[(?:3\d|39|90)m/.test(html));
});

test("formatExitCode shows a signed code, or 'desconocido' when there is none", () => {
  assert.equal(formatExitCode(0), "0");
  assert.equal(formatExitCode(3), "3");
  assert.equal(formatExitCode(4294967295), "-1");
  assert.equal(formatExitCode(3221225786), "-1073741510");
  assert.equal(formatExitCode(-1), "-1");
  assert.equal(formatExitCode(null), "desconocido");
  assert.equal(formatExitCode(undefined), "desconocido");
});
