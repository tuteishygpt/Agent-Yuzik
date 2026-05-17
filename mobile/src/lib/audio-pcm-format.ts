import { Buffer } from "buffer";

export const LOCAL_PCM_FRAME_HEADER_SIZE = 8;
export const DEFAULT_LOCAL_PCM_SAMPLE_RATE = 24000;
export const DEFAULT_LOCAL_PCM_EMPTY_GRACE_MS = 120;

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function startsWithBytes(
  bytes: Uint8Array,
  expected: number[],
): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

export function createFloat32WavHeader(
  dataLength: number,
  sampleRate: number,
): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const channels = 1;
  const bytesPerSample = 4;

  header.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, dataLength + 36, true);
  header.set([0x57, 0x41, 0x56, 0x45], 8);
  header.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  header.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataLength, true);

  return header;
}

export function wrapFloat32PcmAsWav(
  pcmBytes: Uint8Array,
  sampleRate: number,
): Uint8Array {
  const wavBytes = new Uint8Array(44 + pcmBytes.byteLength);
  wavBytes.set(createFloat32WavHeader(pcmBytes.byteLength, sampleRate), 0);
  wavBytes.set(pcmBytes, 44);
  return wavBytes;
}

export function wrapLocalPcmFrameAsWav(
  bytes: Uint8Array,
  sampleRate: number,
): Uint8Array {
  const pcmBytes = bytes.slice(LOCAL_PCM_FRAME_HEADER_SIZE);
  return wrapFloat32PcmAsWav(pcmBytes, sampleRate);
}

export function isLocalPcmFrame(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LOCAL_PCM_FRAME_HEADER_SIZE &&
    startsWithBytes(bytes, [0x50, 0x43, 0x4d, 0x00])
  );
}

export function getLocalPcmSampleCount(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true);
}

export function concatBytes(
  chunks: Uint8Array[],
  totalLength: number,
): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function normalizePlaybackBytes(
  bytes: Uint8Array,
  sampleRate?: number,
): Uint8Array {
  if (isLocalPcmFrame(bytes)) {
    return wrapLocalPcmFrameAsWav(
      bytes,
      sampleRate ?? DEFAULT_LOCAL_PCM_SAMPLE_RATE,
    );
  }
  return bytes;
}
