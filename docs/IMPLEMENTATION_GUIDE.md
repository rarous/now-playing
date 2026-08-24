# P0AD Protocol Implementation Guide for Devstral Small 2

**Target:** Implement the P0AD LED display protocol in Node.js with **two focused modules**:
1. **Text Rendering Module** (`p0ad-text-renderer.js`) - Character segmentation, RTL, emoji, pixel packing, file format
2. **Device Protocol Module** (`p0ad-device.js`) - BLE communication, handshake, packet construction, multi-packet transmission

**Reference Documentation:**
- [`docs/protocol/p0ad-text-rendering.md`](protocol/p0ad-text-rendering.md)
- [`docs/protocol/p0ad-binary-format.md`](protocol/p0ad-binary-format.md)
- [`docs/protocol/p0ad-handshake.md`](protocol/p0ad-handshake.md)
- [`docs/protocol/nodejs-implementation.md`](protocol/nodejs-implementation.md)

**Constraints:** ESM modules, async/await promises, @stoprocent/noble, Node.js 26+, no callbacks.

**Source Code References:** All use IDE-friendly format `path/to/file.java:line_number`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Text Rendering Module                        │
│              p0ad-text-renderer.js                              │
├─────────────────────────────────────────────────────────────┤
│  renderToCharacters()  ←  DeviceCommand.java:676-792           │
│  packPixels()          ←  TextPixelUtil.java:1256-1348        │
│  packTextSegments()    ←  DeviceCommand.java:676-792           │
│  createFile()          ←  DeviceCommand.java:1056-1068        │
│  isEmoji()                                                      │
│  getArabicTag()                                                │
└─────────────────────────────────────────────────────────────┘
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Device Protocol Module                       │
│                 p0ad-device.js                                  │
├─────────────────────────────────────────────────────────────┤
│  P0ADDevice class                                               │
│  - connect()           ←  BleConnectUtil.java:527,689          │
│  - performHandshake()  ←  AppCommandUtil.java:300-354          │
│  - createPacket()      ←  BleDataUtils.java:45-59              │
│  - sendTextAsync()     ←  DeviceCommand.java:1031-1104         │
│  - sendMultiAsync()    ←  MultiPackUtilV2.java:506-538         │
└─────────────────────────────────────────────────────────────┘
```

**Text Rendering Module** has **zero dependencies** on Device Protocol Module.

---

## Module 1: Text Rendering Module

**File:** `p0ad-text-renderer.js`

Responsible for: character-by-character text rendering with RTL, emoji support, pixel packing, and file format wrapping.

### Implementation

```javascript
// p0ad-text-renderer.js
import { createCanvas } from 'canvas';

// ============================================================================
// Constants
// ============================================================================

export const DISPLAY = {
  WIDTH: 96,
  HEIGHT: 16
};

export const SEGMENT_TYPE = {
  REGULAR_TEXT: 0x01,  // Single-color text character
  EMOJI: 0x02         // RGB color per-pixel
};

export const FILE_TYPE = {
  TXT: 0x01,
  IMG: 0x02,
  DYN: 0x03
};

// ============================================================================
// Character Classification
// ============================================================================

/**
 * Check if character is an emoji
 * Reference: TextPixelUtil.java - emojis handled separately
 * @param {string} char - Character to check
 * @returns {boolean}
 */
export function isEmoji(char) {
  if (char.length !== 1 && char.length !== 2) return false;
  const code = char.codePointAt(0);
  const ranges = [
    [0x1F600, 0x1F64F], [0x1F300, 0x1F5FF], [0x1F680, 0x1F6FF],
    [0x1F1E0, 0x1F1FF], [0x2600, 0x26FF], [0x2700, 0x27BF],
    [0x1F900, 0x1F9FF], [0x1FA00, 0x1FA6F], [0x1FA70, 0x1FAFF],
    [0x200D, 0x200D], [0xFE0F, 0xFE0F]
  ];
  return ranges.some(([start, end]) => code >= start && code <= end);
}

/**
 * Get RTL script group tag for character
 * Reference: DeviceCommand.java:676-792 - arabicTag used for RTL grouping
 * @param {string} char - Character to check
 * @returns {number} - 0 for LTR, >0 for RTL script groups
 */
export function getArabicTag(char) {
  if (char.length === 0) return 0;
  const code = char.codePointAt(0);
  if (code >= 0x0600 && code <= 0x06FF) return 1;     // Arabic
  if (code >= 0x0590 && code <= 0x05FF) return 2;     // Hebrew
  if (code >= 0x0750 && code <= 0x077F) return 3;     // Persian
  if (code >= 0x08A0 && code <= 0x08FF) return 4;
  if (code >= 0xFB50 && code <= 0xFDFF) return 5;
  if (code >= 0xFE70 && code <= 0xFEFF) return 6;
  return 0; // LTR
}

// ============================================================================
// Text Rendering
// ============================================================================

/**
 * Render text to per-character pixel data
 * Implements DeviceCommand.packTextData() character-by-character approach
 * Reference: DeviceCommand.java:676-792
 * @param {string} text - Text to render
 * @param {Object} [options]
 * @param {number} [options.fontSize=16]
 * @param {string} [options.fontFamily='Arial']
 * @returns {Array<CharacterData>} - Array of {char, width, height, pixels, isEmoji, arabicTag}
 */
export function renderToCharacters(text, options = {}) {
  const { fontSize = 16, fontFamily = 'Arial' } = options;
  const characters = [];
  let xPos = 0;
  const maxWidth = DISPLAY.WIDTH;
  const height = DISPLAY.HEIGHT;

  // Create temporary canvas for measurements
  const tempCanvas = createCanvas(maxWidth, height);
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.font = `${fontSize}px ${fontFamily}`;
  tempCtx.textBaseline = 'top';
  tempCtx.textAlign = 'left';

  for (const char of text) {
    const metrics = tempCtx.measureText(char);
    const charWidth = Math.min(Math.ceil(metrics.width), maxWidth - xPos);
    if (charWidth <= 0) continue;

    // Render character to its own canvas
    const charCanvas = createCanvas(charWidth, height);
    const charCtx = charCanvas.getContext('2d');
    charCtx.fillStyle = '#000000';
    charCtx.fillRect(0, 0, charWidth, height);
    charCtx.font = `${fontSize}px ${fontFamily}`;
    charCtx.textBaseline = 'top';
    charCtx.textAlign = 'left';
    charCtx.fillStyle = '#FFFFFF';
    charCtx.fillText(char, 0, 0);

    // Extract monochrome pixel data
    const imageData = charCtx.getImageData(0, 0, charWidth, height);
    const pixels = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < charWidth; x++) {
        const idx = (y * charWidth + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        pixels.push(luminance > 0.5 ? 1 : 0);
      }
    }

    characters.push({
      char,
      width: charWidth,
      height,
      pixels,
      isEmoji: isEmoji(char),
      arabicTag: getArabicTag(char)
    });

    xPos += charWidth;
    if (xPos >= maxWidth) break;
  }

  return characters;
}

/**
 * Pack pixels into bytes (8 pixels per byte, bit 0 = LSB = leftmost)
 * Implements exact algorithm from TextPixelUtil.text2Data()
 * Reference: TextPixelUtil.java:1256-1348
 * @param {number[]} pixels - Monochrome pixel data (1=on, 0=off)
 * @param {number} width - Pixel grid width
 * @param {number} height - Pixel grid height
 * @returns {Buffer}
 */
export function packPixels(pixels, width, height) {
  const result = [];
  for (let y = 0; y < height; y++) {
    const bytesPerRow = Math.ceil(width / 8);
    for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
      let byteValue = 0;
      const startX = byteIdx * 8;
      const endX = Math.min(startX + 8, width);
      for (let x = startX; x < endX; x++) {
        if (pixels[y * width + x] === 1) {
          byteValue |= (1 << (x - startX));
        }
      }
      result.push(byteValue);
    }
  }
  return Buffer.from(result);
}

// ============================================================================
// Text Packing with RTL Support
// ============================================================================

/**
 * Pack characters into P0AD text segments with RTL handling
 * Implements DeviceCommand.packTextData() algorithm
 * Reference: DeviceCommand.java:676-792
 * @param {Array<CharacterData>} characters - Rendered characters from renderToCharacters()
 * @param {Object} [options]
 * @param {number} [options.textMode=0] - 0=LTR, 2=RTL
 * @param {boolean} [options.support600Txt=false] - Extended format flag
 * @returns {Buffer} - Packed text segments
 */
export function packTextSegments(characters, options = {}) {
  const { textMode = 0, support600Txt = false } = options;
  const segments = [];
  const groups = {}; // Group RTL characters by arabicTag
  let currentTag = 0;

  function flushGroup() {
    if (currentTag > 0 && groups[currentTag]) {
      const group = groups[currentTag];
      // RTL reversal happens here - DeviceCommand.java:743-744 uses CollectionsKt.reverse()
      if (textMode === 2) group.reverse();
      for (const c of group) {
        addTextSegment(segments, c, support600Txt);
      }
      delete groups[currentTag];
      currentTag = 0;
    }
  }

  function addTextSegment(segments, charData, support600Txt) {
    const { width, height, pixels } = charData;
    // Segment header: [type, width, height]
    segments.push(Buffer.from([
      SEGMENT_TYPE.REGULAR_TEXT,
      width & 0xFF,
      height & 0xFF
    ]));
    // Color mode
    segments.push(Buffer.from(support600Txt ? [0x01, 0x00] : [0x01]));
    // Pixel data
    segments.push(packPixels(pixels, width, height));
  }

  function addEmojiSegment(segments, charData, support600Txt) {
    const { width, height, pixels } = charData;
    // Segment header: [type, width, height]
    segments.push(Buffer.from([
      SEGMENT_TYPE.EMOJI,
      width & 0xFF,
      height & 0xFF
    ]));
    // Color mode
    segments.push(Buffer.from(support600Txt ? [0x01, 0x00] : [0x01]));
    // RGB pixel data (3 bytes per pixel: R, G, B)
    const rgbData = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (pixels[idx] === 1) {
          rgbData.push(0xFF, 0xFF, 0xFF); // White
        } else {
          rgbData.push(0x00, 0x00, 0x00); // Black
        }
      }
    }
    segments.push(Buffer.from(rgbData));
  }

  for (const charData of characters) {
    const { isEmoji, arabicTag } = charData;

    if (isEmoji) {
      // Emojis flush any pending RTL groups and are added immediately
      flushGroup();
      addEmojiSegment(segments, charData, support600Txt);
      continue;
    }

    if (arabicTag === 0) {
      // LTR character - flush any pending RTL groups
      flushGroup();
      addTextSegment(segments, charData, support600Txt);
    } else {
      // RTL character - add to current group
      if (arabicTag === currentTag) {
        if (!groups[currentTag]) groups[currentTag] = [];
        groups[currentTag].push(charData);
      } else {
        // Different RTL group - flush previous group first
        flushGroup();
        currentTag = arabicTag;
        groups[currentTag] = [charData];
      }
    }
  }

  // Flush any remaining RTL groups
  flushGroup();
  return Buffer.concat(segments);
}

// ============================================================================
// File Format
// ============================================================================

/**
 * Create P0AD file format wrapper
 * Format: [file_type:1byte] [filename_length:1byte] [filename:Nbytes] [text_data]
 * Reference: DeviceCommand.java:1056-1068
 * @param {Buffer} textData - Packed text segments from packTextSegments()
 * @param {string} [fileName] - Auto-generated if not provided
 * @returns {Buffer} - Complete file data
 */
export function createFile(textData, fileName = null) {
  if (!fileName) {
    // Auto-generate filename like Android app does
    fileName = `txt${Date.now().toString().slice(-6)}`;
  }
  const fileNameBuffer = Buffer.from(fileName, 'utf8');
  return Buffer.concat([
    Buffer.from([FILE_TYPE.TXT]),
    Buffer.from([fileNameBuffer.length]),
    fileNameBuffer,
    textData
  ]);
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Full text rendering pipeline: render -> pack -> wrap in file
 * @param {string} text - Text to render
 * @param {Object} [options] - Options passed to render and pack
 * @returns {Buffer} - Complete file data ready for transmission
 */
export function renderText(text, options = {}) {
  const characters = renderToCharacters(text, options);
  const textData = packTextSegments(characters, options);
  return createFile(textData);
}

// ============================================================================
// Named Exports
// ============================================================================

export default {
  DISPLAY,
  SEGMENT_TYPE,
  FILE_TYPE,
  isEmoji,
  getArabicTag,
  renderToCharacters,
  packPixels,
  packTextSegments,
  createFile,
  renderText
};
```

### Key Features

| Feature | Function | Reference |
|---------|----------|-----------|
| Character rendering | `renderToCharacters()` | DeviceCommand.java:676-792 |
| Pixel packing | `packPixels()` | TextPixelUtil.java:1256-1348 |
| RTL grouping | `packTextSegments()` | DeviceCommand.java:676-792 |
| Emoji detection | `isEmoji()` | TextPixelUtil.java |
| RTL tagging | `getArabicTag()` | DeviceCommand.java |
| File format | `createFile()` | DeviceCommand.java:1056-1068 |
| One-shot | `renderText()` | Convenience wrapper |

---

## Module 2: Device Protocol Module

**File:** `p0ad-device.js`

Responsible for: BLE communication, handshake, packet construction, CRC16, multi-packet transmission.

**Dependencies:** Uses `p0ad-text-renderer.js` for text rendering.

### Implementation

```javascript
// p0ad-device.js
import { renderText } from './p0ad-text-renderer.js';

// ============================================================================
// Constants
// ============================================================================

export const P0AD_CONFIG = {
  // BLE UUIDs (128-bit)
  SERVICE_UUID: '0000e0ad00001000800000805f9b34fb',
  WRITE_UUID: '0000a0ad00001000800000805f9b34fb',
  NOTICE_UUID: '0000f0ad00001000800000805f9b34fb',

  // Protocol constants
  APP_DEVICE: 0xA0,           // Header byte
  HEADER_SIZE: 3,            // APP_DEVICE + command + length
  CRC_SIZE: 2,

  // Commands
  SHOW_TEXT: 0x0A,
  SEND_FILE_DATA: 0x07,
  USER_FILE_TYPE_TXT: 0x01,

  // Handshake
  SHAKE_HAND_FIRST: 0x00,
  SHAKE_HAND_SECOND: 0x01,
  SET_REMOTE: 0x48,
  READ_REMOTE: 0x49,
  SET_PARTITION: 0x24,
  READ_COMMUNICATION_VERSION: 0x4C,
  HANDSHAKE_MAGIC: Buffer.from([0x43, 0x43, 0x48, 0x49, 0x50]), // "CCHIP"

  // Transport limits
  MTU: 512,
  SINGLE_PACK_MAX_LENGTH: 247,
  SHAKE_PERIOD_TIME: 1000,
  SHAKE_RETRY_COUNT: 3,
  SINGLE_PACK_TIME_OFFSET: 20
};

// ============================================================================
// CRC16 Calculation
// ============================================================================

/**
 * Calculate CRC16/CCITT checksum
 * Polynomial: 0x1021, Initial: 0xFFFF, No reflection
 * Reference: BleDataUtils.java:45-59
 * @param {Buffer} data
 * @returns {Buffer} 2-byte CRC in big-endian
 */
export function calculateCRC16(data) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;
  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    for (let j = 0; j < 8; j++) {
      const bit = ((byte ^ crc) & 1) === 1;
      crc >>= 1;
      if (bit) crc ^= (polynomial << 8);
      byte >>= 1;
    }
  }
  return Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]);
}

// ============================================================================
// Packet Construction
// ============================================================================

/**
 * Create BLE packet
 * Format: [APP_DEVICE, command, length+3, payload..., CRC16]
 * Reference: BleDataUtils.java:45-59
 * @param {number} command
 * @param {Buffer} payload
 * @returns {Buffer}
 */
export function createPacket(command, payload) {
  const length = payload.length + P0AD_CONFIG.HEADER_SIZE;
  const header = Buffer.from([
    P0AD_CONFIG.APP_DEVICE,
    command,
    length
  ]);
  const packet = Buffer.concat([header, payload]);
  const crc = calculateCRC16(packet);
  return Buffer.concat([packet, crc]);
}

// ============================================================================
// Handshake Protocol
// ============================================================================

/**
 * Create first handshake payload - "CCHIP" magic bytes
 * Reference: AppCommandUtil.java:302-310
 * @returns {Buffer}
 */
export function createFirstHandshakePayload() {
  return P0AD_CONFIG.HANDSHAKE_MAGIC;
}

/**
 * Create second handshake payload with XORed challenge bytes
 * Reference: AppCommandUtil.java:312-321
 * @param {number} b1 - First challenge byte from device
 * @param {number} b2 - Second challenge byte from device
 * @returns {Buffer}
 */
export function createSecondHandshakePayload(b1, b2) {
  return Buffer.from([
    0x43, 0x43,
    P0AD_CONFIG.SET_REMOTE,
    P0AD_CONFIG.READ_REMOTE,
    0x50,
    b1 ^ P0AD_CONFIG.SET_PARTITION,
    b2 ^ P0AD_CONFIG.READ_COMMUNICATION_VERSION
  ]);
}

/**
 * Parse handshake response and extract challenge/result bytes
 * @param {Buffer} data - Response packet
 * @returns {Object} - {type, b1, b2, success}
 */
export function parseHandshakeResponse(data) {
  const command = data[1];
  if (command === P0AD_CONFIG.SHAKE_HAND_FIRST) {
    return { type: 'first', b1: data[8], b2: data[9] };
  }
  if (command === P0AD_CONFIG.SHAKE_HAND_SECOND) {
    return { type: 'second', success: data[8] === 0x00, resultByte: data[8] };
  }
  return null;
}

/**
 * Perform complete handshake sequence
 * Reference: AppCommandUtil.java:300-354
 * @param {Object} context - {writeAsync, waitForNotification}
 * @param {number} [retryCount=0]
 * @returns {Promise<void>}
 */
export async function performHandshake({ writeAsync, waitForNotification }, retryCount = 0) {
  if (retryCount >= P0AD_CONFIG.SHAKE_RETRY_COUNT) {
    throw new Error(`Handshake failed after ${P0AD_CONFIG.SHAKE_RETRY_COUNT} retries`);
  }
  try {
    // First handshake
    const firstPacket = createPacket(
      P0AD_CONFIG.SHAKE_HAND_FIRST,
      createFirstHandshakePayload()
    );
    await writeAsync(firstPacket, false);

    // Wait for challenge bytes
    const firstResponse = await waitForNotification(P0AD_CONFIG.SHAKE_PERIOD_TIME);
    const { b1, b2 } = parseHandshakeResponse(firstResponse);
    if (!b1 || !b2) throw new Error('Invalid first handshake response');

    // Second handshake with XORed challenge
    const secondPacket = createPacket(
      P0AD_CONFIG.SHAKE_HAND_SECOND,
      createSecondHandshakePayload(b1, b2)
    );
    await writeAsync(secondPacket, false);

    // Wait for success
    const secondResponse = await waitForNotification(P0AD_CONFIG.SHAKE_PERIOD_TIME);
    const result = parseHandshakeResponse(secondResponse);
    if (!result?.success) {
      throw new Error(`Handshake failed: 0x${result?.resultByte?.toString(16)}`);
    }
  } catch (error) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return performHandshake({ writeAsync, waitForNotification }, retryCount + 1);
  }
}

// ============================================================================
// Multi-Packet Transmission
// ============================================================================

/**
 * Create multi-packet header with 4-byte file size
 * Reference: MultiPackUtilV2.java:506-538
 * @param {number} fileSize
 * @returns {Buffer}
 */
export function createMultiPacketHeader(fileSize) {
  const sizeBytes = Buffer.alloc(4);
  sizeBytes.writeUInt32BE(fileSize, 0);
  return Buffer.concat([
    Buffer.from([P0AD_CONFIG.SEND_FILE_DATA]),
    sizeBytes
  ]);
}

/**
 * Check if data needs splitting
 * Reference: AppCommandUtil.java:133-135
 * @param {number} dataLength
 * @returns {boolean}
 */
export function needSplitData(dataLength) {
  const splitWriteNum = P0AD_CONFIG.MTU > 247 
    ? P0AD_CONFIG.SINGLE_PACK_MAX_LENGTH 
    : P0AD_CONFIG.MTU - 3;
  return dataLength > splitWriteNum;
}

/**
 * Split data into chunks
 * @param {Buffer} data
 * @param {number} maxChunkSize
 * @returns {Buffer[]}
 */
export function splitIntoChunks(data, maxChunkSize) {
  const chunks = [];
  for (let i = 0; i < data.length; i += maxChunkSize) {
    chunks.push(data.slice(i, i + maxChunkSize));
  }
  return chunks;
}

/**
 * Send multi-packet data with 20ms delay between chunks
 * Reference: MultiPackUtilV2.java:506-538
 * @param {Object} context - {writeAsync, createPacket}
 * @param {Buffer} data
 * @returns {Promise<void>}
 */
export async function sendMultiPacketAsync({ writeAsync, createPacket }, data) {
  const header = createMultiPacketHeader(data.length);
  const dataWithHeader = Buffer.concat([header, data]);
  const maxChunkSize = P0AD_CONFIG.SINGLE_PACK_MAX_LENGTH - P0AD_CONFIG.HEADER_SIZE;
  const chunks = splitIntoChunks(dataWithHeader, maxChunkSize);

  for (let i = 0; i < chunks.length; i++) {
    const packet = createPacket(P0AD_CONFIG.SEND_FILE_DATA, chunks[i]);
    await writeAsync(packet, false);
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, P0AD_CONFIG.SINGLE_PACK_TIME_OFFSET));
    }
  }
}

// ============================================================================
// P0ADDevice Class
// ============================================================================

export const TEXT_MODE = {
  NORMAL: 0,
  SPECIAL: 1,
  RTL: 2
};

/**
 * P0AD Device class for BLE communication
 * Uses @stoprocent/noble with async/await
 */
export class P0ADDevice {
  constructor(noble) {
    this.noble = noble;
    this.peripheral = null;
    this.writeCharacteristic = null;
    this.noticeCharacteristic = null;
    this.isConnected = false;
    this.isReady = false;
    this.isHandshakeComplete = false;
    this.pendingNotification = null;
  }

  /**
   * Connect to device and perform handshake
   * @param {string} deviceIdOrAddress
   * @param {Object} [options]
   * @returns {Promise<void>}
   */
  async connect(deviceIdOrAddress, options = {}) {
    const { timeout = 10000 } = options;
    const timeoutId = setTimeout(() => {
      this.cleanupConnection();
      throw new Error(`Connection timeout after ${timeout}ms`);
    }, timeout);

    try {
      this.peripheral = await this.noble.connectAsync(deviceIdOrAddress);
      this.isConnected = true;

      const { characteristics } = await this.peripheral.discoverAllServicesAndCharacteristicsAsync();
      const writeChar = characteristics.find(c => c.uuid === P0AD_CONFIG.WRITE_UUID);
      const noticeChar = characteristics.find(c => c.uuid === P0AD_CONFIG.NOTICE_UUID);
      if (!writeChar) throw new Error('Write characteristic not found');
      if (!noticeChar) throw new Error('Notice characteristic not found');

      this.writeCharacteristic = writeChar;
      this.noticeCharacteristic = noticeChar;

      await this.noticeCharacteristic.subscribeAsync();
      this.noticeCharacteristic.on('data', (data, isNotification) => {
        if (isNotification) this.handleNotification(data);
      });

      await performHandshake({
        writeAsync: (p, w) => this.writeCharacteristic.writeAsync(p, w),
        waitForNotification: (t) => this.waitForNotification(t)
      });

      this.isHandshakeComplete = true;
      this.isReady = true;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Connect to first discovered P0AD device
   * @param {Object} [options]
   * @returns {Promise<void>}
   */
  async connectFirst(options = {}) {
    const { scanTimeout = 10000, connectTimeout = 10000 } = options;
    await this.noble.waitForPoweredOnAsync();
    await this.noble.startScanningAsync([P0AD_CONFIG.SERVICE_UUID], true);

    const scanTimeoutId = setTimeout(() => {
      this.noble.stopScanningAsync().catch(() => {});
      throw new Error(`No P0AD device found after ${scanTimeout}ms`);
    }, scanTimeout);

    try {
      for await (const peripheral of this.noble.discoverAsync()) {
        if (peripheral.advertisement?.serviceUuids?.includes(P0AD_CONFIG.SERVICE_UUID)) {
          clearTimeout(scanTimeoutId);
          await this.noble.stopScanningAsync();
          await this.connect(peripheral.id, { timeout: connectTimeout });
          return;
        }
      }
      throw new Error('No P0AD device found');
    } finally {
      clearTimeout(scanTimeoutId);
      await this.noble.stopScanningAsync().catch(() => {});
    }
  }

  /**
   * Handle incoming notifications
   * @param {Buffer} data
   */
  handleNotification(data) {
    if (this.pendingNotification) {
      this.pendingNotification.resolve(data);
      this.pendingNotification = null;
      return;
    }
    const command = data[1];
    if (command === P0AD_CONFIG.SHAKE_HAND_FIRST || command === P0AD_CONFIG.SHAKE_HAND_SECOND) {
      const result = parseHandshakeResponse(data);
      if (this.notificationResolve) {
        this.notificationResolve(result);
        this.notificationResolve = null;
        this.notificationReject = null;
      }
    }
  }

  /**
   * Wait for notification with timeout
   * @param {number} timeout
   * @returns {Promise<Buffer>}
   */
  waitForNotification(timeout = P0AD_CONFIG.SHAKE_PERIOD_TIME) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingNotification = null;
        reject(new Error(`Notification timeout after ${timeout}ms`));
      }, timeout);
      this.pendingNotification = { resolve, reject, timeoutId };
    });
  }

  /**
   * Send text to display
   * Reference: DeviceCommand.java:1031-1104, 1085-1104
   * @param {string} text
   * @param {Object} [options]
   * @returns {Promise<void>}
   */
  async sendTextAsync(text, options = {}) {
    if (!this.isReady) throw new Error('Device not ready');
    if (!this.isHandshakeComplete) throw new Error('Handshake not completed');

    // Render text to file data using Text Rendering Module
    const fileData = renderText(text, options);

    // Send file data (single or multi-packet)
    if (needSplitData(fileData.length)) {
      await sendMultiPacketAsync({
        writeAsync: (p, w) => this.writeCharacteristic.writeAsync(p, w),
        createPacket
      }, fileData);
    } else {
      const packet = createPacket(P0AD_CONFIG.SEND_FILE_DATA, fileData);
      await this.writeCharacteristic.writeAsync(packet, false);
    }

    // Send SHOW_TEXT command
    const showTextPacket = createPacket(
      P0AD_CONFIG.SHOW_TEXT,
      Buffer.from([P0AD_CONFIG.USER_FILE_TYPE_TXT])
    );
    await this.writeCharacteristic.writeAsync(showTextPacket, false);
  }

  /**
   * Set display brightness (0-100)
   * @param {number} brightness
   * @returns {Promise<void>}
   */
  async setBrightnessAsync(brightness) {
    const payload = Buffer.from([Math.min(100, Math.max(0, brightness))]);
    const packet = createPacket(0x13, payload);
    await this.writeCharacteristic.writeAsync(packet, false);
  }

  /**
   * Turn display on/off
   * @param {boolean} on
   * @returns {Promise<void>}
   */
  async setDisplayAsync(on) {
    const payload = Buffer.from([on ? 0x01 : 0x00]);
    const packet = createPacket(0x11, payload);
    await this.writeCharacteristic.writeAsync(packet, false);
  }

  /**
   * Disconnect
   * @returns {Promise<void>}
   */
  async disconnectAsync() {
    this.cleanupConnection();
    if (this.peripheral) {
      await this.peripheral.disconnectAsync();
      this.peripheral = null;
      this.writeCharacteristic = null;
      this.noticeCharacteristic = null;
      this.isConnected = false;
      this.isReady = false;
      this.isHandshakeComplete = false;
    }
  }

  cleanupConnection() {
    if (this.pendingNotification?.timeoutId) {
      clearTimeout(this.pendingNotification.timeoutId);
    }
    if (this.notificationReject) {
      this.notificationReject(new Error('Connection cleanup'));
      this.notificationReject = null;
      this.notificationResolve = null;
    }
    this.pendingNotification = null;
  }
}

// ============================================================================
// Named Exports
// ============================================================================

export default {
  P0AD_CONFIG,
  TEXT_MODE,
  calculateCRC16,
  createPacket,
  createFirstHandshakePayload,
  createSecondHandshakePayload,
  parseHandshakeResponse,
  performHandshake,
  createMultiPacketHeader,
  needSplitData,
  splitIntoChunks,
  sendMultiPacketAsync,
  P0ADDevice
};
```

### Key Features

| Feature | Method/Class | Reference |
|---------|--------------|-----------|
| BLE connection | `P0ADDevice.connect()` | BleConnectUtil.java:527,689 |
| Handshake | `performHandshake()` | AppCommandUtil.java:300-354 |
| Packet construction | `createPacket()` | BleDataUtils.java:45-59 |
| CRC16 | `calculateCRC16()` | BleDataUtils.java:45-59 |
| Multi-packet | `sendMultiPacketAsync()` | MultiPackUtilV2.java:506-538 |
| Text sending | `P0ADDevice.sendTextAsync()` | DeviceCommand.java:1031-1104 |
| Brightness | `P0ADDevice.setBrightnessAsync()` | DeviceCommand.java |
| Display on/off | `P0ADDevice.setDisplayAsync()` | DeviceCommand.java |

---

## Usage Example

```javascript
import { P0ADDevice, TEXT_MODE } from './p0ad-device.js';
import noble from '@stoprocent/noble';

const device = new P0ADDevice(noble);

async function main() {
  // Connect and handshake
  await device.connectFirst({ scanTimeout: 10000, connectTimeout: 10000 });

  // Send LTR text
  await device.sendTextAsync('Hello World!', {
    fontSize: 14,
    textMode: TEXT_MODE.NORMAL
  });

  // Send RTL (Arabic) text
  await device.sendTextAsync('مرحبا بالعالم', {
    fontSize: 16,
    textMode: TEXT_MODE.RTL
  });

  // Send text with emoji
  await device.sendTextAsync('Hello 😀 World!', {
    fontSize: 14,
    textMode: TEXT_MODE.NORMAL
  });

  // Set brightness
  await device.setBrightnessAsync(75);

  // Disconnect
  await device.disconnectAsync();
}

main().catch(console.error);
```

---

## Project Setup

### package.json

```json
{
  "name": "p0ad-protocol",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=26.0.0"
  },
  "dependencies": {
    "@stoprocent/noble": "^1.x",
    "canvas": "^2.x"
  }
}
```

### Installation

```bash
npm install @stoprocent/noble canvas
```

**Platform notes:**
- **macOS:** Enable Bluetooth access in System Preferences > Security & Privacy > Bluetooth
- **Linux:** `sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev`
- **Raspberry Pi:** Same as Linux

---

## File Structure

```
project/
├── package.json          # ESM configuration
├── p0ad-text-renderer.js # Module 1: Text Rendering
├── p0ad-device.js        # Module 2: Device Protocol
└── test.js              # Usage example
```

---

## Implementation Checklist

### Module 1: Text Rendering (`p0ad-text-renderer.js`)

- [ ] `DISPLAY`, `SEGMENT_TYPE`, `FILE_TYPE` constants
- [ ] `isEmoji()` - emoji detection
- [ ] `getArabicTag()` - RTL script grouping
- [ ] `renderToCharacters()` - per-character rendering
- [ ] `packPixels()` - 8-pixels-per-byte packing, bit 0 = LSB
- [ ] `packTextSegments()` - segment creation with RTL reversal
- [ ] `createFile()` - file format wrapper
- [ ] `renderText()` - convenience function

### Module 2: Device Protocol (`p0ad-device.js`)

- [ ] `P0AD_CONFIG` constants
- [ ] `calculateCRC16()` - CRC16/CCITT
- [ ] `createPacket()` - packet construction
- [ ] `createFirstHandshakePayload()` - magic bytes
- [ ] `createSecondHandshakePayload()` - XORed challenge
- [ ] `parseHandshakeResponse()` - response parsing
- [ ] `performHandshake()` - complete handshake sequence
- [ ] `createMultiPacketHeader()` - 4-byte file size
- [ ] `needSplitData()` - split decision
- [ ] `splitIntoChunks()` - chunk splitting
- [ ] `sendMultiPacketAsync()` - multi-packet transmission
- [ ] `P0ADDevice` class with all methods

---

## Source Code References

All implementation details are based on the decompiled PixelJoy Android app:

| Concern | File | Lines | Purpose |
|---------|------|-------|---------|
| **Text Rendering** | `TextPixelUtil.java` | 1256-1348 | Bit-packing algorithm |
| **Text Rendering** | `DeviceCommand.java` | 676-792 | packTextData(), RTL handling |
| **Text Rendering** | `DeviceCommand.java` | 1056-1068 | File format (sendFile) |
| **Device Protocol** | `BleDataUtils.java` | 45-59 | Packet construction, CRC16 |
| **Device Protocol** | `AppCommandUtil.java` | 29-47 | Constants (MTU, etc.) |
| **Device Protocol** | `AppCommandUtil.java` | 133-135 | Split decision (needSplitData) |
| **Device Protocol** | `AppCommandUtil.java` | 256 | packMultiple() call |
| **Device Protocol** | `AppCommandUtil.java` | 300-354 | Handshake implementation |
| **Device Protocol** | `BleConnectUtil.java` | 527, 689 | BLE connection, subscription |
| **Device Protocol** | `MultiPackUtilV2.java` | 328-340 | Chunk grouping |
| **Device Protocol** | `MultiPackUtilV2.java` | 506-538 | Multi-packet transmission |
| **Device Protocol** | `DeviceCommand.java` | 1031-1104 | sendTextData(), sendFile() |

**IDE Navigation:** Use `Ctrl+P` (VS Code) or `Ctrl+Shift+N` + `Ctrl+G` (IntelliJ) with `file.java:line_number` format.

---

## Troubleshooting

### Bluetooth Issues
- macOS: Enable Bluetooth in System Preferences > Security & Privacy > Bluetooth
- Linux: Add user to `bluetooth` group, install `bluez`
- Windows: Install WinUSB driver for Bluetooth adapter

### Device Not Found
- Check device is in advertising mode
- Verify BLE adapter is working
- Increase scanTimeout

### Handshake Failure
- Verify `HANDSHAKE_MAGIC` bytes: `[0x43, 0x43, 0x48, 0x49, 0x50]`
- Check challenge byte XOR operations use correct constants
- Verify CRC16 calculation (polynomial 0x1021, initial 0xFFFF)

### Text Not Displaying
- Verify `SHOW_TEXT` command (0x0A) is sent after file data
- Check file format: `[type, name_len, name, data]`
- Verify segment types: 0x01 for text, 0x02 for emoji
- Log packets with `packet.toString('hex')`

---

## Quick Reference

### Packet Structure
```
[0xA0] [command] [length+3] [payload...] [CRC16_high] [CRC16_low]
```

### File Format
```
[file_type:1] [filename_len:1] [filename:N] [text_segments...]
```

### Text Segment
```
[type:1] [width:1] [height:1] [color_mode:1] [pixel_data...]
```

### Commands
| Name | Code | Hex |
|------|------|-----|
| SHOW_TEXT | 10 | 0x0A |
| SEND_FILE_DATA | 7 | 0x07 |
| SET_BRIGHTNESS | 19 | 0x13 |
| SWITCH_LIGHT | 17 | 0x11 |

---

## Summary

**Two modules, one responsibility each:**

1. **Text Rendering Module** (`p0ad-text-renderer.js`):
   - Pure function-based API
   - No BLE dependencies
   - Handles all text concerns: character rendering, RTL, emoji, pixel packing, file format
   - Zero dependencies on Device Protocol Module

2. **Device Protocol Module** (`p0ad-device.js`):
   - Class-based API (`P0ADDevice`)
   - Depends on Text Rendering Module for text rendering
   - Handles all device concerns: BLE, handshake, packets, multi-packet, commands
   - Uses @stoprocent/noble for BLE communication

Both modules use ESM, async/await, and follow the exact algorithms from the decompiled Android source code.
