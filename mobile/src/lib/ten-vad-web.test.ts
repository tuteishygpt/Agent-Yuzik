import {
  createWebTenVad,
  resetWebTenVadModuleForTests,
  setWebTenVadModuleFactoryForTests,
} from "./ten-vad-web";

type MockTenVadModule = {
  HEAP16: Int16Array;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  _malloc: jest.Mock<number, [number]>;
  _free: jest.Mock<void, [number]>;
  _ten_vad_create: jest.Mock<number, [number, number, number]>;
  _ten_vad_process: jest.Mock<number, [number, number, number, number, number]>;
  _ten_vad_destroy: jest.Mock<void, [number]>;
};

function createMockModule(): MockTenVadModule {
  const buffer = new ArrayBuffer(1024 * 1024);
  const module: MockTenVadModule = {
    HEAP16: new Int16Array(buffer),
    HEAPF32: new Float32Array(buffer),
    HEAP32: new Int32Array(buffer),
    _malloc: jest.fn(),
    _free: jest.fn(),
    _ten_vad_create: jest.fn(),
    _ten_vad_process: jest.fn(),
    _ten_vad_destroy: jest.fn(),
  };
  let nextPtr = 64;

  module._malloc.mockImplementation((bytes) => {
    const ptr = nextPtr;
    nextPtr += bytes + 16;
    return ptr;
  });
  module._ten_vad_create.mockImplementation((handlePtr) => {
    module.HEAP32[handlePtr >> 2] = 1234;
    return 0;
  });
  module._ten_vad_process.mockImplementation(
    (_handle, audioPtr, hopSize, probPtr, flagPtr) => {
      const samples = module.HEAP16.slice(
        audioPtr >> 1,
        (audioPtr >> 1) + hopSize,
      );
      const hasSpeech = samples.some((sample) => Math.abs(sample) >= 1000);
      module.HEAPF32[probPtr >> 2] = hasSpeech ? 0.82 : 0.12;
      module.HEAP32[flagPtr >> 2] = hasSpeech ? 1 : 0;
      return 0;
    },
  );

  return module;
}

describe("createWebTenVad", () => {
  beforeEach(() => {
    resetWebTenVadModuleForTests();
  });

  afterEach(() => {
    resetWebTenVadModuleForTests();
  });

  it("loads the TEN VAD WASM module once and processes complete PCM16 frames", async () => {
    const module = createMockModule();
    const loadModule = jest.fn().mockResolvedValue(module);
    setWebTenVadModuleFactoryForTests(loadModule);
    const vad = createWebTenVad({ hopSize: 256, threshold: 0.6 });
    const firstFrame = new Int16Array(256);
    firstFrame[10] = 1600;
    const partialFrame = new Int16Array(128);
    partialFrame[0] = 1600;

    await vad.create();
    const firstResults = await vad.processPcm16(
      Buffer.from(firstFrame.buffer).toString("base64"),
    );
    const partialResults = await vad.processPcm16(
      Buffer.from(partialFrame.buffer).toString("base64"),
    );
    const secondResults = await vad.processPcm16(
      Buffer.from(partialFrame.buffer).toString("base64"),
    );

    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(module._ten_vad_create).toHaveBeenCalledWith(
      expect.any(Number),
      256,
      0.6,
    );
    expect(firstResults).toHaveLength(1);
    expect(firstResults[0]?.probability).toBeCloseTo(0.82);
    expect(firstResults[0]?.isSpeech).toBe(true);
    expect(partialResults).toEqual([]);
    expect(secondResults).toHaveLength(1);
    expect(secondResults[0]?.probability).toBeCloseTo(0.82);
    expect(secondResults[0]?.isSpeech).toBe(true);
    expect(module._ten_vad_process).toHaveBeenCalledTimes(2);
  });
});
