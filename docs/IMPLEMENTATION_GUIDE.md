# P0AD Protocol Implementation Guide for Devstral Small 2

**Target:** Implement the complete P0AD LED display protocol in Node.js using ESM, async/await, and @stoprocent/noble.

**Reference Documentation:**
- [`docs/protocol/p0ad-text-rendering.md`](protocol/p0ad-text-rendering.md) - Text rendering pipeline, RTL, emoji support
- [`docs/protocol/p0ad-binary-format.md`](protocol/p0ad-binary-format.md) - Binary packet format, multi-packet transmission
- [`docs/protocol/p0ad-handshake.md`](protocol/p0ad-handshake.md) - Initial BLE handshake protocol
- [`docs/protocol/nodejs-implementation.md`](protocol/nodejs-implementation.md) - Complete reference implementation

**Source Code References:** All references use IDE-friendly format `path/to/file.java:line_number`

---

## Overview

This guide provides step-by-step instructions for implementing the P0AD LED display protocol for Node.js. The implementation must:

1. Use ESM modules (no CommonJS)
2. Use async/await promises (no callbacks)
3. Use @stoprocent/noble for BLE communication
4. Support Node.js 26+
5. Handle longer text with per-character segmentation
6. Support RTL (Arabic, Hebrew, etc.) text
7. Support emoji rendering
8. Handle multi-packet transmission for data > 247 bytes

---

## Step 1: Project Setup

### 1.1 Create Project Structure

```bash
mkdir p0ad-nodejs
cd p0ad-nodejs
npm init -y
```

### 1.2 Install Dependencies

```bash
# Required for BLE communication
npm install @stoprocent/noble

# Required for text rendering (canvas)
npm install canvas
```

**Platform-specific setup:**
- **macOS:** Install Xcode, enable Bluetooth access in System Preferences > Security & Privacy > Bluetooth
- **Linux:** `sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev`
- **Raspberry Pi:** Same as Linux dependencies
- **Windows:** Install Windows Build Tools and WinUSB driver

### 1.3 Configure package.json for ESM

```json
{
  "name": "p0ad-protocol",
  "version": "1.0.0",
  "type": "module",
  "main": "p0ad-protocol.js",
  "engines": {
    "node": ">=26.0.0"
  },
  "dependencies": {
    "@stoprocent/noble": "^1.x",
    "canvas": "^2.x"
  }
}
```

**Critical:** The `"type": "module"` field enables ESM support.

---

## Step 2: Implement Core Constants

**File:** `p0ad-constants.js`

**Reference:** `AppCommandUtil.java:29-47`, `DeviceCommand.java:88-110`

```javascript
// P0AD Device Constants
export const P0AD_CONFIG = {
  // BLE UUIDs (128-bit full format)
  SERVICE_UUID: '0000e0ad00001000800000805f9b34fb',
  WRITE_UUID: '0000a0ad00001000800000805f9b34fb',
  NOTICE_UUID: '0000f0ad00001000800000805f9b34fb',
  SCANNING_UUID: '0000c0ad00001000800000805f9b34fb',
  
  // Device properties
  WIDTH: 96,
  HEIGHT: 16,
  
  // Protocol constants
  APP_DEVICE: 0xA0,        // Header byte (0xA0 = -96 decimal)
  
  // Command codes
  SHOW_TEXT: 0x0A,         // Display text file
  SEND_FILE_DATA: 0x07,   // Send file data (used for text)
  USER_FILE_TYPE_TXT: 0x01, // Text file type
  USER_FILE_TYPE_IMG: 0x02, // Image file type
  USER_FILE_TYPE_DYN: 0x03, // Dynamic content type
  
  // Handshake constants (DeviceCommand.java)
  SHAKE_HAND_FIRST: 0x00,
  SHAKE_HAND_SECOND: 0x01,
  SET_REMOTE: 0x48,       // 72 decimal
  READ_REMOTE: 0x49,      // 73 decimal
  SET_PARTITION: 0x24,    // 36 decimal
  READ_COMMUNICATION_VERSION: 0x4C, // 76 decimal
  
  // Handshake magic bytes: "CCHIP"
  HANDSHAKE_MAGIC: Buffer.from([0x43, 0x43, 0x48, 0x49, 0x50]),
  
  // Transport limits (AppCommandUtil.java:133-135)
  MTU: 512,
  SINGLE_PACK_MAX_LENGTH: 247,  // Max payload per packet
  HEADER_SIZE: 3,         // APP_DEVICE + command + length
  CRC_SIZE: 2,
  
  // Handshake timing
  SHAKE_PERIOD_TIME: 1000,   // 1 second timeout
  SHAKE_RETRY_COUNT: 3,      // 3 retries
  
  // Multi-packet timing (MultiPackUtilV2.java)
  SINGLE_PACK_TIME_OFFSET: 20  // 20ms delay between chunks
};

// Text mode constants
export const TEXT_MODE = {
  NORMAL: 0,    // Left-to-right
  SPECIAL: 1,   // Special handling
  RTL: 2        // Right-to-left (Arabic, Hebrew, etc.)
};

// Segment type constants
export const SEGMENT_TYPE = {
  REGULAR_TEXT: 0x01,  // Single-color text character
  EMOJI: 0x02        // RGB color per-pixel emoji
};
```

---

## Step 3: Implement CRC16 Calculation

**File:** `p0ad-crc.js`

**Reference:** `BleDataUtils.java:45-59`

The CRC16/CCITT algorithm uses polynomial 0x1021, initial value 0xFFFF, no bit reflection.

```javascript
import { P0AD_CONFIG } from './p0ad-constants.js';

/**
 * Calculate CRC16/CCITT checksum
 * Polynomial: 0x1021
 * Initial value: 0xFFFF
 * No bit reflection
 * Result is returned as 2-byte big-endian buffer
 * 
 * Matches Android implementation in BleDataUtils.java:45-59
 * 
 * @param {Buffer} data - Data to calculate CRC over
 * @returns {Buffer} 2-byte CRC in big-endian format
 */
export function calculateCRC16(data) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;
  
  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    
    for (let j = 0; j < 8; j++) {
      const bit = ((byte ^ crc) & 1) === 1;
      crc >>= 1;
      if (bit) {
        crc ^= (polynomial << 8);
      }
      byte >>= 1;
    }
  }
  
  return Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]);
}

/**
 * Verify CRC16 checksum of a received packet
 * @param {Buffer} packet - Complete packet including CRC
 * @returns {boolean} True if CRC is valid
 */
export function verifyCRC16(packet) {
  // CRC is the last 2 bytes
  const crcBytes = packet.slice(-2);
  const dataWithoutCRC = packet.slice(0, -2);
  const calculatedCRC = calculateCRC16(dataWithoutCRC);
  return crcBytes.equals(calculatedCRC);
}
```

---

## Step 4: Implement Packet Construction

**File:** `p0ad-packet.js`

**Reference:** `BleDataUtils.java:45-59`

```javascript
import { P0AD_CONFIG } from './p0ad-constants.js';
import { calculateCRC16 } from './p0ad-crc.js';

/**
 * Create a BLE packet for the P0AD device
 * 
 * Packet Format (BleDataUtils.java:45-59):
 * Offset  | Size    | Description
 *--------|---------|-------------
 * 0      | 1       | APP_DEVICE (0xA0)
 * 1      | 1       | Command Type
 * 2      | 1       | Data Length (payload.length + 3)
 * 3..N+2 | N       | Payload Data
 * N+3    | 2       | CRC16 Checksum (big-endian)
 * 
 * Total: 6 + N bytes
 * 
 * @param {number} command - Command code
 * @param {Buffer} payload - Payload data
 * @returns {Buffer} Complete BLE packet
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

/**
 * Parse a received packet
 * @param {Buffer} packet - Complete received packet
 * @returns {Object} - { command, payload } or null if invalid
 */
export function parsePacket(packet) {
  if (packet.length < 6) return null;
  
  // Verify header
  if (packet[0] !== P0AD_CONFIG.APP_DEVICE) return null;
  
  // Verify CRC
  if (!verifyCRC16(packet)) {
    console.warn('CRC verification failed');
    return null;
  }
  
  const command = packet[1];
  const length = packet[2];
  const expectedTotalLength = length + P0AD_CONFIG.CRC_SIZE;
  
  if (packet.length !== expectedTotalLength) {
    console.warn(`Length mismatch: expected ${expectedTotalLength}, got ${packet.length}`);
    return null;
  }
  
  // Extract payload (excluding header and CRC)
  const payload = packet.slice(3, -2);
  
  return { command, payload };
}
```

---

## Step 5: Implement Multi-Packet Support

**File:** `p0ad-multipacket.js`

**Reference:** `AppCommandUtil.java:133-135,256`, `MultiPackUtilV2.java:328-340,506-538`

```javascript
import { P0AD_CONFIG } from './p0ad-constants.js';

/**
 * Create multi-packet file header
 * Used when file data exceeds SINGLE_PACK_MAX_LENGTH (247 bytes)
 * 
 * Format: [0x07, file_size_4bytes (big-endian)]
 * 
 * Reference: MultiPackUtilV2.java:506-538
 * 
 * @param {number} fileSize - Total file size in bytes
 * @returns {Buffer} Multi-packet header (5 bytes)
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
 * Check if data needs to be split into multiple packets
 * Matches logic from AppCommandUtil.needSplitData() lines 133-135
 * 
 * @param {number} dataLength - Length of data in bytes
 * @param {number} [mtu=512] - Current MTU
 * @returns {boolean} True if data needs splitting
 */
export function needSplitData(dataLength, mtu = P0AD_CONFIG.MTU) {
  const splitWriteNum = mtu > 247 ? P0AD_CONFIG.SINGLE_PACK_MAX_LENGTH : mtu - 3;
  return dataLength > splitWriteNum;
}

/**
 * Split data into chunks for BLE transmission
 * 
 * @param {Buffer} data - Data to split
 * @param {number} maxChunkSize - Maximum chunk size
 * @returns {Buffer[]} Array of chunks
 */
export function splitIntoChunks(data, maxChunkSize = P0AD_CONFIG.SINGLE_PACK_MAX_LENGTH - P0AD_CONFIG.HEADER_SIZE) {
  const chunks = [];
  
  for (let i = 0; i < data.length; i += maxChunkSize) {
    chunks.push(data.slice(i, i + maxChunkSize));
  }
  
  return chunks;
}

/**
 * Pack multiple data for multi-packet transmission
 * Implements logic from AppCommandUtil.packMultiple() line 256
 * 
 * @param {Buffer} data - Data to pack
 * @returns {Buffer[]} Array of chunks ready for transmission
 */
export function packMultiple(data) {
  // The Android code uses CollectionsKt.chunked()
  const maxChunkSize = P0AD_CONFIG.SINGLE_PACK_MAX_LENGTH - P0AD_CONFIG.HEADER_SIZE;
  return splitIntoChunks(data, maxChunkSize);
}

/**
 * Send multi-packet data with proper timing
 * Implements MultiPackUtilV2.sendMultiData() lines 506-538
 * 
 * @param {Object} context - Transmission context
 * @param {Function} context.writeAsync - Async write function
 * @param {Function} context.createPacket - Packet creation function
 * @param {Buffer} data - Data to send
 * @param {number} [delay=20] - Delay between chunks in ms
 * @returns {Promise<void>}
 */
export async function sendMultiPacketAsync({ writeAsync, createPacket }, data, delay = P0AD_CONFIG.SINGLE_PACK_TIME_OFFSET) {
  // Add multi-packet header: [0x07, file_size_4bytes...]
  const header = createMultiPacketHeader(data.length);
  const dataWithHeader = Buffer.concat([header, data]);
  
  // Split into chunks
  const chunks = packMultiple(dataWithHeader);
  
  // Send each chunk with delay between them
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const packet = createPacket(P0AD_CONFIG.SEND_FILE_DATA, chunk);
    
    await writeAsync(packet, false);
    
    // Delay between chunks (SINGLE_PACK_TIME_OFFSET = 20ms)
    // Don't delay after the last chunk
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

---

## Step 6: Implement Handshake Protocol

**File:** `p0ad-handshake.js`

**Reference:** `AppCommandUtil.java:300-354`, `BleConnectUtil.java:527,689`

```javascript
import { P0AD_CONFIG } from './p0ad-constants.js';
import { createPacket } from './p0ad-packet.js';

/**
 * Create first handshake payload
 * Magic bytes: [0x43, 0x43, SET_REMOTE, READ_REMOTE, 0x50]
 * ASCII: "CC" + "HI" + "P" = "CCHIP"
 * 
 * Reference: AppCommandUtil.java:302-310
 * 
 * @returns {Buffer} First handshake payload (5 bytes)
 */
export function createFirstHandshakePayload() {
  return P0AD_CONFIG.HANDSHAKE_MAGIC;
}

/**
 * Create second handshake payload with challenge bytes
 * 
 * Reference: AppCommandUtil.java:312-321
 * 
 * @param {number} b1 - First challenge byte from device response
 * @param {number} b2 - Second challenge byte from device response
 * @returns {Buffer} Second handshake payload (7 bytes)
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
 * Create a handshake packet
 * 
 * @param {number} command - SHAKE_HAND_FIRST (0x00) or SHAKE_HAND_SECOND (0x01)
 * @param {Buffer} payload - Handshake payload
 * @returns {Buffer} Complete handshake packet
 */
export function createHandshakePacket(command, payload) {
  return createPacket(command, payload);
}

/**
 * Parse handshake response from device
 * 
 * Response format: [A0, command, length, payload..., CRC]
 * For first handshake, challenge bytes are at payload[4] and payload[5]
 * For second handshake, result byte is at payload[4]
 * 
 * @param {Buffer} data - Response data
 * @returns {Object} - { type, b1, b2, success } or null if invalid
 */
export function parseHandshakeResponse(data) {
  const command = data[1];
  
  if (command === P0AD_CONFIG.SHAKE_HAND_FIRST) {
    // First handshake response
    // payload starts at index 3
    // Challenge bytes are at positions [5] and [6] of the payload
    // which are at indices 3+5=8 and 3+6=9 of the full packet
    const b1 = data[8];
    const b2 = data[9];
    return { type: 'first', b1, b2 };
  } else if (command === P0AD_CONFIG.SHAKE_HAND_SECOND) {
    // Second handshake response
    // Result byte is at position [5] of the payload (index 3+5=8)
    const resultByte = data[8];
    const success = resultByte === 0x00;
    return { type: 'second', success, resultByte };
  }
  
  return null;
}

/**
 * Perform complete handshake sequence
 * Implements algorithm from AppCommandUtil.java lines 300-354
 * 
 * Sequence:
 * 1. Send first handshake with magic bytes
 * 2. Wait for response, extract challenge bytes
 * 3. Send second handshake with XORed challenge bytes
 * 4. Wait for success confirmation
 * 
 * @param {Object} context - BLE context
 * @param {Function} context.writeAsync - Async write function
 * @param {Function} context.waitForNotification - Notification wait function
 * @param {number} [retryCount=0] - Current retry attempt
 * @param {number} [maxRetries=3] - Maximum retry attempts
 * @returns {Promise<void>}
 */
export async function performHandshake({ writeAsync, waitForNotification }, retryCount = 0, maxRetries = P0AD_CONFIG.SHAKE_RETRY_COUNT) {
  if (retryCount >= maxRetries) {
    throw new Error(`Handshake failed after ${maxRetries} retries`);
  }
  
  try {
    // Step 1: First handshake
    const firstPayload = createFirstHandshakePayload();
    const firstPacket = createHandshakePacket(P0AD_CONFIG.SHAKE_HAND_FIRST, firstPayload);
    
    await writeAsync(firstPacket, false);
    
    // Step 2: Wait for first handshake response
    const firstResponse = await waitForNotification(P0AD_CONFIG.SHAKE_PERIOD_TIME);
    
    const firstResult = parseHandshakeResponse(firstResponse);
    if (!firstResult || firstResult.type !== 'first') {
      throw new Error('Invalid first handshake response');
    }
    
    const { b1, b2 } = firstResult;
    
    // Step 3: Second handshake with XORed challenge bytes
    const secondPayload = createSecondHandshakePayload(b1, b2);
    const secondPacket = createHandshakePacket(P0AD_CONFIG.SHAKE_HAND_SECOND, secondPayload);
    
    await writeAsync(secondPacket, false);
    
    // Step 4: Wait for second handshake response
    const secondResponse = await waitForNotification(P0AD_CONFIG.SHAKE_PERIOD_TIME);
    
    const secondResult = parseHandshakeResponse(secondResponse);
    if (!secondResult || secondResult.type !== 'second') {
      throw new Error('Invalid second handshake response');
    }
    
    if (!secondResult.success) {
      throw new Error(`Handshake failed: device returned 0x${secondResult.resultByte.toString(16)}`);
    }
    
  } catch (error) {
    // Retry after a short delay
    await new Promise(resolve => setTimeout(resolve, 100));
    return performHandshake({ writeAsync, waitForNotification }, retryCount + 1, maxRetries);
  }
}
```

---

## Step 7: Implement Text Rendering

**File:** `p0ad-text-rendering.js`

**Reference:** `TextPixelUtil.java:1256-1348`, `DeviceCommand.java:676-792`

```javascript
import { P0AD_CONFIG } from './p0ad-constants.js';
import { SEGMENT_TYPE } from './p0ad-constants.js';
import { createCanvas } from 'canvas';

/**
 * Create a canvas for text rendering
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Object} - { canvas, context }
 */
export function createTextCanvas(width = P0AD_CONFIG.WIDTH, height = P0AD_CONFIG.HEIGHT) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

/**
 * Check if character is an emoji
 * 
 * Reference: TextPixelUtil.java uses emoji detection for separate handling
 * 
 * @param {string} char - Character to check
 * @returns {boolean} - True if character is an emoji
 */
export function isEmoji(char) {
  if (char.length !== 1 && char.length !== 2) return false;
  
  const code = char.codePointAt(0);
  
  // Common emoji ranges
  const emojiRanges = [
    [0x1F600, 0x1F64F], // Emoticons
    [0x1F300, 0x1F5FF], // Misc Symbols and Pictographs
    [0x1F680, 0x1F6FF], // Transport and Map
    [0x1F1E0, 0x1F1FF], // Flags
    [0x2600, 0x26FF],   // Misc Symbols
    [0x2700, 0x27BF],   // Dingbats
    [0x1F900, 0x1F9FF], // Supplemental Symbols and Pictographs
    [0x1FA00, 0x1FA6F], // Chess Symbols
    [0x1FA70, 0x1FAFF], // Symbols and Pictographs Extended-A
    [0x200D, 0x200D],   // Zero Width Joiner
    [0xFE0F, 0xFE0F]    // Variation Selector-16
  ];
  
  for (const [start, end] of emojiRanges) {
    if (code >= start && code <= end) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get Arabic tag for RTL text handling
 * Used for grouping RTL characters
 * 
 * @param {string} char - Character to check
 * @returns {number} - arabicTag (0 for LTR, >0 for RTL script groups)
 */
export function getArabicTag(char) {
  if (char.length === 0) return 0;
  
  const code = char.codePointAt(0);
  
  // Arabic script range
  if (code >= 0x0600 && code <= 0x06FF) return 1;
  // Hebrew script range
  if (code >= 0x0590 && code <= 0x05FF) return 2;
  // Persian additions
  if (code >= 0x0750 && code <= 0x077F) return 3;
  if (code >= 0x08A0 && code <= 0x08FF) return 4;
  if (code >= 0xFB50 && code <= 0xFDFF) return 5;
  if (code >= 0xFE70 && code <= 0xFEFF) return 6;
  
  return 0; // LTR
}

/**
 * Render text and extract per-character pixel data
 * Implements character-by-character rendering from DeviceCommand.packTextData() lines 676-792
 * 
 * @param {string} text - Text to render
 * @param {Object} options - Rendering options
 * @param {number} [options.fontSize=16] - Font size in pixels
 * @param {string} [options.fontFamily='Arial'] - Font family
 * @param {number} [options.width=96] - Canvas width
 * @param {number} [options.height=16] - Canvas height
 * @param {string} [options.textColor='#FFFFFF'] - Text color (hex)
 * @param {string} [options.bgColor='#000000'] - Background color (hex)
 * @returns {Object} - { characters: Array<CharacterData>, width, height }
 */
export function renderTextToCharacters(text, options = {}) {
  const {
    fontSize = 16,
    fontFamily = 'Arial',
    width = P0AD_CONFIG.WIDTH,
    height = P0AD_CONFIG.HEIGHT,
    textColor = '#FFFFFF',
    bgColor = '#000000'
  } = options;
  
  const { ctx } = createTextCanvas(width, height);
  
  // Clear with background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  
  // Set font
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = textColor;
  
  const characters = [];
  let xPos = 0;
  
  // Process each character individually
  for (const char of text) {
    // Measure character width
    const metrics = ctx.measureText(char);
    const charWidth = Math.min(Math.ceil(metrics.width), width - xPos);
    
    if (charWidth <= 0) continue;
    
    // Create a character canvas
    const charCanvas = createCanvas(charWidth, height);
    const charCtx = charCanvas.getContext('2d');
    
    // Clear
    charCtx.fillStyle = bgColor;
    charCtx.fillRect(0, 0, charWidth, height);
    
    // Set font and draw
    charCtx.font = `${fontSize}px ${fontFamily}`;
    charCtx.textBaseline = 'top';
    charCtx.textAlign = 'left';
    charCtx.fillStyle = textColor;
    charCtx.fillText(char, 0, 0);
    
    // Extract pixel data
    const charImageData = charCtx.getImageData(0, 0, charWidth, height);
    const pixels = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < charWidth; x++) {
        const idx = (y * charWidth + x) * 4;
        const r = charImageData.data[idx];
        const g = charImageData.data[idx + 1];
        const b = charImageData.data[idx + 2];
        
        // Calculate luminance
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
    if (xPos >= width) break;
  }
  
  return { characters, width, height };
}

/**
 * Pack monochrome pixel data into bytes (8 pixels per byte)
 * Bit 0 = LSB = leftmost pixel in each 8-pixel group
 * 
 * This implements the exact algorithm from TextPixelUtil.text2Data()
 * 
 * Reference: TextPixelUtil.java:1256-1348
 * 
 * @param {Uint8Array|number[]} pixels - Monochrome pixel data (1 = on, 0 = off)
 * @param {number} width - Width of the pixel grid
 * @param {number} height - Height of the pixel grid
 * @returns {Buffer} - Bit-packed pixel data
 */
export function packPixelsToBytes(pixels, width, height) {
  const result = [];
  
  for (let y = 0; y < height; y++) {
    // Process in 8-pixel groups (bytes)
    const bytesPerRow = Math.ceil(width / 8);
    
    for (let byteIndex = 0; byteIndex < bytesPerRow; byteIndex++) {
      let byteValue = 0;
      const startX = byteIndex * 8;
      const endX = Math.min(startX + 8, width);
      
      for (let x = startX; x < endX; x++) {
        const idx = y * width + x;
        if (pixels[idx] === 1) {
          byteValue |= (1 << (x - startX));
        }
      }
      
      result.push(byteValue);
    }
  }
  
  return Buffer.from(result);
}

/**
 * Pack text data into P0AD format
 * Implements the exact algorithm from DeviceCommand.packTextData() lines 676-792
 * 
 * Key features:
 * - Per-character segmentation with PixelTextBean
 * - RTL text handling with arabicTag grouping
 * - Emoji detection and separate handling
 * - Support for extended format (support600Txt)
 * 
 * @param {Object} param0 - Rendered text data
 * @param {Array<CharacterData>} param0.characters - Array of character data
 * @param {Object} options - Packing options
 * @param {boolean} [options.support600Txt=false] - Use extended format
 * @param {number} [options.textMode=0] - Text mode (0=LTR, 1=special, 2=RTL)
 * @param {number} [options.defaultColor=0xFFFFFF] - Default color (ARGB)
 * @returns {Buffer} - Packed text data
 */
export function packTextData({ characters }, options = {}) {
  const {
    support600Txt = false,
    textMode = 0, // TEXT_MODE.NORMAL
    defaultColor = 0xFFFFFF
  } = options;
  
  const segments = [];
  const groups = {}; // Group characters by arabicTag for RTL
  let currentTag = 0;
  
  // Process each character
  for (const charData of characters) {
    const { char, width, height, pixels, isEmoji, arabicTag } = charData;
    
    // Handle emoji - flush any pending RTL groups first
    if (isEmoji) {
      flushCurrentGroup(segments, groups, currentTag, textMode, support600Txt);
      currentTag = 0;
      
      // Add emoji segment (type 0x02)
      addEmojiSegment(segments, charData, support600Txt, defaultColor);
      continue;
    }
    
    // Handle regular text with RTL grouping
    if (arabicTag === 0) {
      // LTR character - flush any pending RTL groups
      flushCurrentGroup(segments, groups, currentTag, textMode, support600Txt);
      currentTag = 0;
      
      // Add LTR character immediately
      addRegularCharacter(segments, charData, support600Txt);
    } else {
      // RTL character - add to group
      if (arabicTag === currentTag) {
        if (!groups[currentTag]) {
          groups[currentTag] = [];
        }
        groups[currentTag].push(charData);
      } else {
        // Different RTL group - flush previous group
        flushCurrentGroup(segments, groups, currentTag, textMode, support600Txt);
        
        // Start new group
        currentTag = arabicTag;
        groups[currentTag] = [charData];
      }
    }
  }
  
  // Flush any remaining groups
  flushCurrentGroup(segments, groups, currentTag, textMode, support600Txt);
  
  return Buffer.concat(segments);
}

/**
 * Flush current RTL group to segments
 */
function flushCurrentGroup(segments, groups, currentTag, textMode, support600Txt) {
  if (currentTag > 0 && groups[currentTag]) {
    const group = groups[currentTag];
    
    // Reverse for RTL (DeviceCommand.java:743-744 uses CollectionsKt.reverse())
    if (textMode === 2) { // TEXT_MODE.RTL
      group.reverse();
    }
    
    for (const c of group) {
      addRegularCharacter(segments, c, support600Txt);
    }
    
    delete groups[currentTag];
  }
}

/**
 * Add a regular character segment to the output
 * Segment format: [type, width, height, color_mode, pixel_data...]
 */
function addRegularCharacter(segments, charData, support600Txt) {
  const { width, height, pixels } = charData;
  
  // Segment header
  segments.push(Buffer.from([
    SEGMENT_TYPE.REGULAR_TEXT,  // Type: 0x01
    width & 0xFF,                // Width
    height & 0xFF                // Height
  ]));
  
  // Color mode
  if (support600Txt) {
    segments.push(Buffer.from([0x01, 0x00]));
  } else {
    segments.push(Buffer.from([0x01]));
  }
  
  // Pixel data
  const pixelData = packPixelsToBytes(pixels, width, height);
  segments.push(pixelData);
}

/**
 * Add an emoji segment to the output
 * Segment format: [type, width, height, color_mode, rgb_pixel_data...]
 */
function addEmojiSegment(segments, charData, support600Txt, defaultColor) {
  const { width, height, pixels } = charData;
  
  // Segment header
  segments.push(Buffer.from([
    SEGMENT_TYPE.EMOJI,     // Type: 0x02
    width & 0xFF,           // Width
    height & 0xFF           // Height
  ]));
  
  // Color mode
  if (support600Txt) {
    segments.push(Buffer.from([0x01, 0x00]));
  } else {
    segments.push(Buffer.from([0x01]));
  }
  
  // RGB pixel data (3 bytes per pixel: R, G, B)
  // Row-major order, left to right, top to bottom
  const rgbData = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (pixels[idx] === 1) {
        // Foreground pixel - white
        rgbData.push(0xFF, 0xFF, 0xFF);
      } else {
        // Background pixel - use defaultColor
        const r = (defaultColor >> 16) & 0xFF;
        const g = (defaultColor >> 8) & 0xFF;
        const b = defaultColor & 0xFF;
        rgbData.push(r, g, b);
      }
    }
  }
  
  segments.push(Buffer.from(rgbData));
}
```

---

## Step 8: Implement File Format

**File:** `p0ad-file-format.js`

**Reference:** `DeviceCommand.java:1056-1068`

```javascript
import { P0AD_CONFIG } from './p0ad-constants.js';

/**
 * Create a text file for the P0AD device
 * 
 * File Format (DeviceCommand.java:1056-1068):
 * [file_type: 1 byte] [filename_length: 1 byte] [filename: N bytes] [text_data...]
 * 
 * @param {Buffer} textData - Packed text data
 * @param {string} [fileName] - Optional file name (auto-generated if not provided)
 * @returns {Buffer} - File data with header
 */
export function createTextFile(textData, fileName = null) {
  // Auto-generate filename if not provided
  if (!fileName) {
    // Generate timestamp-based filename like Android does
    const timestamp = Date.now().toString().slice(-6);
    fileName = `txt${timestamp}`;
  }
  
  const fileNameBuffer = Buffer.from(fileName, 'utf8');
  
  return Buffer.concat([
    Buffer.from([P0AD_CONFIG.USER_FILE_TYPE_TXT]),
    Buffer.from([fileNameBuffer.length]),
    fileNameBuffer,
    textData
  ]);
}

/**
 * Parse a received file
 * @param {Buffer} fileData - File data
 * @returns {Object} - { type, fileName, content }
 */
export function parseFile(fileData) {
  if (fileData.length < 2) return null;
  
  const fileType = fileData[0];
  const fileNameLength = fileData[1];
  
  if (fileData.length < 2 + fileNameLength) return null;
  
  const fileName = fileData.slice(2, 2 + fileNameLength).toString('utf8');
  const content = fileData.slice(2 + fileNameLength);
  
  return { fileType, fileName, content };
}
```

---

## Step 9: Create P0ADDevice Class

**File:** `p0ad-device.js`

**Reference:** `DeviceCommand.java:1031-1104`, `BleConnectUtil.java`

```javascript
import { P0AD_CONFIG, TEXT_MODE } from './p0ad-constants.js';
import { createPacket } from './p0ad-packet.js';
import { performHandshake } from './p0ad-handshake.js';
import { renderTextToCharacters, packTextData } from './p0ad-text-rendering.js';
import { createTextFile } from './p0ad-file-format.js';
import { needSplitData, sendMultiPacketAsync } from './p0ad-multipacket.js';

/**
 * P0AD Device class for BLE communication
 * Uses @stoprocent/noble with async/await promises
 * 
 * Reference: DeviceCommand.java:1031-1104
 */
export class P0ADDevice {
  /**
   * Create a P0AD device instance
   * @param {Object} noble - Noble library instance from @stoprocent/noble
   */
  constructor(noble) {
    this.noble = noble;
    this.peripheral = null;
    this.writeCharacteristic = null;
    this.noticeCharacteristic = null;
    this.isConnected = false;
    this.isReady = false;
    this.isHandshakeComplete = false;
    
    // Notification state
    this.pendingNotification = null;
    this.notificationResolve = null;
    this.notificationReject = null;
    
    // Handshake state
    this.handshakeRetryCount = 0;
  }
  
  /**
   * Scan for P0AD devices
   * @param {Object} [options] - Scan options
   * @param {number} [options.timeout=10000] - Scan timeout in ms
   * @yields {Peripheral} Discovered P0AD peripheral
   */
  async *scanForDevices(options = {}) {
    const { timeout = 10000 } = options;
    
    await this.noble.waitForPoweredOnAsync();
    console.log('Bluetooth adapter powered on, starting scan...');
    
    await this.noble.startScanningAsync([P0AD_CONFIG.SERVICE_UUID], true);
    
    const scanTimeout = setTimeout(() => {
      this.noble.stopScanningAsync().catch(() => {});
    }, timeout);
    
    try {
      const discovered = new Set();
      
      for await (const peripheral of this.noble.discoverAsync()) {
        if (discovered.has(peripheral.id)) continue;
        
        if (peripheral.advertisement?.serviceUuids?.includes(P0AD_CONFIG.SERVICE_UUID)) {
          discovered.add(peripheral.id);
          console.log('Found P0AD device:', {
            id: peripheral.id,
            address: peripheral.address,
            name: peripheral.advertisement.localName,
            rssi: peripheral.rssi
          });
          yield peripheral;
        }
      }
    } finally {
      clearTimeout(scanTimeout);
      await this.noble.stopScanningAsync().catch(() => {});
    }
  }
  
  /**
   * Connect to a P0AD device by ID or address
   * Automatically performs handshake after connection
   * 
   * @param {string} deviceIdOrAddress - Device ID or MAC address
   * @param {Object} [options] - Connection options
   * @param {number} [options.timeout=10000] - Connection timeout in ms
   * @returns {Promise<void>}
   */
  async connect(deviceIdOrAddress, options = {}) {
    const { timeout = 10000 } = options;
    
    const timeoutId = setTimeout(() => {
      this.cleanupConnection();
      throw new Error(`Connection timeout after ${timeout}ms`);
    }, timeout);
    
    try {
      console.log(`Connecting to P0AD device: ${deviceIdOrAddress}`);
      
      this.peripheral = await this.noble.connectAsync(deviceIdOrAddress);
      console.log('Connected to P0AD device');
      this.isConnected = true;
      
      const { services, characteristics } = await this.peripheral.discoverAllServicesAndCharacteristicsAsync();
      
      const writeChar = characteristics.find(c => c.uuid === P0AD_CONFIG.WRITE_UUID);
      const noticeChar = characteristics.find(c => c.uuid === P0AD_CONFIG.NOTICE_UUID);
      
      if (!writeChar) throw new Error('Write characteristic not found');
      if (!noticeChar) throw new Error('Notice characteristic not found');
      
      this.writeCharacteristic = writeChar;
      this.noticeCharacteristic = noticeChar;
      console.log('Found P0AD characteristics');
      
      // Subscribe to notifications
      await this.noticeCharacteristic.subscribeAsync();
      
      this.noticeCharacteristic.on('data', (data, isNotification) => {
        if (isNotification) this.handleNotification(data);
      });
      
      console.log('Starting handshake...');
      await this.performHandshakeInternal();
      
      console.log('Handshake completed successfully');
      this.isHandshakeComplete = true;
      this.isReady = true;
      
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Connect to first discovered P0AD device
   * @param {Object} [options] - Options
   * @param {number} [options.scanTimeout=10000] - Scan timeout in ms
   * @param {number} [options.connectTimeout=10000] - Connection timeout in ms
   * @returns {Promise<void>}
   */
  async connectFirst(options = {}) {
    const { scanTimeout = 10000, connectTimeout = 10000 } = options;
    
    const scanTimeoutId = setTimeout(() => {
      this.noble.stopScanningAsync().catch(() => {});
      throw new Error(`No P0AD device found after ${scanTimeout}ms`);
    }, scanTimeout);
    
    try {
      await this.noble.waitForPoweredOnAsync();
      await this.noble.startScanningAsync([P0AD_CONFIG.SERVICE_UUID], true);
      
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
   * Internal handshake method
   * @returns {Promise<void>}
   */
  async performHandshakeInternal() {
    await performHandshake({
      writeAsync: (packet, withoutResponse) => this.writeCharacteristic.writeAsync(packet, withoutResponse),
      waitForNotification: (timeout) => this.waitForNotification(timeout)
    });
  }
  
  /**
   * Handle incoming notification data from the device
   * @param {Buffer} data - Notification data
   */
  handleNotification(data) {
    // Check if this is a response to a pending notification wait
    if (this.pendingNotification) {
      this.pendingNotification.resolve(data);
      this.pendingNotification = null;
      return;
    }
    
    // Check for handshake responses
    const command = data[1];
    
    if (command === P0AD_CONFIG.SHAKE_HAND_FIRST) {
      // First handshake response
      const b1 = data[8];
      const b2 = data[9];
      console.log(`Challenge bytes: b1=0x${b1.toString(16)}, b2=0x${b2.toString(16)}`);
      if (this.notificationResolve) {
        this.notificationResolve({ type: 'first', b1, b2 });
        this.notificationResolve = null;
        this.notificationReject = null;
      }
    } else if (command === P0AD_CONFIG.SHAKE_HAND_SECOND) {
      // Second handshake response
      const resultByte = data[8];
      if (resultByte === 0x00) {
        console.log('Handshake success');
        if (this.notificationResolve) {
          this.notificationResolve({ type: 'second', success: true });
          this.notificationResolve = null;
          this.notificationReject = null;
        }
      } else {
        console.log(`Handshake failed: 0x${resultByte.toString(16)}`);
        if (this.notificationReject) {
          this.notificationReject(new Error(`Handshake failed: 0x${resultByte.toString(16)}`));
          this.notificationReject = null;
          this.notificationResolve = null;
        }
      }
    }
    
    // Log other notifications
    console.log(`Received notification: command=0x${command.toString(16)}, data=${data.toString('hex')}`);
  }
  
  /**
   * Wait for a notification with timeout
   * @param {number} timeout - Timeout in milliseconds
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
   * Send text to the P0AD display
   * Implements DeviceCommand.sendTextData() lines 1085-1104
   * 
   * Complete flow:
   * 1. Render text to characters
   * 2. Pack text data
   * 3. Create file with header
   * 4. Check if multi-packet transmission needed
   * 5. Send data (single or multi-packet)
   * 6. Send SHOW_TEXT command
   * 
   * @param {string} text - Text to display
   * @param {Object} [options] - Display options
   * @param {number} [options.fontSize=16] - Font size
   * @param {string} [options.fontFamily='Arial'] - Font family
   * @param {number} [options.textMode=0] - Text mode (0=LTR, 1=special, 2=RTL)
   * @param {number} [options.defaultColor=0xFFFFFF] - Default color
   * @returns {Promise<void>}
   */
  async sendTextAsync(text, options = {}) {
    if (!this.isReady) throw new Error('Device not ready');
    if (!this.isHandshakeComplete) throw new Error('Handshake not completed');
    
    console.log(`Sending text: "${text}"`);
    
    // Step 1: Render text to characters
    const rendered = renderTextToCharacters(text, options);
    console.log(`Rendered ${rendered.characters.length} characters`);
    
    // Step 2: Pack text data
    const textData = packTextData(rendered, options);
    console.log(`Packed text data: ${textData.length} bytes`);
    
    // Step 3: Create file
    const fileData = createTextFile(textData);
    console.log(`File data: ${fileData.length} bytes`);
    
    // Step 4: Check if multi-packet transmission needed
    if (needSplitData(fileData.length)) {
      console.log('Using multi-packet transmission');
      await sendMultiPacketAsync(
        { writeAsync: (packet, withoutResponse) => this.writeCharacteristic.writeAsync(packet, withoutResponse), createPacket },
        fileData
      );
    } else {
      console.log('Using single-packet transmission');
      // Single packet: send directly with SEND_FILE_DATA command
      const packet = createPacket(P0AD_CONFIG.SEND_FILE_DATA, fileData);
      await this.writeCharacteristic.writeAsync(packet, false);
    }
    
    // Step 5: Send SHOW_TEXT command to display the file
    console.log('All chunks sent, sending SHOW_TEXT command');
    const showTextPacket = createPacket(P0AD_CONFIG.SHOW_TEXT, Buffer.from([P0AD_CONFIG.USER_FILE_TYPE_TXT]));
    await this.writeCharacteristic.writeAsync(showTextPacket, false);
    
    console.log('Text display command sent');
  }
  
  /**
   * Send raw command to device
   * @param {number} command - Command code
   * @param {Buffer} payload - Payload data
   * @returns {Promise<void>}
   */
  async sendCommandAsync(command, payload) {
    if (!this.isReady) throw new Error('Device not ready');
    if (!this.isHandshakeComplete) throw new Error('Handshake not completed');
    
    const packet = createPacket(command, payload);
    console.log(`Sending command 0x${command.toString(16)}`);
    await this.writeCharacteristic.writeAsync(packet, false);
  }
  
  /**
   * Set display brightness
   * @param {number} brightness - Brightness (0-100)
   * @returns {Promise<void>}
   */
  async setBrightnessAsync(brightness) {
    const payload = Buffer.from([Math.min(100, Math.max(0, brightness))]);
    await this.sendCommandAsync(0x13, payload);
  }
  
  /**
   * Turn display on/off
   * @param {boolean} on - True to turn on, false to turn off
   * @returns {Promise<void>}
   */
  async setDisplayAsync(on) {
    const payload = Buffer.from([on ? 0x01 : 0x00]);
    await this.sendCommandAsync(0x11, payload);
  }
  
  /**
   * Disconnect asynchronously
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
      console.log('Disconnected from P0AD device');
    }
  }
  
  /**
   * Clean up connection state
   */
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
```

---

## Step 10: Create Main Module

**File:** `p0ad-protocol.js`

```javascript
// P0AD Protocol Module - Main Entry Point
// ESM module for Node.js 26+

// Export all constants
export { P0AD_CONFIG, TEXT_MODE, SEGMENT_TYPE } from './p0ad-constants.js';

// Export CRC functions
export { calculateCRC16, verifyCRC16 } from './p0ad-crc.js';

// Export packet functions
export { createPacket, parsePacket } from './p0ad-packet.js';

// Export multi-packet functions
export { 
  createMultiPacketHeader, 
  needSplitData, 
  splitIntoChunks, 
  packMultiple,
  sendMultiPacketAsync 
} from './p0ad-multipacket.js';

// Export handshake functions
export { 
  createFirstHandshakePayload, 
  createSecondHandshakePayload, 
  createHandshakePacket,
  parseHandshakeResponse,
  performHandshake 
} from './p0ad-handshake.js';

// Export text rendering functions
export { 
  createTextCanvas,
  isEmoji,
  getArabicTag,
  renderTextToCharacters,
  packPixelsToBytes,
  packTextData 
} from './p0ad-text-rendering.js';

// Export file format functions
export { createTextFile, parseFile } from './p0ad-file-format.js';

// Export device class
export { P0ADDevice } from './p0ad-device.js';

// Default export for compatibility
export default {
  P0AD_CONFIG,
  TEXT_MODE,
  SEGMENT_TYPE,
  calculateCRC16,
  verifyCRC16,
  createPacket,
  parsePacket,
  createMultiPacketHeader,
  needSplitData,
  splitIntoChunks,
  packMultiple,
  sendMultiPacketAsync,
  createFirstHandshakePayload,
  createSecondHandshakePayload,
  createHandshakePacket,
  parseHandshakeResponse,
  performHandshake,
  createTextCanvas,
  isEmoji,
  getArabicTag,
  renderTextToCharacters,
  packPixelsToBytes,
  packTextData,
  createTextFile,
  parseFile,
  P0ADDevice
};
```

---

## Step 11: Testing the Implementation

### 11.1 Basic Usage Test

**File:** `test-basic.js`

```javascript
import { P0ADDevice, TEXT_MODE } from './p0ad-protocol.js';
import noble from '@stoprocent/noble';

const device = new P0ADDevice(noble);

async function main() {
  try {
    // Wait for adapter and connect to first device
    await device.connectFirst({ scanTimeout: 10000, connectTimeout: 10000 });
    
    console.log('Connected and handshake completed!');
    
    // Send simple text
    await device.sendTextAsync('Hello World!', { 
      fontSize: 14,
      textMode: TEXT_MODE.NORMAL
    });
    console.log('Text sent successfully!');
    
    // Send RTL (Arabic) text
    await device.sendTextAsync('مرحبا', { 
      fontSize: 16,
      textMode: TEXT_MODE.RTL,
      fontFamily: 'Arial'
    });
    console.log('RTL text sent successfully!');
    
    // Send text with emoji
    await device.sendTextAsync('Hello 😀 World!', { 
      fontSize: 14,
      textMode: TEXT_MODE.NORMAL
    });
    console.log('Text with emoji sent successfully!');
    
    // Set brightness
    await device.setBrightnessAsync(75);
    console.log('Brightness set to 75%');
    
    // Disconnect
    await device.disconnectAsync();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
```

### 11.2 Unit Tests

**File:** `test-units.js`

```javascript
import { 
  calculateCRC16, 
  createPacket, 
  packPixelsToBytes,
  needSplitData,
  isEmoji,
  getArabicTag 
} from './p0ad-protocol.js';

// Test CRC16 calculation
const testData = Buffer.from([0xA0, 0x0A, 0x03]);
const crc = calculateCRC16(testData);
console.log('CRC16 test:', crc.toString('hex'));

// Test packet creation
const packet = createPacket(0x0A, Buffer.from([0x01]));
console.log('Packet:', packet.toString('hex'));

// Test pixel packing
const pixels = new Array(16).fill(0);
pixels[0] = 1; pixels[1] = 1; pixels[2] = 1; pixels[3] = 1;
const packed = packPixelsToBytes(pixels, 4, 4);
console.log('Packed pixels:', packed.toString('hex'));

// Test needSplitData
console.log('Need split (247 bytes):', needSplitData(247));
console.log('Need split (248 bytes):', needSplitData(248));

// Test emoji detection
console.log('Is emoji (A):', isEmoji('A'));
console.log('Is emoji (😀):', isEmoji('😀'));

// Test Arabic tag
console.log('Arabic tag (A):', getArabicTag('A'));
console.log('Arabic tag (م):', getArabicTag('م'));
```

---

## Step 12: Implementation Checklist

- [ ] Project setup with ESM configuration
- [ ] @stoprocent/noble and canvas dependencies installed
- [ ] `p0ad-constants.js` - All constants defined
- [ ] `p0ad-crc.js` - CRC16 calculation
- [ ] `p0ad-packet.js` - Packet construction and parsing
- [ ] `p0ad-multipacket.js` - Multi-packet support
- [ ] `p0ad-handshake.js` - Handshake protocol
- [ ] `p0ad-text-rendering.js` - Text rendering with RTL and emoji
- [ ] `p0ad-file-format.js` - File format handling
- [ ] `p0ad-device.js` - P0ADDevice class
- [ ] `p0ad-protocol.js` - Main module exports
- [ ] Basic usage test (`test-basic.js`)
- [ ] Unit tests (`test-units.js`)

---

## Step 13: Verification Steps

1. **Code Review:** Verify all files match the specifications in the documentation
2. **Reference Check:** Verify all source code references use IDE-friendly format
3. **ESM Compliance:** Ensure no CommonJS `require()` or `module.exports`
4. **Async/Await:** Verify all operations use promises, no callbacks
5. **Modern Node.js:** Use modern syntax (optional chaining, nullish coalescing, etc.)
6. **Error Handling:** Proper error handling with async/await
7. **RTL Support:** Test with Arabic, Hebrew, Persian text
8. **Emoji Support:** Test with various emoji characters
9. **Multi-Packet:** Test with text > 247 bytes
10. **Hardware Testing:** Test with actual P0AD device when available

---

## Step 14: Source Code References

All implementation details are based on the following source files from the decompiled PixelJoy Android app:

| File | Lines | Purpose |
|------|-------|---------|
| `AppCommandUtil.java` | 29-47, 133-135, 256, 300-354 | Constants, handshake, split logic |
| `DeviceCommand.java` | 676-792, 88-110, 1031-1104 | Text packing, commands, file sending |
| `TextPixelUtil.java` | 1256-1348 | Text to pixel conversion |
| `BleDataUtils.java` | 45-59 | Packet construction, CRC16 |
| `BleConnectUtil.java` | 502, 527, 689 | BLE connection, MTU, subscription |
| `MultiPackUtilV2.java` | 328-340, 506-538 | Multi-packet transmission |
| `PixelTextBean.java` | - | Text pixel data structure |
| `DeviceBean.java` | - | Device properties |

**IDE-Friendly Reference Format:** Use `path/to/file.java:line_number` to navigate directly in most IDEs.

---

## Step 15: Troubleshooting

### Common Issues

1. **Bluetooth not available:**
   - macOS: Enable Bluetooth access in System Preferences > Security & Privacy > Bluetooth
   - Linux: Ensure user is in `bluetooth` group
   - Raspberry Pi: Install all dependencies listed in Step 1

2. **Device not discovered:**
   - Check if device is in advertising mode
   - Verify BLE adapter is working
   - Check distance/RSSI

3. **Connection timeout:**
   - Increase scanTimeout and connectTimeout
   - Check device battery level

4. **Handshake failure:**
   - Verify challenge bytes are correctly extracted
   - Check CRC16 calculation
   - Ensure correct XOR operations in second handshake

5. **Text not displaying:**
   - Verify SHOW_TEXT command is sent after file data
   - Check file format (type, filename length, filename)
   - Verify segment types (0x01 for text, 0x02 for emoji)

### Debug Tips

1. Log all packets: `console.log(packet.toString('hex'))`
2. Verify CRC: Use `verifyCRC16(packet)`
3. Check packet structure with hex dump
4. Compare with Android app behavior
5. Use BLE scanner app to verify device advertising

---

## Quick Reference

### Commands

| Command | Code | Description |
|---------|------|-------------|
| SHOW_TEXT | 0x0A | Display text file |
| SEND_FILE_DATA | 0x07 | Send file data |
| SET_BRIGHTNESS | 0x13 | Set display brightness |
| SWITCH_LIGHT | 0x11 | Turn display on/off |

### Packet Structure

```
Header:    [0xA0] [command] [length+3]
Payload:   [data...]
Footer:    [CRC16 high] [CRC16 low]
```

### File Format

```
[file_type:1] [filename_length:1] [filename:N] [text_segments...]
```

### Text Segment Types

- **0x01** - Regular text character (single color)
- **0x02** - Emoji character (RGB color per pixel)

### Segment Structure

```
[type:1] [width:1] [height:1] [color_mode:1] [pixel_data:variable]
```

---

## Next Steps

1. Implement the files in the order specified above
2. Test each module independently with unit tests
3. Test the complete flow with a P0AD device
4. Extend for additional features:
   - Image display (SHOW_IMG = 0x0B)
   - GIF animation (SHOW_GIF = 0x0C)
   - Advanced emoji support with color
   - Custom fonts
   - Scrolling text

---

## Notes for Devstral Small 2

1. **Follow the order:** Implement files in the sequence specified (constants first, then utilities, then device class)
2. **Use ESM:** Always use `import`/`export`, never `require()`/`module.exports`
3. **Async/await:** All BLE operations must use promises, no callbacks
4. **Type safety:** Consider adding JSDoc comments for better IDE support
5. **Error handling:** Always handle errors in async functions
6. **Testing:** Test each component independently before integrating
7. **References:** Use the source code references (file.java:line) for verification
8. **Modern syntax:** Use Node.js 26+ features (optional chaining, nullish coalescing, etc.)

---

*Documentation generated from analysis of decompiled PixelJoy Android application*
*All source code references use IDE-friendly format: `path/to/file.java:line_number`*
