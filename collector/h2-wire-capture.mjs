import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const HTTP2_PREFACE = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n', 'ascii');

const FRAME_HEADER_LENGTH = 9;
const FRAME_TYPE_HEADERS = 0x01;
const FRAME_TYPE_CONTINUATION = 0x09;
const FLAG_END_HEADERS = 0x04;

export class Http2WireCapture {
  #chunks = [];
  #connectionId = randomUUID();
  #frames = [];
  #headerEnds = new Map();
  #parseBuffer = Buffer.alloc(0);
  #parsedBytes = 0;
  #prefaceParsed = false;
  #pendingHeaderStream = null;
  #totalBytes = 0;

  get connectionId() {
    return this.#connectionId;
  }

  push(chunk) {
    const bytes = Buffer.from(chunk);
    this.#chunks.push(bytes);
    this.#totalBytes += bytes.length;
    this.#parseBuffer = Buffer.concat([this.#parseBuffer, bytes]);
    this.#parse();
  }

  async persistStreamPrefix(captureDirectory, token, streamId) {
    const endOffset = this.#headerEnds.get(streamId);
    if (!Number.isInteger(endOffset)) {
      throw new Error(`HTTP/2 header block is unavailable for stream ${streamId}`);
    }

    const bytes = Buffer.concat(this.#chunks, this.#totalBytes).subarray(0, endOffset);
    const file = `${token}.h2`;
    await writeFile(resolve(captureDirectory, file), bytes, { mode: 0o644 });

    return {
      format: 'http2-connection-prefix-v1',
      file,
      connection_id: this.#connectionId,
      stream_id: streamId,
      byte_length: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      target_header_frames: this.#frames
        .filter((frame) => frame.offset + frame.length <= endOffset &&
          frame.stream_id === streamId && (
          frame.type === FRAME_TYPE_HEADERS || frame.type === FRAME_TYPE_CONTINUATION
        ))
        .map(({ offset, length, type, flags, stream_id: frameStreamId }) => ({
          offset,
          length,
          type,
          flags,
          stream_id: frameStreamId,
        })),
    };
  }

  #parse() {
    if (!this.#prefaceParsed) {
      if (this.#parseBuffer.length < HTTP2_PREFACE.length) return;
      if (!this.#parseBuffer.subarray(0, HTTP2_PREFACE.length).equals(HTTP2_PREFACE)) {
        throw new Error('Invalid HTTP/2 client connection preface');
      }
      this.#consume(HTTP2_PREFACE.length);
      this.#prefaceParsed = true;
    }

    while (this.#parseBuffer.length >= FRAME_HEADER_LENGTH) {
      const payloadLength = this.#parseBuffer.readUIntBE(0, 3);
      const frameLength = FRAME_HEADER_LENGTH + payloadLength;
      if (this.#parseBuffer.length < frameLength) return;

      const type = this.#parseBuffer[3];
      const flags = this.#parseBuffer[4];
      const streamId = this.#parseBuffer.readUInt32BE(5) & 0x7fffffff;
      const offset = this.#parsedBytes;
      this.#frames.push({
        offset,
        length: frameLength,
        type,
        flags,
        stream_id: streamId,
      });

      if (type === FRAME_TYPE_HEADERS) {
        if (this.#pendingHeaderStream !== null) {
          throw new Error('HEADERS frame interrupted an unfinished header block');
        }
        if ((flags & FLAG_END_HEADERS) !== 0) {
          if (!this.#headerEnds.has(streamId)) {
            this.#headerEnds.set(streamId, offset + frameLength);
          }
        } else {
          this.#pendingHeaderStream = streamId;
        }
      } else if (type === FRAME_TYPE_CONTINUATION) {
        if (this.#pendingHeaderStream !== streamId) {
          throw new Error('Unexpected HTTP/2 CONTINUATION frame');
        }
        if ((flags & FLAG_END_HEADERS) !== 0) {
          if (!this.#headerEnds.has(streamId)) {
            this.#headerEnds.set(streamId, offset + frameLength);
          }
          this.#pendingHeaderStream = null;
        }
      } else if (this.#pendingHeaderStream !== null) {
        throw new Error('HTTP/2 header block was interrupted');
      }

      this.#consume(frameLength);
    }
  }

  #consume(length) {
    this.#parseBuffer = this.#parseBuffer.subarray(length);
    this.#parsedBytes += length;
  }
}
