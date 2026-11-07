import { deflateSync } from 'node:zlib';

// テスト・見本 PDF 用の小さな PNG（RGB・8bit）を作る。paint(x, y) が [r, g, b]（0〜255）を返す。

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function makePng(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 見本の「写真」：色の帯と斜めの線（縦長・横長を確かめられるよう幅と高さを変えられる）。 */
export function samplePhoto(width: number, height: number, hue: number): Buffer {
  return makePng(width, height, (x, y) => {
    const t = y / height;
    const base: [number, number, number] = [
      Math.round(120 + 100 * Math.sin(hue) * (1 - t)),
      Math.round(140 + 80 * Math.cos(hue) * t),
      Math.round(170 + 60 * Math.sin(hue + 1)),
    ];
    const onDiagonal = Math.abs(x / width - y / height) < 0.01;
    const border = x < 3 || y < 3 || x >= width - 3 || y >= height - 3;
    return onDiagonal || border ? [40, 40, 40] : base;
  });
}

/** 見本の「サイン」：白地に黒い波線（サイン画面の PNG と同じく横長）。 */
export function sampleSignature(width = 600, height = 190): Buffer {
  return makePng(width, height, (x, y) => {
    const cy = height / 2 + Math.sin(x / 28) * 35 + Math.sin(x / 9) * 8;
    const inStroke = x > 40 && x < width - 40 && Math.abs(y - cy) < 3;
    return inStroke ? [17, 17, 17] : [255, 255, 255];
  });
}
