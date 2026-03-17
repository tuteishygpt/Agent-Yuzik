export function armTeacherPromptReveal(state) {
    state.revealTeacherPromptOnStart = true;
    return maybeRevealTeacherPrompt(state);
}

export function queueTeacherPrompt(state, prompt) {
    if (typeof prompt !== "string" || !prompt.trim()) {
        return null;
    }

    state.pendingTeacherPrompt = prompt;
    return maybeRevealTeacherPrompt(state);
}

function maybeRevealTeacherPrompt(state) {
    if (!state.revealTeacherPromptOnStart || !state.pendingTeacherPrompt) {
        return null;
    }

    const prompt = state.pendingTeacherPrompt;
    state.pendingTeacherPrompt = "";
    state.revealTeacherPromptOnStart = false;
    return prompt;
}
