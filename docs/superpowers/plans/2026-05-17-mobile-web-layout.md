# Mobile Web Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Expo mobile interface so every mobile screen visually matches the existing Yuzik web voice UI.

**Architecture:** Introduce a shared mobile theme module that mirrors the web palette, then restyle the tab shell and feature components against that theme. Preserve the existing hooks and API clients so the work stays UI-only.

**Tech Stack:** Expo Router, React Native, TypeScript, Jest, react-test-renderer.

---

## File Structure

- Create: `mobile/src/theme/webTheme.ts`
  Shared colors, spacing, radii, and common glass/status styles derived from `frontend/src/voice.css`.
- Create: `mobile/src/theme/webTheme.test.ts`
  Regression tests for reference colors and status tokens.
- Modify: `mobile/app/(tabs)/_layout.tsx`
  Dark tab bar, dark auth loading/error surfaces.
- Modify: `mobile/app/(tabs)/voice.tsx`
  Recompose the voice screen around the web layout.
- Modify: `mobile/src/features/voice/VoiceControls.tsx`
  Restyle controls as dark glass buttons matching web start/stop patterns.
- Modify: `mobile/src/features/voice/TranscriptPanel.tsx`
  Restyle transcript as web-like dialogue glass panel.
- Modify: `mobile/src/features/teacher/TeacherBanner.tsx`
  Restyle teacher summary as a web teacher panel.
- Modify: `mobile/src/features/teacher/LessonPicker.tsx`
  Restyle lesson catalog as dark glass list items.
- Modify: `mobile/src/features/chat/ChatScreen.tsx`
  Dark background/header and glass status surfaces.
- Modify: `mobile/src/features/chat/MessageList.tsx`
  Web-like message bubbles and artifact action chips.
- Modify: `mobile/src/features/chat/Composer.tsx`
  Dark glass composer and controls.
- Modify: `mobile/src/features/chat/AttachmentTray.tsx`
  Dark attachment tray.
- Modify: `mobile/app/(tabs)/settings.tsx`
  Dark settings screen shell.
- Modify: `mobile/src/components/settings/DebugInfo.tsx`
  Dark glass diagnostics panel.
- Modify tests as needed for changed visible copy.

## Chunk 1: Shared Theme

### Task 1: Add Web Reference Theme

- [ ] **Step 1: Write the failing theme test**

Create `mobile/src/theme/webTheme.test.ts` asserting the mobile theme exports the web reference colors `#0f111a`, `#4e82ee`, `#ff4466`, `#ffaa00`, and `#44ffaa`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- webTheme.test.ts --runInBand`
Expected: fail because `webTheme.ts` does not exist.

- [ ] **Step 3: Implement the theme**

Create `mobile/src/theme/webTheme.ts` with color, radius, spacing, and shadow/glass tokens.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- webTheme.test.ts --runInBand`
Expected: pass.

## Chunk 2: Shell And Voice

### Task 2: Restyle Tabs And Voice Components

- [ ] **Step 1: Update existing render tests or add focused tests for visible voice labels**

Cover that voice/teacher components still render the expected status, lesson, and transcript text after restyling.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- LessonPicker.test.tsx --runInBand`
Expected: current tests pass before styling changes or fail only for expected copy changes.

- [ ] **Step 3: Restyle tab shell, voice screen, teacher components, transcript, and controls**

Use `webTheme.ts`; preserve all props and hook calls.

- [ ] **Step 4: Run focused tests again**

Run: `npm test -- LessonPicker.test.tsx --runInBand`
Expected: pass.

## Chunk 3: Chat And Settings

### Task 3: Restyle Remaining Screens

- [ ] **Step 1: Run current settings test as baseline**

Run: `npm test -- DebugInfo.test.tsx --runInBand`
Expected: pass before styling changes.

- [ ] **Step 2: Restyle chat, composer, attachments, settings, and debug info**

Use shared theme tokens and keep existing data/controller props unchanged.

- [ ] **Step 3: Update tests only for intentional visible copy changes**

Keep secret masking and runtime diagnostics assertions intact.

- [ ] **Step 4: Run focused settings test**

Run: `npm test -- DebugInfo.test.tsx --runInBand`
Expected: pass.

## Chunk 4: Verification

### Task 4: Full Mobile Verification

- [ ] **Step 1: Run mobile unit suite**

Run: `npm test -- --runInBand`
Expected: pass.

- [ ] **Step 2: Run TypeScript**

Run: `npx tsc --noEmit`
Expected: pass.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- mobile docs/superpowers`
Expected: only intended UI/theme/test/doc changes.
