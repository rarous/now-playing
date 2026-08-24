# P0AD Device Binary Protocol Specification

## Overview

This document provides detailed binary format specifications for the P0AD LED display device protocol, extracted from the PixelJoy Android application source code. It includes the complete file format, multi-packet transmission details, and exact binary structures.

## Device Identification

From `android app/assets/th_dev_cfg.json`:

```json
{
  "deviceId": 22,
  "deviceSize": 1,
  "deviceSizeName": "96*16",
  "deviceSizeHeight": "16",
  "deviceSizeWidth": "96",
  "deviceScanning": "C0AD",
  "deviceUuid": "E0AD",
  "deviceWrite": "A0AD",
  "deviceNotice": "F0AD",
  "deviceChip": "AC6951C",
  "deviceMoldPid": "P0AD",
  "deviceMoldNumber": "D53601"
}
```

**Source:** `android app/assets/th_dev_cfg.json`

## BLE Service and Characteristic UUIDs

**Note:** The UUIDs shown (C0AD, E0AD, A0AD, F0AD) are 16-bit UUIDs. In BLE, these are typically part of a 128-bit UUID. The full UUID format is usually:
- `0000XXXX-0000-1000-8000-00805F9B34FB` where XXXX is the 16-bit value

So for P0AD:
- **Service UUID (128-bit):** `0000E0AD-0000-1000-8000-00805F9B34FB`
- **Write Characteristic UUID:** `0000A0AD-0000-1000-8000-00805F9B34FB`
- **Notice Characteristic UUID:** `0000F0AD-0000-1000-8000-00805F9B34FB`
- **Scanning UUID:** `0000C0AD-0000-1000-8000-00805F9B34FB`

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:88-110`

## Packet Structure

### Standard Packet Format

All commands follow the format defined in `BleDataUtils.pack()`:

```
Byte 0:  Header (APP_DEVICE = 0xA0 = -96)
Byte 1:  Command Code
Byte 2:  Data Length (N + 3)
Bytes 3..N+2:  Payload Data (N bytes)
Bytes N+3..N+4:  CRC16 Checksum (big-endian)
```

**Total Length:** 6 + N bytes

**Maximum Single Packet:** 247 bytes payload (SINGLE_PACK_MAX_LENGTH from `AppCommandUtil.java:43`)

**Source:** `com/th/common/utils/BleDataUtils.java:45-59`

### CRC16 Algorithm

The CRC16 checksum is calculated using the standard CRC-16/CCITT algorithm (polynomial 0x1021, initial value 0xFFFF, no reflection).

**Calculation:** CRC is computed over bytes [0..N+2] (header + command + length + payload)

**Implementation Reference:** `com/th/common/utils/n.java` (method `m()` or `c()`)

**Node.js Implementation:**
```javascript
function crc16(data) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;
  
  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    
    for (let j = 0; j < 8; j++) {
      const bit = (byte ^ crc) & 1;
      crc >>= 1;
      if (bit) {
        crc ^= (polynomial << 8);
      }
      byte >>= 1;
    }
  }
  
  return Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]);
}
```

## Command Codes

From `DeviceCommand.java`:

```java
// Display Commands
SHOW_TEXT        = 0x0A (10)
SHOW_IMG         = 0x0B (11)
SHOW_GIF        = 0x0C (12)
SHOW_CLOCK      = 0x0D (13)
SECOND           = 0x0E (14)
PLAY_CAROUSEL   = 0x0F (15)

// File Operations
SEND_FILE_DATA  = 0x07 (7)
ASK_FILE_EXIST  = 0x09 (9)
DELETE_FILE     = 0x08 (8)
READ_CAROUSEL_LIST = 0x1F (31)

// Drawing
DRAW_PIXEL      = 0x04 (4)
PAINT_BUCKET   = 0x03 (3)
CLEAR_DRAWING_BOARD = 0x02 (2)

// Configuration
SEND_BRIGHTNESS = 0x13 (19)
SWITCH_LIGHT    = 0x11 (17)
READ_PROPERTY   = 0x10 (16)
SET_FLIP        = 0x15 (21)
SET_TIMER_SWITCH = 0x34 (52)
TIMER           = 0x35 (53)
DELETE_TIMER   = 0x33 (51)
COUNTDOWN       = 0x36 (54)

// Device Control
CHECK_DEVICE_PWD = 0x82 (-126)
RESET_DEVICE     = 0x8E (-114)
SET_TIME_ZONE    = 0x8F (-113)
SET_DEVICE_LOCK  = 0x44 (68)
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:88-110`

## Protocol Constants

From `AppCommandUtil.java`:

```java
APP_DEVICE                = -96   // 0xA0
APP_DEVICE_MULTIPLE      = -94   // 0xFE
DEVICE_APP               = -95   // 0xFF (used in responses?)
DEVICE_MULTIPLE_REPLY    = -93   // 0xFD
DEVICE_MULTIPLE_REPLY_V2 = -92   // 0xFC

MTU_VALUE                 = 512   // Default MTU
SINGLE_PACK_MAX_LENGTH   = 247   // Max payload for single packet

// File types
USER_FILE_TYPE_TXT       = 1     // Text files
USER_FILE_TYPE_IMG       = 2     // Image files
USER_FILE_TYPE_DYN       = 3     // Dynamic/Animation files

// Handshake
SHAKE_HAND_FIRST         = 0     // 0x00
SHAKE_HAND_SECOND        = 1     // 0x01
```

From `DeviceCommand.java` (Handshake constants):

```java
SET_REMOTE                 = 72    // 0x48 ('H')
READ_REMOTE                = 73    // 0x49 ('I')
SET_PARTITION              = 36    // 0x24
READ_COMMUNICATION_VERSION = 76   // 0x4C ('L')
```

**Source:** `com/th/common/protocol/command/AppCommandUtil.java:29-47`, `com/th/common/protocol/pixel/DeviceCommand.java:72-110`

## Text File Format

### File Type Identifiers

```java
USER_FILE_TYPE_TXT = 1
USER_FILE_TYPE_IMG = 2
USER_FILE_TYPE_DYN = 3
```

**Source:** `com/th/common/protocol/command/AppCommandUtil.java:44-46`

### Complete Text File Structure

When text is sent via `sendFile()` in `DeviceCommand.java:1031-1069`, the file has this structure:

```
┌─────────────────────────────────────────────────────────────────┐
│ TEXT FILE FORMAT                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐                                               │
│  │ File Header │  1 + N bytes                                  │
│  ├─────────────┤    where N = filename length                 │
│  │ Byte 0: 0x01│  File type (TEXT)                            │
│  │ Byte 1: N   │  Filename length (1 byte)                   │
│  │ Bytes 2..N+1│ Filename (UTF-8 encoded)                    │
│  └─────────────┘                                               │
│                                                                 │
│  ┌─────────────┐                                               │
│  │ Text Data   │  Variable length                             │
│  ├─────────────┤                                               │
│  │  ┌───────┐  │                                               │
│  │  │Seg 1 │  │  [0x01, width, height, color_mode, pixels]  │
│  │  └───────┘  │    Regular text segment                      │
│  │  ┌───────┐  │                                               │
│  │  │Seg 2 │  │  [0x02, width, height, color_mode, RGB...] │
│  │  └───────┘  │    Emoji segment                             │
│  │  ...     │    More segments                              │
│  └─────────────┘                                               │
│                                                                 │
│  ┌─────────────┐                                               │
│  │ Footer      │  Optional display parameters                │
│  └─────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### File Header Format

```
Byte 0:     0x01 (File type: TEXT)
Byte 1:     filename_length (1 byte, 0-255)
Bytes 2..N: filename (UTF-8 encoded, N = filename_length bytes)
```

**Note:** The filename is typically a timestamp-based string, e.g., "txt123456" generated by `createUserFileName()` in `AppCommandUtil.java:96-100`

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:1031-1041`

## Text Segment Format (packTextData output)

The `packTextData()` method in `DeviceCommand.java:676-792` produces the text data portion of the file.

### Segment Type Bytes

```
0x01 = Regular text character (single color per character)
0x02 = Emoji character (RGB color per pixel)
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:695, 743`

### Regular Text Segment Format

For each regular text character (type 0x01):

```
Byte 0:     0x01                 (Type: Regular text)
Byte 1:     width & 0xFF         (Character width in pixels, 1 byte)
Byte 2:     height & 0xFF        (Character height in pixels, 1 byte)
Byte 3:     color_mode           (1 byte)
            = 0x01 if support600Txt=false
            = 0x01 0x00 if support600Txt=true
Byte 4+:    pixel_data           (Bit-packed monochrome, see below)
```

**Color Mode Details:**
- **Non-600Txt mode (support600Txt=false):** Single byte 0x01
- **600Txt mode (support600Txt=true):** Two bytes [0x01, 0x00]

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:414-423, 698-703`

### Emoji Segment Format

For each emoji (type 0x02):

```
Byte 0:     0x02                 (Type: Emoji)
Byte 1:     width & 0xFF         (Emoji width in pixels, 1 byte)
Byte 2:     height & 0xFF        (Emoji height in pixels, 1 byte)
Byte 3:     color_mode           (1 byte)
            = 0x01 if support600Txt=false
            = 0x01 0x00 if support600Txt=true
Byte 4+:    RGB_pixel_data       (3 bytes per pixel: R, G, B in order)
```

**Color Mode Details:**
- **Non-600Txt mode (support600Txt=false):** Single byte 0x01
- **600Txt mode (support600Txt=true):** Two bytes [0x01, 0x00]

**Emoji Height Categories:**
Emojis are organized by height with separate lookup maps in `EmojiUtils`:
- 12px: `EmojiUtils.INSTANCE.getEmoji12ByteMap()`
- 14px: `EmojiUtils.INSTANCE.getEmoji14ByteMap()`
- 16px: `EmojiUtils.INSTANCE.getEmoji16ByteMap()`
- 24px: `EmojiUtils.INSTANCE.getEmoji24ByteMap()`
- 30px: `EmojiUtils.INSTANCE.getEmoji30ByteMap()`
- 32px: `EmojiUtils.INSTANCE.getEmoji32ByteMap()`

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:705-706, 716-720`

### Emoji Color Handling

When processing emoji pixel data (lines 707-736):

```
For each pixel in emoji bitmap:
1. Get color value from emoji map
2. If textMode == 0:
      Use color as-is
   Else if pixel alpha == 0 (transparent):
      Use defaultColor parameter
   Else:
      Use pixel color
3. Extract RGB components: Color.red(i8), Color.green(i8), Color.blue(i8)
4. Append to output: [R_byte, G_byte, B_byte]
```

**Note:** The alpha channel is ignored for regular text. For emojis, transparency uses the defaultColor.

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:727-736`

## Pixel Data Encoding (text2Data)

The `TextPixelUtil.text2Data()` method (line 1256-1348) converts pixel lattice to binary:

**Input:** `ArrayList<List<Integer>> lattice` where each inner list contains [x, y, color, enabled]
- x: column index (0 to width-1)
- y: row index (0 to height-1)
- color: pixel color value
- enabled: 0 or 1 (1 = pixel is on/foreground)

**Output:** `List<Byte>` - Bit-packed pixel data

**Algorithm:**

```
For each row y from 0 to (height - 1):
    // First 8 columns (0-7)
    Create byte0 = 0
    For x from 0 to min(7, width - 1):
        index = (y * width) + x
        if lattice[index][3] == 1:  // Pixel is enabled
            byte0 |= (1 << x)
    Add byte0 to output
    
    // Second 8 columns (8-15) - if width > 8
    if width > 8:
        Create byte1 = 0
        For x from 8 to min(15, width - 1):
            index = (y * width) + x
            if lattice[index][3] == 1:
                byte1 |= (1 << (x - 8))
        Add byte1 to output
    
    // Third 8 columns (16-23) - if width > 16
    if width > 16:
        Create byte2 = 0
        For x from 16 to min(23, width - 1):
            index = (y * width) + x
            if lattice[index][3] == 1:
                byte2 |= (1 << (x - 16))
        Add byte2 to output
    
    // Fourth 8 columns (24-31) - if width > 24
    if width > 24:
        Create byte3 = 0
        For x from 24 to min(31, width - 1):
            index = (y * width) + x
            if lattice[index][3] == 1:
                byte3 |= (1 << (x - 24))
        Add byte3 to output
```

**Bit Order:** Little-endian within byte (bit 0 = LSB = leftmost pixel in the 8-pixel group)

**Example:** For a 16-pixel wide character row:
```
Pixels: [1, 0, 1, 1, 0, 0, 1, 0,  0, 1, 1, 0, 1, 0, 1, 1]
                 ↓ first 8      ↓ second 8
Byte 0: 0b01100101 = 0x65  (bits: 0=1, 1=0, 2=1, 3=1, 4=0, 5=0, 6=1, 7=0)
Byte 1: 0b11010110 = 0xD6  (bits: 0=0, 1=1, 2=1, 3=0, 4=1, 5=0, 6=1, 7=1)
```

**Source:** `com/th/common/utils/TextPixelUtil.java:1256-1348`

## Color Data Format

### Single Color Mode

- All pixels in the character use the same color
- Color is specified in the segment header or as default
- Format: ARGB, but alpha is typically ignored
- For regular text: single color for all pixels in the character

### RGB Color Mode (for emojis)

- Each pixel has its own RGB color
- Format: 3 bytes per pixel (R, G, B)
- Order: Row-major, left-to-right, top-to-bottom
- Total size: width × height × 3 bytes

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:727-736`

## Text Mode Handling

The `textMode` parameter in `packTextData()` affects how text is laid out:

```java
packTextData(support600Txt, beans, textMode, defaultColor)
```

**Mode Values:**
- **0 (Normal):** Standard LTR (Left-to-Right) - No special handling
- **1 (Special):** Special mode - Exact behavior not fully documented, likely for mixed LTR/RTL
- **2 (RTL/Reverse):** For Arabic, Hebrew, and other RTL languages - Reverses character order

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:676`

### Arabic Tag Grouping (RTL Text)

For RTL text (textMode = 2), characters are grouped by `arabicTag`:

1. **Character Grouping:** Characters with the same `arabicTag` value are grouped together
2. **Group Reversal:** Before rendering, each group is reversed using `CollectionsKt.reverse(list)`
3. **Processing Order:** Groups are processed in their original order

**Implementation in packTextData() (lines 686-688, 747-748, 764-766, 782-783):**
```java
if (i == 2) {  // textMode == 2
    CollectionsKt.reverse(list3);  // Reverse the character group
}
```

**Algorithm:**
```
1. Initialize empty output list and linkedHashMap for grouping
2. Initialize j2 = 0 (tracking current arabicTag)
3. For each PixelTextBean:
   a. If arabicTag == 0 (LTR):
        - Flush any pending grouped text (with reversal if mode=2)
        - Add character immediately via getTextData()
   b. If arabicTag > 0 (RTL):
        - If arabicTag == j2 (same group):
            * Add to current group in linkedHashMap
        - Else (new group):
            * Flush previous group (with reversal if mode=2)
            * Start new group with current arabicTag
            * Update j2 = current arabicTag
4. After loop: Flush any remaining groups
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:676-792`

## Complete Text Transmission Flow

### Step 1: Text to Pixel Conversion

```
Input: String text, font parameters
Output: List<PixelTextBean>

Process:
1. Split text into characters (including emoji detection)
2. For each character:
   a. Render to bitmap using specified font
   b. Extract pixel data (which pixels are on)
   c. Apply color
   d. Create PixelTextBean with:
      - width, height
      - pixelData (2D array of ARGB values)
      - isEmoji flag
      - emojiCode (if emoji)
      - arabicTag (for RTL characters, 0 for LTR)
```

### Step 2: Pixel to Binary Packing (packTextData)

```
Input: List<PixelTextBean>, support600Txt, textMode, defaultColor
Output: List<Byte> (binary text data)

Process:
1. Initialize empty output list
2. Create linkedHashMap for arabicTag grouping
3. For each PixelTextBean:
   a. If emoji:
        - Flush any pending regular text groups
        - Add type byte: 0x02
        - Add width, height
        - Add color mode (0x01 or 0x01 0x00 for 600Txt)
        - Lookup emoji bitmap from EmojiUtils
        - For each pixel: extract RGB, apply defaultColor if transparent
        - Add RGB bytes to output
   b. If regular text:
        - Handle arabicTag grouping
        - Add to current group or flush previous
   c. After emoji or group change: flush pending groups
4. Flush any remaining groups
5. Return output list
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:676-792`

### Step 3: File Packaging (sendFile)

```
Input: String mac, String fileName, List<Byte> fileData
Output: BLE write operations

Process (DeviceCommand.java:1031-1069):
1. Create arrayList for file packet
2. Add filename length byte (1 byte)
3. Add filename bytes (UTF-8)
4. Add fileData (text data from packTextData)
5. Check if splitting needed:
      if (AppCommandUtil.INSTANCE.needSplitData(arrayList.size())) {
          // Multi-packet transmission needed
          Add SEND_FILE_DATA command byte (0x07) at position 0
          Add 4-byte file size (big-endian) at positions 1-4
          Split into chunks using packMultiple()
          Send via sendMultiDataV2()
      } else {
          // Single packet transmission
          Send directly via BleConnectUtil.writeCmd()
      }
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:1031-1069`

### Step 4: Multi-Packet Transmission

When data > SINGLE_PACK_MAX_LENGTH (247 bytes):

```
1. Determine if splitting needed (needSplitData):
      BleManager.getInstance().getSplitWriteNum() > 247
          ? i > 247
          : i > BleManager.getInstance().getSplitWriteNum()

2. Add multi-packet header:
      Byte 0:  0x07 (SEND_FILE_DATA command)
      Bytes 1-4: File size (4 bytes, big-endian)

3. Split into chunks (packMultiple):
      Input: List<Byte> data
      Output: List<List<Byte>> chunks
      
4. Send via MultiPackUtilV2.sendMultiData():
      - Reset state
      - Store command list
      - Set pack unit from device packV2Num
      - Call groupingData()
```

**groupingData() (MultiPackUtilV2.java:328-340):**
```
1. Clear existing groups
2. Split commandList into groups of mPackUnit size:
      CollectionsKt.chunked(commandList, mPackUnit, ...)
3. Set totalGroup = groupList.size()
4. Call notifySend() to start transmission
```

**MultiPackUtilV2 Constants:**
- `SINGLE_PACK_TIME_OFFSET = 20` ms
- `TIMEOUT = 10000` ms (10 seconds)
- `RETRY_COUNT = 3` (from SHAKE_RETRY_COUNT in AppCommandUtil.java:42)

**Source:** `com/th/common/protocol/command/AppCommandUtil.java:133-135, 256`, `com/th/common/protocol/command/MultiPackUtilV2.java:328-340, 506-538`

### Step 5: Packet Construction (BleDataUtils.pack)

```
Input: byte command, byte[] data
Output: byte[] BLE packet

Process (BleDataUtils.java:45-59):
1. Create ArrayList
2. Add APP_DEVICE header (0xA0)
3. Add command code
4. Add length byte (data.length + 3)
5. Add data bytes
6. Calculate CRC16 over [header, command, length, data]
7. Append CRC16 (2 bytes, big-endian)
8. Convert to byte array and return
```

**Source:** `com/th/common/utils/BleDataUtils.java:45-59`

### Step 6: Display the Text (SHOW_TEXT)

After sending the file data, send the SHOW_TEXT command:

```
Command: 0x0A (SHOW_TEXT)
Payload: [0x01] (file type: TEXT)
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:1085-1104`

## Multi-Packet Header Format

When data needs to be split (data.size() > max single packet):

```
┌─────────────────────────────────────────┐
│ MULTI-PACKET FILE HEADER                  │
├─────────────────────────────────────────┤
│ Byte 0:  0x07                            │  // SEND_FILE_DATA command
│ Bytes 1-4: File size (big-endian)       │  // Total file size (4 bytes)
│ Bytes 5+: Actual file data               │  // Text file data
└─────────────────────────────────────────┘
```

The file size is calculated using `n.m()` (getintToByte) which converts an integer to 4-byte big-endian:

```java
byte[] bArrN = n.m(arrayList.size());  // 4 bytes, big-endian
arrayList.add(1, Byte.valueOf(bArrN[3]));  // MSB at position 1
arrayList.add(2, Byte.valueOf(bArrN[2]));
arrayList.add(3, Byte.valueOf(bArrN[1]));
arrayList.add(4, Byte.valueOf(bArrN[0]));  // LSB at position 4
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:1056-1062`

## Device-Specific Features

### P0AD Capabilities

From `DeviceBean.java` defaults (line 81-82):
- **Width:** 96 pixels
- **Height:** 16 pixels
- **Default Brightness:** 50 (0-100 scale)
- **packV2Num:** 1 (default pack unit for multi-packet)

From device configuration:
- **deviceMoreType:** 2 (enhanced features)
- **deviceDualChips:** 1 (dual chip architecture)
- **deviceFunctionList:** [] (no special function restrictions)

**Source:** `com/th/common/bean/DeviceBean.java:72-92`, `android app/assets/th_dev_cfg.json`

### Supported Features

- **Text rendering:** Single and multi-color text
- **Emoji support:** 6 height categories (12, 14, 16, 24, 30, 32px)
- **RTL text:** Arabic, Hebrew, Persian, Urdu (textMode=2)
- **Multi-packet transmission:** Automatic for data > 247 bytes
- **CRC16 checksum:** Data integrity verification
- **Challenge-response handshake:** Required before commands

## Binary Examples

### Example 1: Single Character "A" Segment

Assuming:
- Width: 8 pixels
- Height: 16 pixels
- Color: White (single color mode)
- Pixel pattern: Simple 8-pixel wide A

```
Segment Header:
  0x01        - Type: Regular text
  0x08        - Width: 8
  0x10        - Height: 16
  0x01        - Color mode: single color

Pixel Data (16 rows × 1 byte each, since width = 8):
  Row 0:  0x1E   - 00011110b
  Row 1:  0x22   - 00100010b
  Row 2:  0x22   - 00100010b
  Row 3:  0x3E   - 00111110b
  Row 4:  0x22   - 00100010b
  Row 5:  0x22   - 00100010b
  Row 6:  0x22   - 00100010b
  Row 7:  0x22   - 00100010b
  Row 8:  0x22   - 00100010b
  Row 9:  0x22   - 00100010b
  Row 10: 0x22   - 00100010b
  Row 11: 0x22   - 00100010b
  Row 12: 0x22   - 00100010b
  Row 13: 0x22   - 00100010b
  Row 14: 0x00   - 00000000b
  Row 15: 0x00   - 00000000b

Total: 1 + 3 + 16 = 20 bytes for this segment
```

### Example 2: Complete Text File for "Hi"

```
File Header:
  0x01           - File type: TEXT
  0x04           - Filename length: 4
  0x74 0x78 0x74 0x31  - "txt1" (filename)

Segment 1 ('H'):
  0x01           - Type: Regular text
  0x08           - Width: 8
  0x10           - Height: 16
  0x01           - Color mode
  [16 bytes of pixel data for 'H']

Segment 2 ('i'):
  0x01           - Type: Regular text
  0x04           - Width: 4
  0x10           - Height: 16
  0x01           - Color mode
  [16 bytes of pixel data for 'i']

Total file size: 1 + 1 + 4 + (4+16) + (4+16) = 46 bytes
```

### Example 3: Complete BLE Packet for Small Text

If total file size = 50 bytes (fits in single packet):

```
Header:
  0xA0           - APP_DEVICE
  0x07           - SEND_FILE_DATA command
  0x35           - Length: 50 + 3 = 53 (0x35)

Payload:
  0x01           - File type: TEXT
  0x04           - Filename length
  0x74 0x78 0x74 0x31  - "txt1"
  [Text segments... 46 bytes]

CRC:
  0xXXXX 0xXXXX   - CRC16 checksum (2 bytes, big-endian)

Total: 3 + 50 + 2 = 55 bytes
```

### Example 4: Multi-Packet Transmission

If total file size = 300 bytes (needs splitting):

**First, add multi-packet header to file data:**
```
Byte 0:  0x07              - SEND_FILE_DATA command
Bytes 1-4: 0x00 0x00 0x01 0x2C  - File size: 300 (0x012C, big-endian)
Bytes 5-304: File data (300 bytes)

Total: 305 bytes
```

**Then split into chunks of max 247 bytes:**
```
Chunk 1 (247 bytes):
  - Bytes 0-246 of the 305-byte data
  - Wrapped in BLE packet: 0xA0 + 0x07 + 0xFB (247+3) + data + CRC

Chunk 2 (58 bytes):
  - Bytes 247-304 of the 305-byte data
  - Wrapped in BLE packet: 0xA0 + 0x07 + 0x3D (58+3) + data + CRC
```

**After all chunks sent, send SHOW_TEXT:**
```
Packet: 0xA0 + 0x0A + 0x04 (1+3) + [0x01] + CRC
```

## Implementation Notes for Node.js

### Required Libraries

```bash
npm install @stoprocent/noble
npm install canvas  # For text rendering
```

### Key Considerations

1. **ESM Modules:** Use `import` syntax for Node.js 26+
2. **Async/Await:** All BLE operations should be async
3. **Buffer Handling:** Use Node.js Buffer for binary data
4. **Text Rendering:** Use `canvas` library to render text to bitmap
5. **Bit Packing:** Implement the text2Data algorithm precisely
6. **Multi-Packet:** Handle data > 247 bytes with proper headers

### Text Rendering Implementation

```javascript
import { createCanvas } from 'canvas';

function renderTextToPixels(text, fontSize = 16, fontFamily = 'Arial') {
  const canvas = createCanvas(96, 16);
  const ctx = canvas.getContext('2d');
  
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = [];
  
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4;
      const isText = imageData.data[idx] > 128 && 
                     imageData.data[idx + 1] > 128 && 
                     imageData.data[idx + 2] > 128;
      pixels.push(isText ? 1 : 0);
    }
  }
  
  return { width: canvas.width, height: canvas.height, pixels };
}
```

### Bit Packing Implementation

```javascript
function packBits(pixels, width, height) {
  const result = [];
  
  for (let y = 0; y < height; y++) {
    for (let xGroup = 0; xGroup < width; xGroup += 8) {
      let byte = 0;
      const xEnd = Math.min(xGroup + 8, width);
      
      for (let x = xGroup; x < xEnd; x++) {
        const idx = y * width + x;
        if (pixels[idx]) {
          byte |= (1 << (x - xGroup));
        }
      }
      result.push(byte);
    }
  }
  
  return Buffer.from(result);
}
```

### Complete Packet Construction

```javascript
function createBlePacket(command, payload) {
  const header = Buffer.from([0xA0, command, payload.length + 3]);
  const packet = Buffer.concat([header, payload]);
  const checksum = crc16(packet);
  return Buffer.concat([packet, checksum]);
}
```

## References to Source Code

All references use the format: `path/to/file.java:line_number`

### Core Protocol Files

| File | Line | Description |
|------|------|-------------|
| `com/th/common/protocol/pixel/DeviceCommand.java` | 676-792 | `packTextData()` - Main text packing method |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 414-446 | `getTextData()` - Regular text segment creation |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 1031-1069 | `sendFile()` - File transmission with splitting |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 1085-1104 | `sendTextData()` - Text data transmission |
| `com/th/common/utils/TextPixelUtil.java` | 1256-1348 | `text2Data()` - Bit-packing algorithm |
| `com/th/common/utils/BleDataUtils.java` | 45-59 | `pack()` - Packet construction with CRC16 |
| `com/th/common/protocol/command/AppCommandUtil.java` | 133-135 | `needSplitData()` - Split decision logic |
| `com/th/common/protocol/command/AppCommandUtil.java` | 256 | `packMultiple()` - Chunk splitting method |
| `com/th/common/protocol/command/MultiPackUtilV2.java` | 506-538 | `sendMultiData()` - Multi-packet transmission |
| `com/th/common/protocol/command/MultiPackUtilV2.java` | 328-340 | `groupingData()` - Chunk grouping algorithm |

### Device Configuration Files

| File | Line | Description |
|------|------|-------------|
| `android app/assets/th_dev_cfg.json` | | P0AD device definition (Device ID 22) |
| `android app/assets/deviceSize.json` | | Device size definitions |

### Supporting Files

| File | Description |
|------|-------------|
| `com/th/common/bean/PixelTextBean.java` | Text pixel data structure |
| `com/th/common/bean/DeviceBean.java` | Device properties and configuration |
| `com/th/common/utils/EmojiUtils.java` | Emoji handling and lookup maps |
| `com/th/common/utils/n.java` | Utility functions (CRC, byte conversion) |
