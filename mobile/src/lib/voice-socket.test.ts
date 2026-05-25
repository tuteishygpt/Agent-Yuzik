import { AppState, type AppStateStatus } from "react-native";

import {
  buildVoiceAudioFrame,
  createVoiceSocketClient,
  parseVoiceSocketMessage,
} from "./voice-socket";

let appStateListener: ((state: AppStateStatus) => void) | null = null;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: Array<string | Uint8Array> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }

  emitOpen() {
    this.onopen?.();
  }

  emitError(event: unknown = { message: "socket failed" }) {
    this.onerror?.(event);
  }

  emitText(data: string) {
    this.onmessage?.({ data });
  }
}

function toBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input !== "string") {
    return input;
  }

  return new TextEncoder().encode(input);
}

async function waitForFakeSocket(): Promise<FakeWebSocket> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await Promise.resolve();

    const socket = FakeWebSocket.instances[0];
    if (socket) {
      return socket;
    }
  }

  throw new Error("Expected FakeWebSocket to be created.");
}

describe("voice socket protocol", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    appStateListener = null;
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((event, listener) => {
        if (event === "change") {
          appStateListener = listener;
        }
        return {
          remove: jest.fn(() => {
            if (appStateListener === listener) {
              appStateListener = null;
            }
          }),
        } as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("frames outgoing audio as WAV + END\\0 + uint32 timestamp", () => {
    const frame = buildVoiceAudioFrame({
      wavBytes: new Uint8Array([1, 2, 3, 4]),
      timestamp: 0x78563412,
    });

    expect(Array.from(frame.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(frame.slice(-8))).toEqual([
      69, 78, 68, 0, 18, 52, 86, 120,
    ]);
  });

  it("parses inbound websocket control messages", () => {
    expect(parseVoiceSocketMessage('{"type":"processing"}')).toEqual({
      type: "processing",
    });
    expect(
      parseVoiceSocketMessage('{"type":"transcription","text":"hi"}'),
    ).toEqual({
      type: "transcription",
      text: "hi",
    });
  });

  it("sends auth before any binary audio payload", async () => {
    const client = createVoiceSocketClient({
      url: "wss://api.yuzik.example/api/voice",
      getAccessToken: async () => "token-123",
      WebSocketImpl: FakeWebSocket as never,
    });

    const connectPromise = client.connect();
    const socket = await waitForFakeSocket();
    socket.emitOpen();
    await connectPromise;

    expect(toBytes(socket.sent[0]).length).toBeGreaterThan(0);
    expect(JSON.parse(String(socket.sent[0]))).toEqual({
      type: "auth",
      access_token: "token-123",
    });

    client.sendAudio({
      wavBytes: new Uint8Array([9, 8, 7]),
      timestamp: 123,
    });

    expect(socket.sent[1]).toBeInstanceOf(Uint8Array);
    expect(Array.from(socket.sent[1] as Uint8Array)).toEqual([
      9, 8, 7, 69, 78, 68, 0, 123, 0, 0, 0,
    ]);
  });

  it("does not resolve connect until the websocket is open and auth is sent", async () => {
    const client = createVoiceSocketClient({
      url: "wss://api.yuzik.example/api/voice",
      getAccessToken: async () => "token-123",
      WebSocketImpl: FakeWebSocket as never,
    });

    const connectPromise = client.connect();
    const socket = await waitForFakeSocket();

    await expect(
      Promise.race([
        connectPromise.then(() => "resolved"),
        Promise.resolve("pending"),
      ]),
    ).resolves.toBe("pending");

    socket.emitOpen();

    await expect(connectPromise).resolves.toBeUndefined();
    expect(JSON.parse(String(socket.sent[0]))).toEqual({
      type: "auth",
      access_token: "token-123",
    });
  });

  it("rejects connect when the websocket fails before opening", async () => {
    const client = createVoiceSocketClient({
      url: "wss://api.yuzik.example/api/voice",
      getAccessToken: async () => "token-123",
      WebSocketImpl: FakeWebSocket as never,
    });

    const connectPromise = client.connect();
    const socket = await waitForFakeSocket();
    socket.emitError({});

    await expect(connectPromise).rejects.toThrow(
      "Voice socket connection failed.",
    );
  });

  it("notifies unexpected close when an authenticated socket errors", async () => {
    const onUnexpectedClose = jest.fn();
    const client = createVoiceSocketClient({
      url: "wss://api.yuzik.example/api/voice",
      getAccessToken: async () => "token-123",
      WebSocketImpl: FakeWebSocket as never,
      onUnexpectedClose,
    });

    const connectPromise = client.connect();
    const socket = await waitForFakeSocket();
    socket.emitOpen();
    await connectPromise;

    socket.emitError({ message: "Connection reset" });

    expect(onUnexpectedClose).toHaveBeenCalledWith("Connection reset");
  });

  it("forwards inbound text control messages to listeners", async () => {
    const received: unknown[] = [];
    const client = createVoiceSocketClient({
      url: "wss://api.yuzik.example/api/voice",
      getAccessToken: async () => "token-123",
      WebSocketImpl: FakeWebSocket as never,
    });

    client.onMessage((message) => {
      received.push(message);
    });

    const connectPromise = client.connect();
    const socket = await waitForFakeSocket();
    socket.emitOpen();
    await connectPromise;
    socket.emitText(
      '{"type":"teacher_mode_started","lesson_id":"lesson-1","step_id":"step-1","prompt":"Hello","mode":"teacher"}',
    );

    expect(received).toEqual([
      {
        type: "teacher_mode_started",
        lesson_id: "lesson-1",
        step_id: "step-1",
        prompt: "Hello",
        mode: "teacher",
      },
    ]);
  });

  it("keeps the socket open while Android permission UI makes the app inactive", async () => {
    const client = createVoiceSocketClient({
      url: "wss://api.yuzik.example/api/voice",
      getAccessToken: async () => "token-123",
      WebSocketImpl: FakeWebSocket as never,
    });

    const connectPromise = client.connect();
    const socket = await waitForFakeSocket();
    socket.emitOpen();
    await connectPromise;

    appStateListener?.("inactive");

    client.sendAudio({
      wavBytes: new Uint8Array([1, 2, 3]),
      timestamp: 456,
    });

    expect(socket.sent[1]).toBeInstanceOf(Uint8Array);
  });
});
