import test from "node:test";
import assert from "node:assert/strict";

import { armTeacherPromptReveal, queueTeacherPrompt } from "./teacher-prompt.js";

test("queueTeacherPrompt stores prompt without showing it before start", () => {
    const state = {
        pendingTeacherPrompt: "",
        revealTeacherPromptOnStart: false,
    };

    const promptToShow = queueTeacherPrompt(state, "First task");

    assert.equal(promptToShow, null);
    assert.equal(state.pendingTeacherPrompt, "First task");
    assert.equal(state.revealTeacherPromptOnStart, false);
});

test("armTeacherPromptReveal shows already queued prompt on start", () => {
    const state = {
        pendingTeacherPrompt: "First task",
        revealTeacherPromptOnStart: false,
    };

    const promptToShow = armTeacherPromptReveal(state);

    assert.equal(promptToShow, "First task");
    assert.equal(state.pendingTeacherPrompt, "");
    assert.equal(state.revealTeacherPromptOnStart, false);
});

test("queueTeacherPrompt shows prompt immediately after start was armed", () => {
    const state = {
        pendingTeacherPrompt: "",
        revealTeacherPromptOnStart: false,
    };

    assert.equal(armTeacherPromptReveal(state), null);

    const promptToShow = queueTeacherPrompt(state, "First task");

    assert.equal(promptToShow, "First task");
    assert.equal(state.pendingTeacherPrompt, "");
    assert.equal(state.revealTeacherPromptOnStart, false);
});
