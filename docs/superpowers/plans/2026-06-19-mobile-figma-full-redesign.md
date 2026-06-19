# Mobile Figma Full Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Expo mobile presentation layer from the Figma design-system spec while preserving the existing chat, voice, teacher, auth, settings, and navigation behavior.

**Architecture:** Treat this as a presentation-layer rewrite inside `mobile/`. Keep existing route files, providers, hooks, API clients, teacher/voice session lifecycle, and controller contracts intact; introduce shared mobile UI primitives and compose the screens from them. Build in vertical slices so every chunk leaves the app compiling and covered by targeted Jest tests.

**Tech Stack:** Expo Router, React Native, TypeScript, Jest, react-test-renderer, existing `StyleSheet` theme exports in `mobile/src/theme/webTheme.ts`.

---

## Ground Rules

- Code changes stay under `mobile/`.
- This plan document is the only non-`mobile/` file created for planning.
- Do not touch backend, web frontend, Supabase behavior, voice socket behavior, teacher hook behavior, or provider behavior unless a test proves the visual rewrite exposed an existing contract mismatch.
- Avoid broad copy edits in files with mojibake text. Prefer existing `useI18n()` keys or existing labels unless a touched test intentionally updates a visual label.
- Use `StyleSheet` and the existing theme module. Do not add Tailwind, a new UI kit, or a new styling dependency.
- Prefer small components with explicit props over one large redesigned screen.
- Commit after each chunk.

## File Structure Map

Create:

- `mobile/src/components/mobile/MobileScreenShell.tsx` - shared safe-area/screen background, top/bottom padding, optional scroll wrapper.
- `mobile/src/components/mobile/MobileStatusPill.tsx` - compact status pill with dot, tone, optional animated dot style.
- `mobile/src/components/mobile/MobileActionButton.tsx` - text/icon action buttons used by header, composer, menus, artifact actions.
- `mobile/src/components/mobile/YuzikAvatar.tsx` - Figma-style Yuzik avatar states: `default`, `listening`, `thinking`, `speaking`, `error`.
- `mobile/src/components/mobile/MobileMenu.tsx` - bottom-floating route menu rows with active state.
- `mobile/src/components/mobile/index.ts` - exports shared mobile presentation components.
- `mobile/src/components/mobile/MobileScreenShell.test.tsx` - shell contract tests.
- `mobile/src/components/mobile/MobileStatusPill.test.tsx` - status pill contract tests.
- `mobile/src/components/mobile/MobileActionButton.test.tsx` - button contract tests.
- `mobile/src/components/mobile/YuzikAvatar.test.tsx` - avatar state tests.
- `mobile/src/components/mobile/MobileMenu.test.tsx` - route menu callback/active-state tests.
- `mobile/src/features/voice/VoiceVisualizer.tsx` - shared Figma-style waveform bars.
- `mobile/src/features/voice/VoiceStage.tsx` - shared avatar, press target, visualizer, status text, notices/errors for voice and teacher.
- `mobile/src/features/voice/VoiceStage.test.tsx` - voice stage behavior tests.

Modify:

- `mobile/src/theme/webTheme.ts` - replace dark/glass tokens with light neutral, red action accents, compact spacing/typography; keep existing exported names for compatibility.
- `mobile/src/theme/webTheme.test.ts` - update token expectations to the new light Figma-aligned palette.
- `mobile/src/features/chat/ChatScreen.tsx` - compose shell/header/messages/composer, preserve controller wiring and auto-scroll.
- `mobile/src/features/chat/MessageList.tsx` - restyle bubbles, empty state, typing indicator, artifacts; preserve `testID="chat-typing-indicator"` and `testID="chat-audio-play-button"`.
- `mobile/src/features/chat/MessageList.test.tsx` - add visual contract coverage for empty prompt chips and artifact controls as needed.
- `mobile/src/features/chat/Composer.tsx` - restyle input bar and action controls; preserve send-on-enter web behavior and `accessibilityLabel="Open menu"`.
- `mobile/src/features/chat/Composer.test.tsx` - update style assertions from old radius/dark layout to stable Figma input-bar dimensions.
- `mobile/src/features/chat/AttachmentTray.tsx` - restyle selected attachment chip/card.
- `mobile/app/(tabs)/voice.tsx` - replace local mic stage/visualizer presentation with `VoiceStage`; preserve focus cleanup and reconnect logic.
- `mobile/src/features/voice/VoiceControls.tsx` - restyle bottom controls; preserve start/stop/interrupt call order.
- `mobile/src/features/voice/VoiceControls.test.tsx` - update text/style assertions while preserving menu behavior.
- `mobile/src/features/voice/TranscriptPanel.tsx` - restyle transcript bubbles; preserve system-message filtering and auto-scroll.
- `mobile/src/features/voice/TranscriptPanel.test.tsx` - preserve role filtering tests, add bubble role style assertions only if stable.
- `mobile/app/(tabs)/teacher.tsx` - use `VoiceStage`, compact header, redesigned lesson selection; preserve teacher start/stop/manual-stop behavior.
- `mobile/src/features/teacher/LessonPicker.tsx` - compact selectable list/card and active lesson pill.
- `mobile/src/features/teacher/TeacherBanner.tsx` - either restyle for reuse or delete only if no references remain; keep tests aligned.
- `mobile/src/features/teacher/LessonPicker.test.tsx` - update visual labels/style expectations while preserving selection behavior.
- `mobile/src/features/teacher/TeacherScreen.test.tsx` - update presentation text expectations only where changed; preserve lifecycle assertions.
- `mobile/src/navigation/BottomMenuButton.tsx` - restyle shared menu button to match Figma control.
- `mobile/src/navigation/BottomMenuButton.test.tsx` - preserve `accessibilityLabel="Open menu"` and callback test.
- `mobile/app/(tabs)/_layout.tsx` - replace inline menu markup with `MobileMenu`; preserve protected-route gating and hidden tab routes.
- `mobile/src/navigation/TabsLayout.test.tsx` - preserve protected route assertions; add route menu rendering only if needed.
- `mobile/app/(tabs)/settings.tsx` - use shared shell/tokens; keep language and VAD settings behavior unchanged.
- `mobile/src/components/settings/DebugInfo.test.tsx` - update settings visual assertions if headings/structure change.

Optional asset files:

- `mobile/assets/yuzik-avatar-default.png`
- `mobile/assets/yuzik-avatar-listening.png`
- `mobile/assets/yuzik-avatar-thinking.png`
- `mobile/assets/yuzik-avatar-speaking.png`

Only add these if stable exported avatar assets are available before implementation starts. Otherwise ship the styled placeholder avatar first.

---

## Chunk 1: Shared Theme And Mobile Primitives

### Task 1: Update Theme Tokens

**Files:**

- Modify: `mobile/src/theme/webTheme.ts`
- Modify: `mobile/src/theme/webTheme.test.ts`

- [ ] **Step 1: Write/update token tests**

Update `mobile/src/theme/webTheme.test.ts` so it documents the new palette contract:

```ts
expect(webTheme.colors.background).toBe("#f8f5f0");
expect(webTheme.colors.surface).toBe("#ffffff");
expect(webTheme.colors.primary).toBe("#d83324");
expect(webTheme.colors.text).toBe("#1f1d1b");
expect(webTheme.radii.md).toBe(8);
```

Also keep compatibility expectations for existing names consumed by current screens:

```ts
expect(webTheme.colors.listening).toBeTruthy();
expect(webTheme.colors.processing).toBeTruthy();
expect(webTheme.colors.speaking).toBeTruthy();
expect(webTheme.colors.danger).toBeTruthy();
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
cd mobile && npx jest src/theme/webTheme.test.ts --runInBand
```

Expected: FAIL because the current theme is dark/glass and still uses blue primary.

- [ ] **Step 3: Replace theme values while preserving exported shape**

In `mobile/src/theme/webTheme.ts`, keep `webTheme`, `webGlassPanel`, and `webTextStyles` exports. Change values to the Figma-aligned light system:

```ts
colors: {
  primary: "#d83324",
  primaryHover: "#b92b20",
  primaryGlow: "rgba(216, 51, 36, 0.18)",
  background: "#f8f5f0",
  surface: "#ffffff",
  surfaceStrong: "#fffaf4",
  surfaceMuted: "#eee6dd",
  glassBg: "#ffffff",
  border: "#e5ddd3",
  borderStrong: "#d8cfc3",
  text: "#1f1d1b",
  textMuted: "#6f6760",
  textDim: "#9a9188",
  userMsgBg: "#d83324",
  botMsgBg: "#ffffff",
  listening: "#d83324",
  processing: "#b7791f",
  speaking: "#26805b",
  danger: "#d83324",
  teacher: "#2f6f56",
  // preserve existing glow/bg keys with light, low-opacity values
}
```

Set `webGlassPanel` to a plain card surface with `backgroundColor: webTheme.colors.surface`, `borderColor: webTheme.colors.border`, `borderWidth: 1`.

- [ ] **Step 4: Run the theme test**

Run:

```bash
cd mobile && npx jest src/theme/webTheme.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/theme/webTheme.ts mobile/src/theme/webTheme.test.ts
git commit -m "style(mobile): align theme tokens with Figma redesign"
```

### Task 2: Add Shared Mobile Components

**Files:**

- Create: `mobile/src/components/mobile/MobileScreenShell.tsx`
- Create: `mobile/src/components/mobile/MobileStatusPill.tsx`
- Create: `mobile/src/components/mobile/MobileActionButton.tsx`
- Create: `mobile/src/components/mobile/YuzikAvatar.tsx`
- Create: `mobile/src/components/mobile/MobileMenu.tsx`
- Create: `mobile/src/components/mobile/index.ts`
- Create: `mobile/src/components/mobile/MobileScreenShell.test.tsx`
- Create: `mobile/src/components/mobile/MobileStatusPill.test.tsx`
- Create: `mobile/src/components/mobile/MobileActionButton.test.tsx`
- Create: `mobile/src/components/mobile/YuzikAvatar.test.tsx`
- Create: `mobile/src/components/mobile/MobileMenu.test.tsx`

- [ ] **Step 1: Write component contract tests**

Test the following contracts:

```ts
// YuzikAvatar.test.tsx
expect(screen.getByTestId("yuzik-avatar").props.accessibilityLabel).toContain("Yuzik");
expect(screen.getTextContent()).toContain("Y");

// MobileStatusPill.test.tsx
expect(screen.getTextContent()).toContain("Connected");
expect(screen.renderer.root.findByProps({ testID: "mobile-status-dot" })).toBeTruthy();

// MobileActionButton.test.tsx
act(() => button.props.onPress());
expect(onPress).toHaveBeenCalledTimes(1);

// MobileMenu.test.tsx
expect(screen.getTextContent()).toContain("Voice");
expect(screen.getTextContent()).toContain("Chat");
```

- [ ] **Step 2: Run focused failing tests**

Run:

```bash
cd mobile && npx jest src/components/mobile --runInBand
```

Expected: FAIL because the components do not exist yet.

- [ ] **Step 3: Implement `YuzikAvatar`**

Props:

```ts
export type YuzikAvatarState =
  | "default"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

type YuzikAvatarProps = {
  state?: YuzikAvatarState;
  size?: "sm" | "md" | "lg";
  label?: string;
};
```

Implementation requirements:

- Render a `View` with `testID="yuzik-avatar"` and an accessible label.
- Use local `Image` assets only if they already exist; otherwise render a styled initial/mark fallback.
- Map states to token colors, not hardcoded per-screen colors.
- Keep the fallback ASCII-friendly by using `Y` as the mark instead of emoji.

- [ ] **Step 4: Implement shell, pill, button, and menu**

Requirements:

- `MobileScreenShell` supports `children`, optional `scroll`, optional `bottomInset`, optional `style`, and uses `SafeAreaView`.
- `MobileStatusPill` supports `label`, `tone: "neutral" | "accent" | "success" | "warning" | "danger"`, optional `animatedDotStyle`.
- `MobileActionButton` supports `label`, optional `icon`, `variant: "primary" | "secondary" | "ghost"`, `disabled`, `onPress`, `accessibilityLabel`.
- `MobileMenu` accepts route items and calls `onSelect(route)`; active row receives a visually distinct style.

- [ ] **Step 5: Export the components**

`mobile/src/components/mobile/index.ts`:

```ts
export * from "./MobileActionButton";
export * from "./MobileMenu";
export * from "./MobileScreenShell";
export * from "./MobileStatusPill";
export * from "./YuzikAvatar";
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd mobile && npx jest src/components/mobile --runInBand
```

Expected: PASS.

- [ ] **Step 7: Run TypeScript**

Run:

```bash
cd mobile && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/components/mobile
git commit -m "feat(mobile): add shared Figma mobile components"
```

---

## Chunk 2: Chat Redesign

### Task 3: Rewrite Chat Message And Composer Presentation

**Files:**

- Modify: `mobile/src/features/chat/MessageList.tsx`
- Modify: `mobile/src/features/chat/MessageList.test.tsx`
- Modify: `mobile/src/features/chat/Composer.tsx`
- Modify: `mobile/src/features/chat/Composer.test.tsx`
- Modify: `mobile/src/features/chat/AttachmentTray.tsx`

- [ ] **Step 1: Update failing tests for the new contracts**

Preserve existing behavior tests and add/adjust visual contract tests:

```ts
// MessageList.test.tsx
expect(renderer.root.findByProps({ testID: "chat-typing-indicator" })).toBeTruthy();
expect(renderer.root.findAllByProps({ testID: "chat-empty-prompt" }).length).toBeGreaterThan(0);

// Composer.test.tsx
const menuButton = screen.renderer.root.findByProps({ accessibilityLabel: "Open menu" });
expect(menuButton).toBeTruthy();
const inputShell = screen.renderer.root.findByProps({ testID: "chat-composer-input-shell" });
expect(StyleSheet.flatten(inputShell.props.style).minHeight).toBeGreaterThanOrEqual(52);
```

- [ ] **Step 2: Run focused failing tests**

Run:

```bash
cd mobile && npx jest src/features/chat/MessageList.test.tsx src/features/chat/Composer.test.tsx --runInBand
```

Expected: FAIL for newly expected test IDs/style contracts.

- [ ] **Step 3: Restyle `MessageList`**

Requirements:

- Use `YuzikAvatar size="sm"` for assistant rows.
- Keep user rows right-aligned and assistant rows left-aligned.
- Use light bubble colors from `webTheme.colors.userMsgBg` and `webTheme.colors.botMsgBg`.
- Keep image preview rendering and audio artifact actions.
- Add `testID="chat-empty-prompt"` to each empty-state prompt action.
- Keep `testID="chat-typing-indicator"`.
- Do not change `ChatMessage` shape or artifact callbacks.

- [ ] **Step 4: Restyle `Composer` and `AttachmentTray`**

Requirements:

- Use `BottomMenuButton` or `MobileActionButton` without changing `accessibilityLabel="Open menu"`.
- Add `testID="chat-composer-input-shell"` to the input container.
- Preserve `Platform.OS === "web"` Enter-to-send logic.
- Preserve disabled send behavior when `isSending || !draftText.trim()`.
- Keep `AttachmentTray` nullable behavior.
- Present attachment as a compact chip/card above the input row.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd mobile && npx jest src/features/chat/MessageList.test.tsx src/features/chat/Composer.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/chat/MessageList.tsx mobile/src/features/chat/MessageList.test.tsx mobile/src/features/chat/Composer.tsx mobile/src/features/chat/Composer.test.tsx mobile/src/features/chat/AttachmentTray.tsx
git commit -m "feat(mobile): redesign chat messages and composer"
```

### Task 4: Rewrite Chat Screen Shell

**Files:**

- Modify: `mobile/src/features/chat/ChatScreen.tsx`
- Test: `mobile/src/features/chat/useChatController.test.tsx`
- Test: `mobile/src/features/chat/MessageList.test.tsx`
- Test: `mobile/src/features/chat/Composer.test.tsx`

- [ ] **Step 1: Refactor shell usage**

Replace the dark `SafeAreaView`/glow layout with `MobileScreenShell`. Keep all existing controller wiring:

```tsx
const controller = useChatController({
  api: defaultChatApi,
  pickAttachment: pickSingleAttachment,
});
```

Preserve:

- `controller.clearHistory()`
- `controller.pickAttachment`
- `controller.clearAttachment`
- `controller.sendMessage`
- `controller.setDraftText`
- `openMenu`
- `scrollToEnd` behavior on new messages and content-size changes

- [ ] **Step 2: Add compact header**

Use `YuzikAvatar`, title text, optional status/error/loading row, and a compact clear-history action. Keep the clear action callback unchanged.

- [ ] **Step 3: Run chat tests**

Run:

```bash
cd mobile && npx jest src/features/chat --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript**

Run:

```bash
cd mobile && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/chat/ChatScreen.tsx
git commit -m "feat(mobile): rebuild chat screen shell"
```

---

## Chunk 3: Shared Voice Stage

### Task 5: Extract Shared Visualizer And Voice Stage

**Files:**

- Create: `mobile/src/features/voice/VoiceVisualizer.tsx`
- Create: `mobile/src/features/voice/VoiceStage.tsx`
- Create: `mobile/src/features/voice/VoiceStage.test.tsx`
- Modify: `mobile/src/features/voice/TranscriptPanel.tsx`
- Modify: `mobile/src/features/voice/TranscriptPanel.test.tsx`

- [ ] **Step 1: Write `VoiceStage` tests**

Cover press behavior and state mapping without mounting `useVoiceSession`:

```ts
it("starts listening when idle stage is pressed", () => {
  const onStart = jest.fn();
  const screen = render(
    <VoiceStage
      title="Voice"
      uiState={connectedUiState}
      transcript={[]}
      onPrimaryPress={onStart}
    />,
  );
  act(() => screen.renderer.root.findByProps({ testID: "voice-stage-pressable" }).props.onPress());
  expect(onStart).toHaveBeenCalledTimes(1);
});
```

Also assert that `VoiceStage` renders `YuzikAvatar` and `TranscriptPanel`.

- [ ] **Step 2: Run failing test**

Run:

```bash
cd mobile && npx jest src/features/voice/VoiceStage.test.tsx --runInBand
```

Expected: FAIL because `VoiceStage` does not exist.

- [ ] **Step 3: Implement `VoiceVisualizer`**

Move the duplicated `VISUALIZER_BAR_COUNT`, `visualizerHeights`, and animated bar rendering from `mobile/app/(tabs)/voice.tsx` and `mobile/app/(tabs)/teacher.tsx` into this component:

```ts
type VoiceVisualizerProps = {
  pulse: Animated.Value;
  uiState: VoiceUiState;
};
```

Use Figma-style compact bars with red/neutral accents from `uiState.accentColor`.

- [ ] **Step 4: Implement `VoiceStage`**

Props:

```ts
type VoiceStageProps = {
  title: string;
  eyebrow?: string;
  connectionLabel?: string;
  uiState: VoiceUiState;
  visualizerPulse: Animated.Value;
  animatedStyles: {
    dot?: object;
    halo?: object;
    mic?: object;
  };
  transcript: VoiceTranscriptEntry[];
  notice?: string | null;
  error?: string | null;
  onPrimaryPress: () => void;
  childrenBeforeStage?: React.ReactNode;
};
```

Requirements:

- Use `MobileStatusPill` for connection/status.
- Use `YuzikAvatar` instead of mic orb.
- Map `uiState.phase` to avatar state:
  - `recording` or `listening` -> `listening`
  - `processing` -> `thinking`
  - `speaking` -> `speaking`
  - `error` -> `error`
  - all others -> `default`
- Keep `testID="voice-stage-pressable"`.
- Render `TranscriptPanel` at the bottom.

- [ ] **Step 5: Restyle `TranscriptPanel`**

Requirements:

- Preserve system-message filtering.
- Preserve `onContentSizeChange`.
- Use question/answer bubble styles from the shared light theme.
- Do not add visible role labels unless tests and spec require them.

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd mobile && npx jest src/features/voice/VoiceStage.test.tsx src/features/voice/TranscriptPanel.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/features/voice/VoiceVisualizer.tsx mobile/src/features/voice/VoiceStage.tsx mobile/src/features/voice/VoiceStage.test.tsx mobile/src/features/voice/TranscriptPanel.tsx mobile/src/features/voice/TranscriptPanel.test.tsx
git commit -m "feat(mobile): add shared voice stage"
```

---

## Chunk 4: Voice And Teacher Screens

### Task 6: Rebuild Voice Screen With Shared Stage

**Files:**

- Modify: `mobile/app/(tabs)/voice.tsx`
- Modify: `mobile/src/features/voice/VoiceControls.tsx`
- Modify: `mobile/src/features/voice/VoiceControls.test.tsx`
- Test: `mobile/src/features/voice/VoiceScreen.test.tsx`

- [ ] **Step 1: Update `VoiceControls` tests**

Preserve:

```ts
expect(screen.renderer.root.findByProps({ accessibilityLabel: "Open menu" })).toBeTruthy();
```

Update only old text/style assertions that depend on the dark layout. If button text remains existing i18n/mojibake text, do not churn it.

- [ ] **Step 2: Restyle `VoiceControls`**

Requirements:

- Light bottom bar.
- Menu button plus primary start/stop button.
- Same `handlePress` behavior:
  - if `isListening`: call `onStopListening()`, then `void onInterrupt()`
  - else: `void onStartListening()`
- Keep disabled state based on existing `connected` calculation unless a focused test proves it must change.

- [ ] **Step 3: Replace voice presentation with `VoiceStage`**

In `mobile/app/(tabs)/voice.tsx`:

- Remove local `VisualizerBars`, `VISUALIZER_BAR_COUNT`, `visualizerHeights`, mic orb styles, and glow views.
- Keep auth, voice settings, `useVoiceSession`, `useFocusEffect`, reconnect timers, and cleanup exactly scoped.
- Pass `onPrimaryPress` that preserves current stage press behavior:

```ts
if (voiceSession.isListening) {
  voiceSession.stopListening();
  void voiceSession.interrupt();
} else {
  void voiceSession.startListening();
}
```

- [ ] **Step 4: Run voice screen tests**

Run:

```bash
cd mobile && npx jest src/features/voice/VoiceControls.test.tsx src/features/voice/VoiceScreen.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/voice.tsx" mobile/src/features/voice/VoiceControls.tsx mobile/src/features/voice/VoiceControls.test.tsx
git commit -m "feat(mobile): rebuild voice screen presentation"
```

### Task 7: Rebuild Teacher Screen And Lesson Picker

**Files:**

- Modify: `mobile/app/(tabs)/teacher.tsx`
- Modify: `mobile/src/features/teacher/LessonPicker.tsx`
- Modify: `mobile/src/features/teacher/LessonPicker.test.tsx`
- Modify: `mobile/src/features/teacher/TeacherBanner.tsx`
- Modify: `mobile/src/features/teacher/TeacherScreen.test.tsx`

- [ ] **Step 1: Update tests around visual structure only**

Preserve these behavior expectations in `TeacherScreen.test.tsx`:

- selected lesson does not auto-start until requested
- no selection asks for a lesson before starting
- choosing a lesson updates selection but does not start until controls are pressed
- active stop calls `stopListening`, `interrupt`, `stopTeacherLesson`, and `disconnect`
- manual stop prevents auto-reconnect
- reconnect does not auto-start selected lesson

Only update text assertions that are tied to the old hero layout.

- [ ] **Step 2: Run failing focused tests**

Run:

```bash
cd mobile && npx jest src/features/teacher/LessonPicker.test.tsx src/features/teacher/TeacherScreen.test.tsx --runInBand
```

Expected: FAIL only where new visual contracts are not implemented yet.

- [ ] **Step 3: Restyle `LessonPicker`**

Requirements:

- Collapsed state is a compact selected lesson row/card.
- Expanded state lists selectable lesson cards.
- Active state collapses to a small active lesson pill/card.
- Preserve first button with `accessibilityRole="button"` for existing tests that open the picker.
- Preserve `onSelectLesson(lesson.id)` and close picker after selection.
- Keep no-lessons empty state visible.

- [ ] **Step 4: Rebuild teacher screen with `VoiceStage`**

In `mobile/app/(tabs)/teacher.tsx`:

- Remove duplicated local visualizer/mic orb presentation.
- Keep `useTeacherMode`, `useVoiceSession({ teacherMode, sessionKind: "teacher" })`, lesson loading, focus cleanup, manual stop logic, and start/stop callbacks.
- Pass `LessonPicker` through `childrenBeforeStage` so it appears before the avatar stage.
- Preserve `startTeacherSession` and `stopTeacherSession` semantics exactly.
- Keep `VoiceControls` props:

```tsx
<VoiceControls
  status={voiceSession.status}
  isListening={voiceSession.isListening}
  onOpenMenu={openMenu}
  onStartListening={startTeacherSession}
  onStopListening={stopTeacherSession}
  onInterrupt={() => undefined}
/>
```

- [ ] **Step 5: Handle `TeacherBanner`**

If `TeacherBanner` remains used by tests or future composition, restyle it with light tokens. If it becomes unused, remove its test block from `LessonPicker.test.tsx` only after `rg "TeacherBanner" mobile` confirms there are no runtime imports.

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd mobile && npx jest src/features/teacher/LessonPicker.test.tsx src/features/teacher/TeacherScreen.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 7: Run voice and teacher tests together**

Run:

```bash
cd mobile && npx jest src/features/voice src/features/teacher --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "mobile/app/(tabs)/teacher.tsx" mobile/src/features/teacher/LessonPicker.tsx mobile/src/features/teacher/LessonPicker.test.tsx mobile/src/features/teacher/TeacherBanner.tsx mobile/src/features/teacher/TeacherScreen.test.tsx
git commit -m "feat(mobile): rebuild teacher screen presentation"
```

---

## Chunk 5: Navigation Menu And Settings Shell

### Task 8: Redesign Hidden Tab Menu

**Files:**

- Modify: `mobile/src/navigation/BottomMenuButton.tsx`
- Modify: `mobile/src/navigation/BottomMenuButton.test.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Modify: `mobile/src/navigation/TabsLayout.test.tsx`
- Test: `mobile/src/components/mobile/MobileMenu.test.tsx`

- [ ] **Step 1: Preserve menu button contract**

Keep this test passing:

```ts
const button = screen.renderer.root.findByProps({
  accessibilityLabel: "Open menu",
});
act(() => button.props.onPress());
expect(onPress).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Restyle `BottomMenuButton`**

Requirements:

- Use light neutral surface and red/accent pressed or active affordance.
- Keep stable size for bottom bars.
- Keep text/icon output stable enough for existing tests or update tests to assert accessibility instead of mojibake icon text.

- [ ] **Step 3: Use `MobileMenu` in tab layout**

In `mobile/app/(tabs)/_layout.tsx`:

- Keep `MENU_ITEMS` route order: voice, teacher, chat, settings.
- Keep auth loading/error gating.
- Keep hidden Expo tab bar.
- Replace inline `View style={styles.menu}` menu rows with `MobileMenu`.
- Preserve `router.replace(\`/(tabs)/${item.route}\` as any)`.
- Keep modal overlay closing behavior.

- [ ] **Step 4: Run navigation tests**

Run:

```bash
cd mobile && npx jest src/navigation src/components/mobile/MobileMenu.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/navigation/BottomMenuButton.tsx mobile/src/navigation/BottomMenuButton.test.tsx "mobile/app/(tabs)/_layout.tsx" mobile/src/navigation/TabsLayout.test.tsx
git commit -m "feat(mobile): redesign hidden tab menu"
```

### Task 9: Align Settings Screen Shell

**Files:**

- Modify: `mobile/app/(tabs)/settings.tsx`
- Modify: `mobile/src/components/settings/DebugInfo.test.tsx`

- [ ] **Step 1: Update tests only for visual structure**

Keep these settings behavior assertions:

```ts
expect(text).toContain("Settings");
expect(text).toContain("Language");
expect(text).toContain("Voice detection");
expect(text).toContain("Native TEN VAD");
vadSwitch.props.onValueChange(false);
expect(mockSetPreferNativeTenVad).toHaveBeenCalledWith(false);
```

Keep debug info and old teacher-mode settings out of settings.

- [ ] **Step 2: Refactor settings screen to shared shell**

Requirements:

- Use `MobileScreenShell`.
- Keep language buttons and `setLocale(lang.code)`.
- Keep `Switch` with `accessibilityLabel={t("settings.nativeTenVad")}` and `onValueChange={setPreferNativeTenVad}`.
- Keep bottom menu access.
- Use light card/list rows, compact section labels, and tokens from `webTheme`.

- [ ] **Step 3: Run settings tests**

Run:

```bash
cd mobile && npx jest src/components/settings/DebugInfo.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(tabs)/settings.tsx" mobile/src/components/settings/DebugInfo.test.tsx
git commit -m "feat(mobile): align settings with redesigned shell"
```

---

## Chunk 6: Final Verification And Cleanup

### Task 10: Full Mobile Verification

**Files:**

- Verify: `mobile/`
- Optional modify: only files already touched in previous chunks

- [ ] **Step 1: Search for old dark/glass leftovers in presentation files**

Run:

```bash
rg "bgGlow|glassBg|rgba\\(12, 14, 24|rgba\\(22, 24, 40|#141423|primaryGlow|bgGlowPrimary|bgGlowSecondary" mobile/app mobile/src/features mobile/src/navigation mobile/src/components mobile/src/theme
```

Expected: No old dark/glow usage in screens/components. Theme compatibility keys may remain, but screen-level decorative glow views should be gone.

- [ ] **Step 2: Search for accidental non-mobile code changes**

Run:

```bash
git diff --name-only
```

Expected: code changes are under `mobile/`; the only non-`mobile/` path should be this plan file if not already committed separately.

- [ ] **Step 3: Run TypeScript**

Run:

```bash
cd mobile && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run full mobile test suite**

Run:

```bash
cd mobile && npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Manual smoke test in Expo**

Run:

```bash
cd mobile && npm run web
```

Open the Expo web URL and smoke test:

- auth gate reaches protected tabs with existing mocked/dev auth behavior
- chat opens, menu opens, text can be typed, attachment button remains visible
- voice screen renders avatar stage, start/stop controls, transcript panel
- teacher screen renders lesson picker, start control, transcript panel
- settings renders language and VAD controls

If web is not representative for voice APIs, also run:

```bash
cd mobile && npm run android
```

Expected: UI renders without overlapping controls; voice lifecycle does not regress.

- [ ] **Step 6: Commit final cleanup**

Only if Step 1-5 required cleanup changes:

```bash
git add mobile
git commit -m "chore(mobile): finish redesign cleanup"
```

## Execution Notes

- Recommended execution skill: `@superpowers:subagent-driven-development` if explicit delegation is allowed, otherwise `@superpowers:executing-plans`.
- The most fragile behavior is in `mobile/app/(tabs)/voice.tsx` and `mobile/app/(tabs)/teacher.tsx`; keep lifecycle code unchanged while replacing presentation.
- The most likely test churn is around text content affected by mojibake. Prefer asserting accessibility labels, test IDs, callbacks, and stable route names instead of emoji/mojibake glyphs.
- Do not delete `webTheme` compatibility keys during the redesign. Remove unused keys only in a later cleanup after the full mobile suite passes.
