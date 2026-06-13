import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const mainJs = readFileSync(path.join(srcDir, "main.js"), "utf8");

test("clearChat clears pending file previews before clearing backend history", () => {
    const match = mainJs.match(/function clearChat\(\) \{(?<body>[\s\S]*?)\n\}/);

    assert.ok(match?.groups?.body, "clearChat function body should exist");
    assert.match(match.groups.body, /clearFilePreview\(\)/);
    assert.ok(
        match.groups.body.indexOf("clearFilePreview()") < match.groups.body.indexOf("clearHistory()"),
        "pending files should be cleared before backend history is cleared",
    );
});
