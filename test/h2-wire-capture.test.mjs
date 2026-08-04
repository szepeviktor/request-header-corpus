import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HTTP2_PREFACE, Http2WireCapture } from '../collector/h2-wire-capture.mjs';

function frame(type, flags, streamId, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}

test('HTTP/2 wire capture preserves fragmented input through target END_HEADERS', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'h2-wire-capture-'));
  context.after(() => rm(directory, { recursive: true, force: true }));

  const settings = frame(4, 0, 0);
  const headers = frame(1, 0, 3, Buffer.from([0x82]));
  const continuation = frame(9, 4, 3, Buffer.from([0x84]));
  const laterFrame = frame(8, 0, 0, Buffer.alloc(4));
  const input = Buffer.concat([HTTP2_PREFACE, settings, headers, continuation, laterFrame]);
  const expected = Buffer.concat([HTTP2_PREFACE, settings, headers, continuation]);

  const recorder = new Http2WireCapture();
  for (let offset = 0; offset < input.length; offset += 7) {
    recorder.push(input.subarray(offset, offset + 7));
  }

  const metadata = await recorder.persistStreamPrefix(directory, 'abcdefghijklmnop', 3);
  const captured = await readFile(join(directory, metadata.file));
  assert.deepEqual(captured, expected);
  assert.equal(metadata.byte_length, expected.length);
  assert.equal(metadata.sha256, createHash('sha256').update(expected).digest('hex'));
  assert.deepEqual(
    metadata.target_header_frames.map(({ offset, length, type, stream_id: streamId }) => ({
      offset,
      length,
      type,
      streamId,
    })),
    [
      { offset: 33, length: 10, type: 1, streamId: 3 },
      { offset: 43, length: 10, type: 9, streamId: 3 },
    ],
  );
});
