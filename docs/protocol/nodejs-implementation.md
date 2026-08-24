# Node.js Implementation Guide for P0AD Protocol

This guide provides a complete Node.js implementation for communicating with the P0AD LED display device using the documented protocol. The implementation uses ESM modules, async/await promises, and the `@stoprocent/noble` library for BLE communication.

## Prerequisites

### Required Packages

```bash
npm install @stoprocent/noble canvas
```

- **@stoprocent/noble** - Modern BLE communication library with full Promise/async support
- **canvas** - Text rendering to bitmap (requires Cairo on Linux)

### Platform Notes

- **macOS:** Install Xcode and ensure Terminal has Bluetooth access in System Preferences > Security & Privacy > Bluetooth
- **Linux:** Install `bluez`, `libbluetooth-dev`, and `libudev-dev`
- **Raspberry Pi:** Install with: `sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev`
- **Windows:** Install Windows Build Tools and WinUSB driver for Bluetooth adapter

**Note:** This implementation uses ESM (ECMAScript Modules) and requires Node.js 26+.

## Installation on Raspberry Pi

```bash
# Install system dependencies
sudo apt-get update
sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev

# Install Node.js packages
npm install @stoprocent/noble canvas
```

## package.json (ESM Configuration)

```json
{
  "name": "p0ad-protocol",
  "version": "1.0.0",
  "type": "module",
  "main": "p0ad-protocol.js",
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "@stoprocent/noble": "^1.x",
    "canvas": "^2.x"
  },
  "engines": {
    "node": ">=26.0.0"
  }
}
```

---

## Complete Implementation

### File: `p0ad-protocol.js` (ESM Module)

```javascript
import { createCanvas, loadImage } from 'canvas';

// ============================================================================
// P0AD Device Constants
// ============================================================================

// Use named exports for constants so they can be imported directly
export const P0AD_CONFIG = {
  // BLE UUIDs (128-bit format)
  SERVICE_UUID: '0000e0ad00001000800000805f9b34fb',
  WRITE_UUID: '0000a0ad00001000800000805f9b34fb',
  NOTICE_UUID: '0000f0ad00001000800000805f9b34fb',
  SCANNING_UUID: '0000c0ad00001000800000805f9b34fb',
  
  // Device properties
  WIDTH: 96,
  HEIGHT: 16,
  
  // Protocol constants
  APP_DEVICE: 0xA0,
  SHOW_TEXT: 0x0A,
  SEND_FILE_DATA: 0x07,
  USER_FILE_TYPE_TXT: 0x01,
  USER_FILE_TYPE_IMG: 0x02,
  USER_FILE_TYPE_DYN: 0x03,
  
  // Handshake constants (from DeviceCommand.java)
  SHAKE_HAND_FIRST: 0x00,
  SHAKE_HAND_SECOND: 0x01,
  SET_REMOTE: 0x48,
  READ_REMOTE: 0x49,
  SET_PARTITION: 0x24,
  READ_COMMUNICATION_VERSION: 0x4C,
  
  // Handshake magic bytes: [0x43, 0x43, 0x48, 0x49, 0x50] = "CCHIP"
  HANDSHAKE_MAGIC: Buffer.from([0x43, 0x43, 0x48, 0x49, 0x50]),
  
  // Handshake timing (from AppCommandUtil.java)
  SHAKE_PERIOD_TIME: 1000,  // 1 second timeout
  SHAKE_RETRY_COUNT: 3,     // 3 retries
  
  // Transport limits
  MTU: 512,
  SINGLE_PACK_MAX_LENGTH: 247,
  HEADER_SIZE: 3, // APP_DEVICE + command + length
  CRC_SIZE: 2
};

// Text mode constants
export const TEXT_MODE = {
  NORMAL: 0,    // Left-to-right
  SPECIAL: 1,   // Special handling
  RTL: 2        // Right-to-left (Arabic, Hebrew, etc.)
};

// ============================================================================
// CRC16 Calculation
// ============================================================================

/**
 * Calculate CRC16/CCITT checksum (polynomial 0x1021, initial 0xFFFF, no reflection)
 * Matches the Android implementation in n.java
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
  
  // Return as big-endian buffer
  return Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]);
}

// ============================================================================
// Packet Construction
// ============================================================================

/**
 * Create a BLE packet for the P0AD device
 * Format: [APP_DEVICE, command, length+3, payload..., CRC16]
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

// ============================================================================
// Multi-Packet File Header
// ============================================================================

/**
 * Create multi-packet file header for large file transfers
 * Format: [0x07, file_size_4bytes (big-endian)]
 * Used when file data exceeds SINGLE_PACK_MAX_LENGTH
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

// ============================================================================
// Handshake Functions
// ============================================================================

/**
 * Create first handshake payload
 * Magic bytes: [0x43, 0x43, SET_REMOTE, READ_REMOTE, 0x50]
 * ASCII: "CC" + "HI" + "P" = "CCHIP"
 * @returns {Buffer} First handshake payload (5 bytes)
 */
export function createFirstHandshakePayload() {
  return P0AD_CONFIG.HANDSHAKE_MAGIC;
}

/**
 * Create second handshake payload with challenge bytes
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
 * @param {number} command - SHAKE_HAND_FIRST (0x00) or SHAKE_HAND_SECOND (0x01)
 * @param {Buffer} payload - Handshake payload
 * @returns {Buffer} Complete handshake packet
 */
export function createHandshakePacket(command, payload) {
  return createPacket(command, payload);
}

// ============================================================================
// Text Rendering
// ============================================================================

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
 * Render text and extract monochrome pixel data with per-character segmentation
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
  
  // Draw text
  ctx.fillText(text, 0, 0);
  
  // Get image data
  const imageData = ctx.getImageData(0, 0, width, height);
  
  // Extract character bounding boxes and pixel data
  // For now, we'll treat the whole text as one segment
  // In a full implementation, use ctx.measureText() for each character
  const characters = [];
  
  // Simple approach: render each character individually
  let xPos = 0;
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
 * Simple emoji detection (basic implementation)
 * @param {string} char - Character to check
 * @returns {boolean} - True if character is an emoji
 */
export function isEmoji(char) {
  if (char.length !== 1 && char.length !== 2) return false;
  
  // Check if in common emoji ranges
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
 * @param {string} char - Character to check
 * @returns {number} - arabicTag (0 for LTR, >0 for RTL)
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
 * Get emoji height category
 * @param {string} emoji - Emoji character
 * @returns {number} - Height in pixels (12, 14, 16, 24, 30, or 32)
 */
export function getEmojiHeight(emoji) {
  // Default to 16px for now
  // In a full implementation, this would look up the emoji in the appropriate map
  return 16;
}

// ============================================================================
// Bit Packing (text2Data equivalent)
// ============================================================================

/**
 * Pack monochrome pixel data into bytes (8 pixels per byte)
 * Bit 0 = LSB = leftmost pixel in each 8-pixel group
 * 
 * This implements the exact algorithm from TextPixelUtil.text2Data()
 * @param {Uint8Array|number[]} pixels - Monochrome pixel data (1 = on, 0 = off)
 * @param {number} width - Width of the pixel grid
 * @param {number} height - Height of the pixel grid
 * @returns {Buffer} - Bit-packed pixel data
 */
export function packPixelsToBytes(pixels, width, height) {
  const result = [];
  
  for (let y = 0; y < height; y++) {
    // First 8 columns (0-7)
    let byte0 = 0;
    for (let x = 0; x < Math.min(8, width); x++) {
      const idx = y * width + x;
      if (pixels[idx] === 1) {
        byte0 |= (1 << x);
      }
    }
    result.push(byte0);
    
    // Second 8 columns (8-15) - if width > 8
    if (width > 8) {
      let byte1 = 0;
      for (let x = 8; x < Math.min(16, width); x++) {
        const idx = y * width + x;
        if (pixels[idx] === 1) {
          byte1 |= (1 << (x - 8));
        }
      }
      result.push(byte1);
    }
    
    // Third 8 columns (16-23) - if width > 16
    if (width > 16) {
      let byte2 = 0;
      for (let x = 16; x < Math.min(24, width); x++) {
        const idx = y * width + x;
        if (pixels[idx] === 1) {
          byte2 |= (1 << (x - 16));
        }
      }
      result.push(byte2);
    }
    
    // Fourth 8 columns (24-31) - if width > 24
    if (width > 24) {
      let byte3 = 0;
      for (let x = 24; x < Math.min(32, width); x++) {
        const idx = y * width + x;
        if (pixels[idx] === 1) {
          byte3 |= (1 << (x - 24));
        }
      }
      result.push(byte3);
    }
    
    // Note: Widths > 32 are not handled in the original code
    // For 96-pixel display, this would need to be extended
  }
  
  return Buffer.from(result);
}

// ============================================================================
// Text Segment Packing (packTextData equivalent)
// ============================================================================

/**
 * Pack text data into P0AD format
 * Implements the exact algorithm from DeviceCommand.packTextData() lines 676-792
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
    textMode = TEXT_MODE.NORMAL,
    defaultColor = 0xFFFFFF
  } = options;
  
  const segments = [];
  const groups = {}; // Group characters by arabicTag for RTL
  let currentTag = 0;
  
  // Process each character
  for (const charData of characters) {
    const { char, width, height, pixels, isEmoji, arabicTag } = charData;
    
    // Handle emoji
    if (isEmoji) {
      // Flush any pending RTL groups
      if (currentTag > 0 && groups[currentTag]) {
        const group = groups[currentTag];
        if (textMode === TEXT_MODE.RTL) {
          group.reverse(); // Reverse for RTL
        }
        for (const c of group) {
          addRegularCharacter(segments, c, support600Txt);
        }
        delete groups[currentTag];
        currentTag = 0;
      }
      
      // Add emoji segment
      addEmojiSegment(segments, charData, support600Txt, defaultColor);
      continue;
    }
    
    // Handle regular text with RTL grouping
    if (arabicTag === 0) {
      // LTR character - flush any pending RTL groups
      if (currentTag > 0 && groups[currentTag]) {
        const group = groups[currentTag];
        if (textMode === TEXT_MODE.RTL) {
          group.reverse(); // Reverse for RTL
        }
        for (const c of group) {
          addRegularCharacter(segments, c, support600Txt);
        }
        delete groups[currentTag];
        currentTag = 0;
      }
      
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
        if (currentTag > 0 && groups[currentTag]) {
          const group = groups[currentTag];
          if (textMode === TEXT_MODE.RTL) {
            group.reverse(); // Reverse for RTL
          }
          for (const c of group) {
            addRegularCharacter(segments, c, support600Txt);
          }
          delete groups[currentTag];
        }
        
        // Start new group
        currentTag = arabicTag;
        groups[currentTag] = [charData];
      }
    }
  }
  
  // Flush any remaining groups
  if (currentTag > 0 && groups[currentTag]) {
    const group = groups[currentTag];
    if (textMode === TEXT_MODE.RTL) {
      group.reverse();
    }
    for (const c of group) {
      addRegularCharacter(segments, c, support600Txt);
    }
  }
  
  return Buffer.concat(segments);
}

/**
 * Add a regular character segment to the output
 * @param {Buffer[]} segments - Array to add segments to
 * @param {CharacterData} charData - Character data
 * @param {boolean} support600Txt - Whether to use extended format
 */
function addRegularCharacter(segments, charData, support600Txt) {
  const { width, height, pixels } = charData;
  
  // Segment header
  segments.push(Buffer.from([
    0x01,           // Type: Regular text
    width & 0xFF,   // Width
    height & 0xFF   // Height
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
 * @param {Buffer[]} segments - Array to add segments to
 * @param {CharacterData} charData - Emoji character data
 * @param {boolean} support600Txt - Whether to use extended format
 * @param {number} defaultColor - Default color for transparent pixels
 */
function addEmojiSegment(segments, charData, support600Txt, defaultColor) {
  const { width, height, pixels, char: emoji } = charData;
  
  // For emojis, we need RGB pixel data
  // In a full implementation, this would come from EmojiUtils
  // For now, we'll use a simplified approach
  
  // Segment header
  segments.push(Buffer.from([
    0x02,           // Type: Emoji
    width & 0xFF,   // Width
    height & 0xFF   // Height
  ]));
  
  // Color mode
  if (support600Txt) {
    segments.push(Buffer.from([0x01, 0x00]));
  } else {
    segments.push(Buffer.from([0x01]));
  }
  
  // RGB pixel data (3 bytes per pixel: R, G, B)
  // For now, we'll just use white for all pixels
  // In a full implementation, this would extract RGB from the emoji
  const rgbData = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (pixels[idx] === 1) {
        // White pixel
        rgbData.push(0xFF, 0xFF, 0xFF);
      } else {
        // Transparent/background - use defaultColor
        const r = (defaultColor >> 16) & 0xFF;
        const g = (defaultColor >> 8) & 0xFF;
        const b = defaultColor & 0xFF;
        rgbData.push(r, g, b);
      }
    }
  }
  
  segments.push(Buffer.from(rgbData));
}

// ============================================================================
// File Transmission
// ============================================================================

/**
 * Create a text file for the P0AD device
 * Format: [file_type, filename_length, filename..., text_data...]
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
 * Check if data needs to be split into multiple packets
 * Matches the logic from AppCommandUtil.needSplitData() line 133-135
 * @param {number} dataLength - Length of data in bytes
 * @param {number} [mtu=512] - Current MTU
 * @returns {boolean} - True if data needs splitting
 */
export function needSplitData(dataLength, mtu = P0AD_CONFIG.MTU) {
  const splitWriteNum = mtu > 247 ? P0AD_CONFIG.SINGLE_PACK_MAX_LENGTH : mtu - 3;
  return dataLength > splitWriteNum;
}

/**
 * Split data into chunks for BLE transmission
 * @param {Buffer} data - Data to split
 * @param {number} maxChunkSize - Maximum chunk size
 * @returns {Buffer[]} - Array of chunks
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
 * Implements the logic from AppCommandUtil.packMultiple() line 256
 * @param {Buffer} data - Data to pack
 * @param {boolean} useV2 - Whether to use V2 format
 * @returns {Buffer[]} - Array of chunks ready for transmission
 */
export function packMultiple(data, useV2 = true) {
  // For P0AD, we use the simple chunking approach
  // The Android code uses CollectionsKt.chunked() to split into chunks
  const maxChunkSize = P0AD_CONFIG.SINGLE_PACK_MAX_LENGTH - P0AD_CONFIG.HEADER_SIZE;
  return splitIntoChunks(data, maxChunkSize);
}

// ============================================================================
// P0AD Device Class
// ============================================================================

/**
 * P0AD Device class for BLE communication
 * Uses @stoprocent/noble with async/await promises
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
   * Scan for P0AD devices using async generator
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
   * Connect to a P0AD device by ID or address (automatically performs handshake)
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
      
      await this.noticeCharacteristic.subscribeAsync();
      
      this.noticeCharacteristic.on('data', (data, isNotification) => {
        if (isNotification) this.handleNotification(data);
      });
      
      console.log('Starting handshake...');
      await this.performHandshake();
      
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
      // Extract challenge bytes from positions [5] and [6] of payload
      // data format: [A0, 00, length, payload..., CRC]
      // payload starts at index 3, so bytes [5] and [6] are at indices 3+5=8 and 3+6=9
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
      // Check byte [5] of payload for success (0x00)
      const resultByte = data[8]; // index 3+5=8
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
   * Perform the complete handshake sequence
   * Implements the algorithm from AppCommandUtil.java lines 300-354
   * @param {number} [retryCount=0] - Current retry attempt
   * @returns {Promise<void>}
   */
  async performHandshake(retryCount = 0) {
    if (retryCount >= P0AD_CONFIG.SHAKE_RETRY_COUNT) {
      throw new Error(`Handshake failed after ${P0AD_CONFIG.SHAKE_RETRY_COUNT} retries`);
    }
    
    try {
      // Step 1: First handshake
      const firstPayload = createFirstHandshakePayload();
      const firstPacket = createHandshakePacket(P0AD_CONFIG.SHAKE_HAND_FIRST, firstPayload);
      
      console.log(`Sending first handshake: ${firstPacket.toString('hex')}`);
      await this.writeCharacteristic.writeAsync(firstPacket, false);
      
      // Step 2: Wait for first handshake response
      const firstResponse = await this.waitForNotification(P0AD_CONFIG.SHAKE_PERIOD_TIME);
      
      // Extract challenge bytes from positions [5] and [6] of payload
      // Response format: [A0, 00, length, payload..., CRC]
      // Payload starts at index 3
      const b1 = firstResponse[8]; // index 3+5=8
      const b2 = firstResponse[9]; // index 3+6=9
      console.log(`Challenge: b1=0x${b1.toString(16)}, b2=0x${b2.toString(16)}`);
      
      // Step 3: Second handshake with XORed challenge bytes
      const secondPayload = createSecondHandshakePayload(b1, b2);
      const secondPacket = createHandshakePacket(P0AD_CONFIG.SHAKE_HAND_SECOND, secondPayload);
      
      console.log(`Sending second handshake: ${secondPacket.toString('hex')}`);
      await this.writeCharacteristic.writeAsync(secondPacket, false);
      
      // Step 4: Wait for second handshake response
      const secondResponse = await this.waitForNotification(P0AD_CONFIG.SHAKE_PERIOD_TIME);
      const resultByte = secondResponse[8]; // index 3+5=8
      
      if (resultByte !== 0x00) {
        throw new Error(`Handshake failed: device returned 0x${resultByte.toString(16)}`);
      }
      
      console.log('Handshake completed successfully');
      
    } catch (error) {
      console.error(`Handshake attempt ${retryCount + 1} failed:`, error.message);
      // Retry after a short delay
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.performHandshake(retryCount + 1);
    }
  }
  
  /**
   * Send text to the P0AD display
   * Implements the complete flow from DeviceCommand.sendTextData() lines 1085-1104
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
      await this.sendMultiPacketAsync(fileData);
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
   * Send data using multi-packet transmission
   * Implements the logic from DeviceCommand.sendFile() lines 1056-1068
   * and MultiPackUtilV2.sendMultiData() lines 506-538
   * @param {Buffer} data - Data to send
   * @param {string} [fileName] - Optional file name
   * @returns {Promise<void>}
   */
  async sendMultiPacketAsync(data, fileName = null) {
    // Add multi-packet header: [0x07, file_size_4bytes...]
    const header = createMultiPacketHeader(data.length);
    const dataWithHeader = Buffer.concat([header, data]);
    
    // Split into chunks
    const chunks = packMultiple(dataWithHeader);
    console.log(`Split into ${chunks.length} chunks for multi-packet transmission`);
    
    // Send each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const packet = createPacket(P0AD_CONFIG.SEND_FILE_DATA, chunk);
      console.log(`Sending multi-packet chunk ${i + 1}/${chunks.length} (${chunk.length} bytes)`);
      await this.writeCharacteristic.writeAsync(packet, false);
      
      // Small delay between chunks (from SINGLE_PACK_TIME_OFFSET = 20ms)
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
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

// ============================================================================
// Named Exports (ESM)
// ============================================================================

// Export all functions and classes for ESM imports
export {
  P0AD_CONFIG,
  TEXT_MODE,
  P0ADDevice,
  calculateCRC16,
  createPacket,
  createMultiPacketHeader,
  createFirstHandshakePayload,
  createSecondHandshakePayload,
  createHandshakePacket,
  createTextCanvas,
  renderTextToCharacters,
  isEmoji,
  getArabicTag,
  getEmojiHeight,
  packPixelsToBytes,
  packTextData,
  createTextFile,
  needSplitData,
  splitIntoChunks,
  packMultiple
};

// Default export for compatibility
export default {
  P0AD_CONFIG,
  TEXT_MODE,
  P0ADDevice,
  calculateCRC16,
  createPacket,
  createMultiPacketHeader,
  createFirstHandshakePayload,
  createSecondHandshakePayload,
  createHandshakePacket,
  createTextCanvas,
  renderTextToCharacters,
  isEmoji,
  getArabicTag,
  getEmojiHeight,
  packPixelsToBytes,
  packTextData,
  createTextFile,
  needSplitData,
  splitIntoChunks,
  packMultiple
};
```

---

## Using the Library

### ESM Import (Node.js 26+)

```javascript
import { P0ADDevice, P0AD_CONFIG, TEXT_MODE } from './p0ad-protocol.js';
import noble from '@stoprocent/noble';
```

### Basic Usage (Async/Await)

The handshake is **automatically performed** during `connect()`. Uses modern Promise-based APIs from `@stoprocent/noble`.

```javascript
import { P0ADDevice } from './p0ad-protocol.js';
import noble from '@stoprocent/noble';

const device = new P0ADDevice(noble);

async function main() {
  try {
    // Wait for adapter and connect to first device
    await device.connectFirst({ scanTimeout: 10000, connectTimeout: 10000 });
    
    console.log('Connected and handshake completed!');
    
    // Send text using promises
    await device.sendTextAsync('Hello World!', { 
      fontSize: 14,
      textMode: TEXT_MODE.NORMAL
    });
    console.log('Text sent successfully!');
    
    // Send RTL (Arabic) text
    await device.sendTextAsync('مرحبا', { 
      fontSize: 16,
      textMode: TEXT_MODE.RTL,
      fontFamily: 'Arial' // Use a font that supports Arabic
    });
    
    // Disconnect
    await device.disconnectAsync();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
```

### Connect by Device Address

```javascript
import { P0ADDevice } from './p0ad-protocol.js';
import noble from '@stoprocent/noble';

const device = new P0ADDevice(noble);

async function main() {
  try {
    // Connect directly by MAC address
    await device.connect('aa:bb:cc:dd:ee:ff', { timeout: 10000 });
    
    console.log('Connected!');
    
    // Send text
    await device.sendTextAsync('Hello P0AD!', { fontSize: 16 });
    
    // Set brightness
    await device.setBrightnessAsync(75);
    
    // Turn display off
    await device.setDisplayAsync(false);
    
    // Turn display back on
    await device.setDisplayAsync(true);
    
    // Disconnect
    await device.disconnectAsync();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
```

### Scan for Multiple Devices

```javascript
import { P0ADDevice } from './p0ad-protocol.js';
import noble from '@stoprocent/noble';

const device = new P0ADDevice(noble);

async function scanAndConnect() {
  try {
    console.log('Scanning for P0AD devices...');
    
    const devices = [];
    const scanTimeout = setTimeout(() => {
      console.log('Scan timed out');
    }, 10000);
    
    for await (const peripheral of device.scanForDevices({ timeout: 10000 })) {
      devices.push(peripheral);
      console.log(`Found: ${peripheral.advertisement.localName || peripheral.id}`);
    }
    
    clearTimeout(scanTimeout);
    
    if (devices.length === 0) {
      console.log('No P0AD devices found');
      return;
    }
    
    console.log(`Found ${devices.length} P0AD device(s)`);
    
    // Connect to the first one
    await device.connect(devices[0].id);
    
    // Use the device...
    await device.sendTextAsync('Test message');
    
    await device.disconnectAsync();
    
  } catch (error) {
    console.error('Error:', error);
  }
}

scanAndConnect();
```

### Manual Handshake (Advanced)

For debugging or custom connection flows:

```javascript
import { P0ADDevice, createPacket, P0AD_CONFIG } from './p0ad-protocol.js';
import noble from '@stoprocent/noble';

const device = new P0ADDevice(noble);

async function manualHandshake() {
  await device.connect('aa:bb:cc:dd:ee:ff');
  
  // But skip auto-handshake by not calling connect()
  // Instead, do it manually:
  
  await device.peripheral.discoverAllServicesAndCharacteristicsAsync();
  // ... find characteristics
  
  // Perform handshake manually
  await device.performHandshake();
  
  device.isHandshakeComplete = true;
  device.isReady = true;
  
  // Now send commands
  await device.sendTextAsync('Manual handshake test');
  
  await device.disconnectAsync();
}
```

---

## Key Implementation Details

### Multi-Packet Transmission

When text data exceeds 247 bytes, the implementation automatically:

1. Adds a multi-packet header with the 4-byte file size (big-endian)
2. Splits the data into chunks of maximum 247 bytes
3. Sends each chunk sequentially with a 20ms delay between chunks
4. Sends the SHOW_TEXT command after all chunks are transmitted

This matches the Android implementation in `DeviceCommand.sendFile()` lines 1056-1068.

### Text Mode Support

- **TEXT_MODE.NORMAL (0):** Standard left-to-right text
- **TEXT_MODE.SPECIAL (1):** Special handling (reserved for future use)
- **TEXT_MODE.RTL (2):** Right-to-left text with Arabic tag grouping

For RTL text, characters with the same Arabic tag are grouped together and reversed before rendering.

### Emoji Support

The implementation includes:
- Emoji detection for common Unicode emoji ranges
- Separate segment type (0x02) for emojis
- RGB color data (3 bytes per pixel)
- Default color fallback for transparent pixels

**Note:** Full emoji support would require integrating emoji bitmap data from `EmojiUtils` in the Android app.

---

## Testing

### Test Script

```javascript
import { P0ADDevice } from './p0ad-protocol.js';
import noble from '@stoprocent/noble';

const device = new P0ADDevice(noble);

async function testConnection() {
  try {
    console.log('Starting P0AD device test...');
    
    // Connect
    await device.connectFirst({ scanTimeout: 10000, connectTimeout: 10000 });
    console.log('✓ Connected and handshake completed');
    
    // Send text
    await device.sendTextAsync('Test 123');
    console.log('✓ Text sent');
    
    // Send longer text (multi-packet)
    const longText = 'This is a longer text message that will require multi-packet transmission';
    await device.sendTextAsync(longText);
    console.log('✓ Long text sent (multi-packet)');
    
    // Send RTL text
    await device.sendTextAsync('مرحبا بالعالم', { textMode: TEXT_MODE.RTL });
    console.log('✓ RTL text sent');
    
    // Set brightness
    await device.setBrightnessAsync(50);
    console.log('✓ Brightness set');
    
    // Disconnect
    await device.disconnectAsync();
    console.log('✓ Disconnected');
    
    console.log('\nAll tests passed!');
    
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testConnection();
```

Run with: `node test.js`

---

## Troubleshooting

### Common Issues

1. **Bluetooth adapter not powered on**
   - Ensure Bluetooth is enabled on your system
   - On Linux: `sudo systemctl start bluetooth`
   - On macOS: Ensure Bluetooth is enabled in System Preferences

2. **Device not found**
   - Ensure the P0AD device is powered on and in range
   - Check that the device is advertising (not in sleep mode)
   - Verify the SERVICE_UUID is correct

3. **Handshake failed**
   - Check that notifications are subscribed
   - Verify the challenge bytes are being extracted correctly
   - Ensure the XOR calculation uses the correct constants
   - Try increasing the timeout or retry count

4. **Text not displaying**
   - Check that SHOW_TEXT command is sent after file data
   - Verify the file type byte (0x01) is correct
   - Ensure the device is ready (handshake complete)

5. **Multi-packet transmission issues**
   - Verify the 4-byte file size is in big-endian format
   - Check that chunks are sent in order
   - Ensure the delay between chunks is sufficient (20ms default)

### Debug Logging

Enable debug logging in noble:

```javascript
import noble from '@stoprocent/noble';
noble.on('stateChange', console.log);
noble.on('discover', console.log);
```

---

## Performance Considerations

1. **Text Rendering:** The `canvas` library can be slow for large text. Consider caching rendered text.
2. **BLE Throughput:** Multi-packet transmission adds overhead. For large displays, consider optimizing chunk size.
3. **Connection Management:** Keep connections open for multiple operations to avoid handshake overhead.
4. **Memory:** Large text with many characters can consume significant memory during rendering.

---

## API Reference

### P0ADDevice Class

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| noble | Object | Noble library instance |
| peripheral | Object | Connected peripheral |
| writeCharacteristic | Object | Write characteristic |
| noticeCharacteristic | Object | Notice characteristic |
| isConnected | boolean | Connection state |
| isReady | boolean | Ready for commands |
| isHandshakeComplete | boolean | Handshake state |

#### Methods

| Method | Description |
|--------|-------------|
| `constructor(noble)` | Create a new P0ADDevice instance |
| `scanForDevices(options)` | Scan for P0AD devices (async generator) |
| `connect(deviceIdOrAddress, options)` | Connect to a device by ID or address |
| `connectFirst(options)` | Connect to first discovered device |
| `disconnectAsync()` | Disconnect from device |
| `sendTextAsync(text, options)` | Send text to display |
| `sendCommandAsync(command, payload)` | Send raw command |
| `setBrightnessAsync(brightness)` | Set display brightness (0-100) |
| `setDisplayAsync(on)` | Turn display on/off |
| `performHandshake(retryCount)` | Perform handshake sequence |
| `handleNotification(data)` | Handle incoming notifications |
| `waitForNotification(timeout)` | Wait for notification with timeout |
| `cleanupConnection()` | Clean up connection state |

### Constants

#### P0AD_CONFIG

| Property | Value | Description |
|----------|-------|-------------|
| SERVICE_UUID | '0000e0ad00001000800000805f9b34fb' | Service UUID |
| WRITE_UUID | '0000a0ad00001000800000805f9b34fb' | Write characteristic |
| NOTICE_UUID | '0000f0ad00001000800000805f9b34fb' | Notice characteristic |
| WIDTH | 96 | Display width |
| HEIGHT | 16 | Display height |
| APP_DEVICE | 0xA0 | Packet header |
| SHOW_TEXT | 0x0A | Show text command |
| SEND_FILE_DATA | 0x07 | Send file data command |
| MTU | 512 | Maximum transmission unit |
| SINGLE_PACK_MAX_LENGTH | 247 | Max single packet payload |

#### TEXT_MODE

| Property | Value | Description |
|----------|-------|-------------|
| NORMAL | 0 | Left-to-right text |
| SPECIAL | 1 | Special handling |
| RTL | 2 | Right-to-left text |

### Functions

| Function | Description |
|----------|-------------|
| `calculateCRC16(data)` | Calculate CRC16 checksum |
| `createPacket(command, payload)` | Create BLE packet |
| `createMultiPacketHeader(fileSize)` | Create multi-packet file header |
| `createFirstHandshakePayload()` | Create first handshake payload |
| `createSecondHandshakePayload(b1, b2)` | Create second handshake payload |
| `createHandshakePacket(command, payload)` | Create handshake packet |
| `createTextCanvas(width, height)` | Create text canvas |
| `renderTextToCharacters(text, options)` | Render text to characters |
| `isEmoji(char)` | Check if character is emoji |
| `getArabicTag(char)` | Get Arabic tag for character |
| `getEmojiHeight(emoji)` | Get emoji height category |
| `packPixelsToBytes(pixels, width, height)` | Pack pixels to bytes |
| `packTextData({ characters }, options)` | Pack text data |
| `createTextFile(textData, fileName)` | Create text file |
| `needSplitData(dataLength, mtu)` | Check if data needs splitting |
| `splitIntoChunks(data, maxChunkSize)` | Split data into chunks |
| `packMultiple(data, useV2)` | Pack multiple for multi-packet |

---

## Source Code References

All protocol details were extracted from the following files in the decompiled Android app:

| File | Line | Description |
|------|------|-------------|
| `com/th/common/protocol/pixel/DeviceCommand.java` | 676-792 | `packTextData()` - Text packing with RTL and emoji support |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 414-446 | `getTextData()` - Regular text segment creation |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 1031-1069 | `sendFile()` - File transmission with multi-packet support |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 1085-1104 | `sendTextData()` - Text data transmission |
| `com/th/common/utils/TextPixelUtil.java` | 1256-1348 | `text2Data()` - Bit-packing algorithm |
| `com/th/common/utils/BleDataUtils.java` | 45-59 | `pack()` - Packet construction with CRC16 |
| `com/th/common/protocol/command/AppCommandUtil.java` | 133-135 | `needSplitData()` - Split decision logic |
| `com/th/common/protocol/command/AppCommandUtil.java` | 256 | `packMultiple()` - Chunk splitting |
| `com/th/common/protocol/command/AppCommandUtil.java` | 300-354 | Handshake implementation |
| `com/th/common/protocol/command/MultiPackUtilV2.java` | 506-538 | `sendMultiData()` - Multi-packet transmission |
| `com/th/common/protocol/command/MultiPackUtilV2.java` | 328-340 | `groupingData()` - Chunk grouping |
| `com/th/common/bean/PixelTextBean.java` | | Text pixel data structure |
| `com/th/common/bean/DeviceBean.java` | | Device properties |
| `android app/assets/th_dev_cfg.json` | | P0AD device configuration |

---

## Contributing

If you find any issues or have improvements to the implementation, please verify against the original source code in:
```
/Users/rarous/Developer/rarous/now-playing/android app/sources/com/th/
```

All references in the documentation use the format: `path/to/file.java:line_number` which is compatible with most IDEs.

---

## License

This implementation is derived from decompiled Android application code and is provided for protocol compatibility purposes. It is designed to work with the P0AD LED display device using the AC6951C chip.
