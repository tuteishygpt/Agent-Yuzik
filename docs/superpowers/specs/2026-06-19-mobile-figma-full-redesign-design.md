# Mobile Figma Full Redesign Design

## Goal

Rebuild the Yuzik mobile UI from the Figma design-system page for the full Expo mobile app surface: chat, voice, teacher, shared navigation, and settings shell. The work should replace the current dark/glass presentation with a Figma-aligned light neutral interface, red action accents, compact controls, Yuzik avatar states, and consistent mobile interaction components.

The implementation must preserve existing business behavior: Supabase auth, chat API, voice session lifecycle, teacher lesson start/stop behavior, attachment handling, and settings provider behavior.

## Scope

In scope:

- `mobile/` only.
- Shared design tokens and typography in `mobile/src/theme/webTheme.ts`.
- Shared presentation components for the redesigned app: screen shell, status pills, buttons, input bars, Yuzik avatar, voice stage, menu items, and message/transcript bubbles.
- New presentation for `chat`, `voice`, `teacher`, and the hidden tab menu.
- Settings screen visual alignment enough that the full mobile app does not feel like mixed design systems.
- Jest/type checks for changed mobile behavior and component contracts.

Out of scope:

- Web frontend changes.
- Backend/API changes.
- Rewriting voice or teacher hooks.
- New product behavior not represented by existing screens.
- Deep redesign of settings internals unless needed for visual consistency.

## Figma Inputs

The Figma file is a design-system canvas, not a complete app screen. It contains:

- Chat message, loading, and system-message components.
- Text/voice input states, confirm/discard controls, send/voice/menu icons.
- Primary menu and secondary attachment/action menus.
- CTA/action buttons for practice, learn word, create image, guest mode, login/logout.
- Yuzik avatar states: default, listening, thinking, answering/speaking.
- Voice waveform/transcript and image-generation states.
- Belarusian text style samples.

The app should use these components as the source of visual language, while composing them into production mobile screens that match the existing app flows.

## Architecture

Use a presentation-layer rewrite over the existing logic layer.

- Keep screen route files and hooks in place.
- Keep `useChatController`, `useVoiceSession`, `useTeacherMode`, auth providers, settings providers, and API clients intact.
- Introduce shared UI components under `mobile/src/components` or narrowly under feature folders when they are feature-specific.
- Prefer small, focused components over one large screen file.
- Use React Native `StyleSheet` and existing theme exports. Do not add Tailwind or a new styling library.

Suggested component boundaries:

- `YuzikAvatar`: renders avatar state for default/listening/thinking/speaking/error. Uses downloaded local assets if stable; falls back to styled initials/icon only if asset extraction fails.
- `MobileScreenShell`: shared safe-area background, content padding, optional top status row.
- `MobileStatusPill`: compact rounded status indicators.
- `MobileActionButton`: regular and icon button variants from the Figma design system.
- `MobileMenu`: bottom-floating menu matching Figma menu-primary/menu-secondary patterns.
- `VoiceStage`: avatar, waveform, status label, and press handling shared by voice and teacher.
- `TranscriptPanel`: restyled transcript bubbles using Figma question/answer patterns.

## Screen Designs

### Chat

Rebuild the chat presentation as a light mobile conversation surface:

- Top app identity with Yuzik avatar/name and compact action buttons.
- Empty state uses Figma action chips/cards rather than the current large centered dark prompt grid.
- Messages use Figma chat bubble proportions and small avatars.
- Loading states use Figma labels such as thinking/searching/creating image where the existing controller exposes sending or artifact state.
- Composer uses Figma input states: menu, attachment, voice, text, send. Preserve send-on-enter web behavior for mobile-web tests.

### Voice

Rebuild the voice screen around Yuzik as the primary visual element:

- Replace the generic mic orb as the main identity with `YuzikAvatar`.
- Map voice phases to avatar states: idle/default, listening, thinking/processing, speaking/answering, error.
- Keep waveform/visualizer, but restyle to Figma waveform bars and red/neutral accents.
- Keep press-to-start/stop behavior from the current screen and `VoiceControls`.
- Transcript panel uses the same redesigned transcript bubbles.

### Teacher

Use the same voice stage, specialized for lessons:

- Teacher header communicates current lesson state without a separate hero-heavy layout.
- Lesson picker becomes a compact Figma-style selectable card/list, with active lesson state.
- Current task prompt is shown before start; while active, reduce the picker to an active lesson pill/card.
- Start/stop behavior remains controlled by the existing teacher session callbacks.

### Navigation And Settings

Rebuild the hidden tab menu as a Figma-style bottom-floating menu with active row states. Keep routes and `MenuProvider` behavior unchanged.

Settings should use the new shared shell and token system so it visually belongs with the redesigned app. Avoid expanding settings behavior unless existing layout breaks the new shell.

## Assets

Download Figma avatar assets into `mobile/assets` or another existing mobile asset location, then reference them through React Native image sources. Keep filenames stable and descriptive.

If Figma asset URLs expire or cannot be fetched reliably, implement a styled placeholder avatar component first, then add assets when available.

## Error Handling

No new business errors should be introduced. Existing error text and retry notices should remain visible. Error states should use the Figma red accent and compact status components.

Voice and teacher lifecycle cleanup must remain unchanged when screens lose focus.

## Testing

Run mobile verification after implementation:

- `cd mobile && npx tsc --noEmit`
- `cd mobile && npm test -- --runInBand`

Update tests only where visual structure or labels legitimately change. Preserve behavior assertions for:

- Chat sending, attachment, and message rendering.
- Voice start/stop/control behavior.
- Teacher lesson selection, no-auto-start behavior, active stop/disconnect behavior.
- Navigation menu open/route behavior.

## Risks

- The Figma node is a design system rather than full composed screens, so production composition requires judgment.
- Rewriting all screens is higher risk than restyling because tests may depend on text hierarchy and component nesting.
- Downloaded Figma asset URLs are short-lived, so assets must be stored locally before implementation relies on them.
- Some current labels appear mojibake in source output; avoid broad copy edits unless the file already requires touching that text.

## Acceptance Criteria

- Only `mobile/` and this spec/plan documentation are changed.
- Chat, voice, teacher, menu, and settings shell share one Figma-aligned mobile design system.
- Existing voice and teacher behavior remains intact.
- App compiles with TypeScript.
- Relevant Jest tests pass or any remaining failures are clearly explained with concrete causes.
