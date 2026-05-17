# Mobile Web Layout Design

## Goal

Rebuild the Expo mobile interface so the whole app visually matches the existing web voice UI while preserving current mobile behavior, API flows, and tests.

## Reference

The source of truth is the web implementation in `frontend/voice.html` and `frontend/src/voice.css`. Mobile should reuse the same visual language: dark background, soft blue/purple ambient accents, glass panels, pale typography, blue primary actions, red listening state, amber processing state, and green speaking/connected state.

## Scope

In scope:

- Shared React Native theme primitives for colors, borders, text, spacing, and status colors.
- Dark tab shell and auth loading/error states.
- Voice screen rebuilt around the web composition: connection/status area, central microphone orb, visualizer, transcript panel, controls, and teacher panel.
- Chat screen rebuilt with the same dark glass layout for header, messages, composer, attachments, and artifact actions.
- Settings screen rebuilt with the same dark glass layout for runtime diagnostics.

Out of scope:

- Backend/API changes.
- Voice transport changes.
- Teacher lesson state changes.
- Chat persistence or artifact behavior changes.

## Architecture

Add a small mobile UI theme module under `mobile/src/theme/` and import it from mobile screens/components. Keep behavior hooks untouched. Components should be restyled and lightly reshaped where needed, but their public props should remain stable unless a layout prop is necessary for web parity.

## Data Flow

Existing hooks remain authoritative:

- `useVoiceSession` continues to own voice connection, recording, interruption, transcript, and teacher commands.
- `useTeacherMode` continues to own lessons, selected lesson, and prompt state.
- `useChatController` continues to own chat history, composer state, attachments, sends, and clear history.
- `useAuth` continues to own authenticated mobile shell readiness.

## Error Handling

Current error strings remain visible, but they should render inside dark glass surfaces with red accent text. Loading and retry notices should use muted or amber themed text.

## Testing

Add theme/layout regression coverage through React renderer tests where practical:

- Theme exports should preserve web reference color values.
- Settings screen should still render runtime diagnostics without leaking secrets after restyling.
- Teacher and voice visual components should still render key labels and states.

Run:

- `npm test -- --runInBand` from `mobile`
- `npx tsc --noEmit` from `mobile`

## Constraints

Do not replace existing business logic. Do not introduce a heavy UI framework. Keep all edits compatible with Expo SDK 54 and React Native 0.81. Use native StyleSheet-based styling.
