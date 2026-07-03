export type TenVadWebResult = {
  probability: number;
  isSpeech: boolean;
};

export type TenVadWebInstance = {
  create: (hopSize?: number, threshold?: number) => Promise<void>;
  processPcm16: (base64Pcm16: string) => Promise<TenVadWebResult[]>;
  reset: () => Promise<void>;
  destroy: () => Promise<void>;
};

type TenVadWasmModule = {
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  _malloc: (bytes: number) => number;
  _free: (ptr: number) => void;
  _ten_vad_create: (
    handlePtr: number,
    hopSize: number,
    threshold: number,
  ) => number;
  _ten_vad_process: (
    handle: number,
    audioPtr: number,
    hopSize: number,
    probabilityPtr: number,
    flagPtr: number,
  ) => number;
  _ten_vad_destroy: (handlePtr: number) => void;
};

type TenVadModuleFactory = () => Promise<TenVadWasmModule>;

type RuntimeModuleFactory = (options: {
  locateFile: (path: string) => string;
  noInitialRun: boolean;
  noExitRuntime: boolean;
}) => Promise<TenVadWasmModule>;

const TEN_VAD_JS_URL = "/ten_vad.js";
const TEN_VAD_WASM_URL = "/ten_vad.wasm";

let modulePromise: Promise<TenVadWasmModule> | null = null;
let moduleFactoryForTests: TenVadModuleFactory | null = null;

function decodeBase64Bytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  if (first.byteLength === 0) {
    return second;
  }

  const combined = new Uint8Array(first.byteLength + second.byteLength);
  combined.set(first, 0);
  combined.set(second, first.byteLength);
  return combined;
}

function readInt16Frame(bytes: Uint8Array, byteOffset: number, samples: number) {
  const frame = new Int16Array(samples);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < samples; index++) {
    frame[index] = view.getInt16(byteOffset + index * 2, true);
  }
  return frame;
}

async function loadDefaultWebTenVadModule(): Promise<TenVadWasmModule> {
  if (typeof window === "undefined") {
    throw new Error("TEN VAD WebAssembly is only available in the browser.");
  }

  const runtimeImport = new Function("url", "return import(url)") as (
    url: string,
  ) => Promise<{ default?: RuntimeModuleFactory } | RuntimeModuleFactory>;
  const imported = await runtimeImport(TEN_VAD_JS_URL);
  const createModule =
    typeof imported === "function" ? imported : imported.default;

  if (!createModule) {
    throw new Error("TEN VAD WebAssembly module factory is unavailable.");
  }

  return createModule({
    locateFile: (path: string) =>
      path.endsWith(".wasm") ? TEN_VAD_WASM_URL : path,
    noInitialRun: false,
    noExitRuntime: true,
  });
}

function loadWebTenVadModule(): Promise<TenVadWasmModule> {
  if (!modulePromise) {
    modulePromise = (moduleFactoryForTests ?? loadDefaultWebTenVadModule)();
  }
  return modulePromise;
}

export function createWebTenVad(options: {
  hopSize: 160 | 256;
  threshold: number;
}): TenVadWebInstance {
  let activeOptions = options;
  let module: TenVadWasmModule | null = null;
  let handlePtr = 0;
  let handle = 0;
  let pendingPcm = new Uint8Array();

  async function ensureCreated() {
    if (handle) {
      return;
    }

    module = await loadWebTenVadModule();
    handlePtr = module._malloc(4);
    const result = module._ten_vad_create(
      handlePtr,
      activeOptions.hopSize,
      activeOptions.threshold,
    );
    if (result !== 0) {
      module._free(handlePtr);
      handlePtr = 0;
      throw new Error(`TEN VAD WebAssembly create failed with code ${result}.`);
    }
    handle = module.HEAP32[handlePtr >> 2] ?? 0;
  }

  function destroySync() {
    if (!module || !handlePtr) {
      return;
    }

    module._ten_vad_destroy(handlePtr);
    module._free(handlePtr);
    handlePtr = 0;
    handle = 0;
    pendingPcm = new Uint8Array();
  }

  return {
    async create(hopSize, threshold) {
      if (hopSize || typeof threshold === "number") {
        if (hopSize !== undefined && hopSize !== 160 && hopSize !== 256) {
          throw new Error("TEN VAD hop size must be 160 or 256 samples.");
        }
        const nextHopSize: 160 | 256 =
          hopSize === undefined ? activeOptions.hopSize : hopSize;
        activeOptions = {
          hopSize: nextHopSize,
          threshold: threshold ?? activeOptions.threshold,
        };
      }
      await ensureCreated();
    },
    async processPcm16(base64Pcm16: string) {
      await ensureCreated();
      if (!module || !handle) {
        return [];
      }

      const incoming = decodeBase64Bytes(base64Pcm16);
      const combined = concatBytes(pendingPcm, incoming);
      const frameBytes = activeOptions.hopSize * 2;
      const frameCount = Math.floor(combined.byteLength / frameBytes);
      const results: TenVadWebResult[] = [];

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const audioPtr = module._malloc(frameBytes);
        const probabilityPtr = module._malloc(4);
        const flagPtr = module._malloc(4);
        try {
          const frame = readInt16Frame(
            combined,
            frameIndex * frameBytes,
            activeOptions.hopSize,
          );
          module.HEAP16.set(frame, audioPtr >> 1);
          const result = module._ten_vad_process(
            handle,
            audioPtr,
            activeOptions.hopSize,
            probabilityPtr,
            flagPtr,
          );
          if (result !== 0) {
            throw new Error(
              `TEN VAD WebAssembly process failed with code ${result}.`,
            );
          }
          const probability = module.HEAPF32[probabilityPtr >> 2] ?? 0;
          const flag = module.HEAP32[flagPtr >> 2] ?? 0;
          results.push({ probability, isSpeech: flag >= 1 });
        } finally {
          module._free(audioPtr);
          module._free(probabilityPtr);
          module._free(flagPtr);
        }
      }

      pendingPcm = combined.slice(frameCount * frameBytes);
      return results;
    },
    async reset() {
      destroySync();
      await ensureCreated();
    },
    async destroy() {
      destroySync();
    },
  };
}

export function setWebTenVadModuleFactoryForTests(
  factory: TenVadModuleFactory,
) {
  moduleFactoryForTests = factory;
  modulePromise = null;
}

export function resetWebTenVadModuleForTests() {
  moduleFactoryForTests = null;
  modulePromise = null;
}
