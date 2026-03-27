import {
  buildVoiceAudioFrame,
  createVoiceSocketClient,
  parseVoiceSocketMessage,
} from "./voice-socket";

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

describe("voice socket protocol", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
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
    expect(parseVoiceSocketMessage('{"type":"transcription","text":"hi"}')).toEqual({
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

    await client.connect();

    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

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

    await client.connect();

    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    socket.emitText('{"type":"teacher_mode_started","lesson_id":"lesson-1","step_id":"step-1","prompt":"Hello","mode":"teacher"}');

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
});
