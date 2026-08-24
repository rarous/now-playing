# P0AD Device Text Rendering Protocol Documentation

## Overview

This document describes the text rendering protocol for the P0AD LED display device (96x16 pixels, AC6951C chip) as implemented in the PixelJoy Android application.

**Device Configuration:**
- **Device ID:** 22
- **Device Name:** P0AD_XXX
- **Display Size:** 96 x 16 pixels
- **Chip:** AC6951C
- **BLE UUIDs:**
  - Scanning Service: `C0AD`
  - Device Service UUID: `E0AD`
  - Write Characteristic: `A0AD`
  - Notice Characteristic: `F0AD`
- **Mold PID:** P0AD
- **Mold Number:** D53601

## Protocol Stack

The communication protocol consists of multiple layers:

```
Application Layer (DeviceCommand)
    ↓
Protocol Layer (PixelProtocol)
    ↓
Transport Layer (BleDataUtils)
    ↓
BLE Physical Layer
```

## Command Structure

### Packet Format

All BLE packets follow a standard format defined in `BleDataUtils.pack()`:

```
Offset  | Size (bytes) | Description
--------|-------------|-------------
0      | 1           | Header: APP_DEVICE (0xA0 = -96 decimal)
1      | 1           | Command Type
2      | 1           | Data Length (N+3)
3..N+2| N           | Payload Data
N+3    | 2           | CRC16 Checksum (big-endian)
```

**Total Packet Size:** 6 + N bytes

### CRC16 Calculation

The CRC16 checksum is calculated over bytes [0..N+2] (header + command + length + payload) and appended as 2 bytes in big-endian format.

## Text Rendering Pipeline

The complete text rendering and transmission process:

```
1. Text Input (String with possible emojis)
   ↓
2. Text Layout & Character Splitting
   - Split text into individual characters and emojis
   - Create PixelTextBean for each character/emoji
   - Group characters by arabicTag for RTL handling
   ↓
3. Pixel Data Generation (TextPixelUtil.text2Data)
   - Render each character to pixel grid
   - Extract foreground pixels
   - Apply color information
   ↓
4. Binary Packing (DeviceCommand.packTextData)
   - Pack each PixelTextBean into binary format
   - Handle RTL reversal (textMode=2)
   - Handle emoji separately (type=0x02)
   - Handle support600Txt flag
   ↓
5. File Packaging (DeviceCommand.sendFile)
   - Add file header (type, filename length, filename)
   - Check if data needs splitting (needSplitData)
   - If data > MTU: split into chunks (packMultiple)
   ↓
6. Multi-Packet Transmission (MultiPackUtilV2.sendMultiData)
   - Send chunks sequentially with grouping
   - Handle retries and timeouts
   ↓
7. Display Command (SHOW_TEXT = 0x0A)
   - Send command to display the transmitted file
```

## Text Data Structures

### PixelTextBean

The fundamental text element structure from `com/th/common/bean/PixelTextBean.java`:

```java
// Key properties used in text rendering:
- int width          // Character width in pixels
- int height         // Character height in pixels
- int[][] pixelData  // 2D array of pixel values (0 = off, non-zero = on with color)
- boolean isEmoji    // Flag indicating this is an emoji
- String emojiCode   // Emoji identifier (for emoji lookups)
- long arabicTag     // Group tag for RTL/Arabic text (0 = no tag = LTR)
```

**Source:** `com/th/common/bean/PixelTextBean.java`

### Text Segment Types

| Type Byte | Description | Height Categories |
|-----------|-------------|-------------------|
| 0x01 | Regular text (single color) | Any |
| 0x02 | Emoji (RGB color per pixel) | 12, 14, 16, 24, 30, 32 |

## Text Packing Format (packTextData)

The `packTextData()` method in `DeviceCommand.java:676-792` converts a list of `PixelTextBean` objects into binary data.

### Input Parameters

```java
packTextData(
    boolean support600Txt,      // Device supports extended text format
    List<? extends PixelTextBean> beans,  // List of text elements to render
    int textMode,                // Text rendering mode (0, 1, or 2)
    int defaultColor             // Default text color (ARGB format)
)
```

**Text Mode Values:**
- **0 (Normal):** Standard left-to-right text rendering
- **1 (Special):** Modified text rendering with special handling
- **2 (Reverse/RTL):** For Arabic, Hebrew, and other RTL languages

### Packing Algorithm

The algorithm processes the list of PixelTextBean objects with the following logic:

```
1. Initialize empty output list and arabicTag grouping map
2. For each PixelTextBean in the list:
   a. If it's an emoji:
      - Flush any pending grouped regular text (with RTL reversal if mode=2)
      - Add emoji segment [0x02, width, height, color_mode, RGB_pixel_data...]
      - Lookup emoji bitmap from EmojiUtils based on height category
      - Apply defaultColor to transparent pixels if needed
      
   b. If it's regular text:
      - If arabicTag == 0 (LTR character):
        * Flush any pending grouped text
        * Add character segment immediately
        
      - If arabicTag > 0 (RTL character):
        * Add to grouping map under arabicTag key
        * If arabicTag changes from previous:
          - Flush previous group (with RTL reversal if mode=2)
          - Start new group with current arabicTag
3. After loop: Flush any remaining grouped text
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:676-792`

### RTL (Right-to-Left) Text Handling

For Arabic, Hebrew, and other RTL languages (textMode = 2):

1. **Character Grouping:** Characters with the same `arabicTag` value are grouped together
2. **Group Reversal:** Before rendering, each group is reversed using `CollectionsKt.reverse(list)`
3. **Processing Order:** Groups are processed in their original order, but characters within each group are reversed

**Example:** Arabic text "سلام" (4 characters with same arabicTag)
```
Original order: [char1, char2, char3, char4]
Grouped as: {arabicTag: [char1, char2, char3, char4]}
After reversal: [char4, char3, char2, char1]
Rendered as: char4, char3, char2, char1 (correct RTL display)
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:686-688, 747-748, 764-766, 782-783`

### Regular Text Segment Format

For each regular text character (type 0x01):

```
Byte 0:  0x01                 (Type: Regular text)
Byte 1:  width & 0xFF         (Character width in pixels)
Byte 2:  height & 0xFF        (Character height in pixels)
Byte 3:  color_mode           (0x01 for single color, or extended for 600Txt)
        [If support600Txt=true]
Byte 4:  0x00                (Additional color mode byte)
Byte 5+: pixel_data           (Bit-packed monochrome pixel data)
```

### Emoji Segment Format

For each emoji (type 0x02):

```
Byte 0:  0x02                 (Type: Emoji)
Byte 1:  width & 0xFF         (Emoji width in pixels)
Byte 2:  height & 0xFF        (Emoji height in pixels)
Byte 3:  color_mode           (0x01 for RGB color)
        [If support600Txt=true]
Byte 4:  0x00                (Additional color mode byte)
Byte 5+: RGB_pixel_data       (3 bytes per pixel: R, G, B)
```

### Emoji Height Categories

Emojis are organized by height with separate lookup maps in `EmojiUtils`:

- **12px:** `EmojiUtils.INSTANCE.getEmoji12ByteMap()`
- **14px:** `EmojiUtils.INSTANCE.getEmoji14ByteMap()`
- **16px:** `EmojiUtils.INSTANCE.getEmoji16ByteMap()`
- **24px:** `EmojiUtils.INSTANCE.getEmoji24ByteMap()`
- **30px:** `EmojiUtils.INSTANCE.getEmoji30ByteMap()`
- **32px:** `EmojiUtils.INSTANCE.getEmoji32ByteMap()`

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:705-706`

### Emoji Color Handling

When processing emoji pixel data:

1. Get emoji bitmap from the appropriate height map using `emojiCode` as key
2. For each pixel in the emoji:
   - If `textMode == 0`: Use pixel color as-is
   - If pixel alpha == 0 (transparent) AND `textMode != 0`: Use `defaultColor`
   - Otherwise: Use pixel color
3. Extract RGB components and add to output as 3 separate bytes (R, G, B)

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:707-736`

## Pixel Data Encoding

### From Character to Bit-Packed Bytes

The `TextPixelUtil.text2Data()` method (line 1256) performs the bit-packing:

**Algorithm:**
```
Input: width (character width), arrayList of [x, y, pixel_value, is_foreground]
Output: List<Byte> of bit-packed bytes

For each row in the character grid (0 to height-1):
    For each group of 8 columns (0-7, 8-15, 16-23, 24-31, ...):
        Create a byte where each bit represents a pixel:
        Bit 0 (LSB) = Column (8*group + 0) pixel
        Bit 1 = Column (8*group + 1) pixel
        ...
        Bit 7 (MSB) = Column (8*group + 7) pixel
        
    If width > 8:
        Continue with next 8 columns
    If width > 16:
        Continue with next 8 columns
    If width > 24:
        Continue with next 8 columns
```

**Bit Order:** Little-endian within byte (bit 0 = leftmost pixel in the 8-pixel group)

**Example:** For a 16-pixel wide character row:
```
Pixels: [1, 0, 1, 1, 0, 0, 1, 0,  0, 1, 1, 0, 1, 0, 1, 1]
                 ↓ 8-pixel groups ↓
Byte 0: 0b01100101 = 0x65  (pixels 0-7)
Byte 1: 0b11010110 = 0xD6  (pixels 8-15)
```

**Source:** `com/th/common/utils/TextPixelUtil.java:1256-1348`

### getTextData Method

The `getTextData()` method in `DeviceCommand.java:414-446` handles regular (non-emoji) text:

```java
private final void getTextData(List<Byte> list, PixelTextBean pixelTextBean, boolean z) {
    list.add((byte) 1);  // Type: Regular text
    list.add(Byte.valueOf((byte) pixelTextBean.getWidth()));
    list.add(Byte.valueOf((byte) pixelTextBean.getHeight()));
    if (z) {  // support600Txt
        list.add((byte) 1);
        list.add((byte) 0);
    } else {
        list.add((byte) 1);  // color mode: single color
    }
    // Convert pixel data to bit-packed bytes
    list.addAll(TextPixelUtil.INSTANCE.text2Data(
        pixelTextBean.getWidth(), 
        arrayList  // List of [x, y, pixel_value, is_foreground]
    ));
}
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:414-446`

## Text File Format

When text is sent to the device, it follows a file-based transmission format.

### File Structure (sendFile method)

The `sendFile()` method in `DeviceCommand.java:1031-1069` prepares the file data:

```
File Data Structure:
┌─────────────────────────────────────────────────────────┐
│ File Header (variable length)                             │
├─────────────────────────────────────────────────────────┤
│ 1 byte: File type (0x01 for text)                         │
│ N bytes: File name length (1 byte) + file name (UTF-8)   │
├─────────────────────────────────────────────────────────┤
│ Text Data (from packTextData)                             │
│ ┌─────────────────┐ ┌─────────────────┐                 │
│ │ Segment 1       │ │ Segment 2       │ ...             │
│ │ [type, w, h, ..]│ │ [type, w, h, ..]│                 │
│ └─────────────────┘ └─────────────────┘                 │
├─────────────────────────────────────────────────────────┤
│ Footer (display parameters)                               │
└─────────────────────────────────────────────────────────┘
```

### sendFile Flow

```
1. Create file header:
   - [filename_length (1 byte)] [filename_bytes...]
   
2. Prepend file type byte (0x01 for text)
   
3. Append packed text data from packTextData()
   
4. Check if data needs splitting:
   if (needSplitData(arrayList.size())) {
       // Data is too large for single packet
       Add multi-packet header:
         - Prepend command byte (0x07 = SEND_FILE_DATA)
         - Add 4-byte file size (big-endian)
       Split into chunks using packMultiple()
       Send via sendMultiDataV2()
   } else {
       // Data fits in single packet
       Send directly via writeCmd()
   }
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:1031-1069`

## Multi-Packet Transmission

### When is Splitting Needed?

The `needSplitData()` method in `AppCommandUtil.java:133-135` determines if data needs to be split:

```java
public final boolean needSplitData(int i) {
    return BleManager.getInstance().getSplitWriteNum() > 247 
        ? i > 247 
        : i > BleManager.getInstance().getSplitWriteNum();
}
```

**Constants:**
- `SINGLE_PACK_MAX_LENGTH = 247` bytes (from `AppCommandUtil.java:43`)
- `MTU_VALUE = 512` bytes (from `AppCommandUtil.java:38`)

**Logic:**
- If SplitWriteNum > 247: split if data > 247 bytes
- Otherwise: split if data > SplitWriteNum

**Source:** `com/th/common/protocol/command/AppCommandUtil.java:133-135`

### packMultiple Method

The `packMultiple()` method in `AppCommandUtil.java:256` splits data into chunks:

```java
public final List<List<Byte>> packMultiple(List<Byte> list, boolean z)
```

This method:
1. Takes the complete data list
2. Splits it into chunks based on available MTU
3. Returns a list of chunk lists, each ready to be packed into a BLE packet

**Source:** `com/th/common/protocol/command/AppCommandUtil.java:256`

### Multi-Packet Header for File Transfer

When splitting is needed, `sendFile()` adds a special header before splitting:

```java
// Add SEND_FILE_DATA command byte
arrayList.add(0, (byte) 7);  // 0x07 = SEND_FILE_DATA

// Add 4-byte file size (big-endian)
byte[] bArrN = getintToByte(arrayList.size());  // 4 bytes
arrayList.add(1, Byte.valueOf(bArrN[3]));  // MSB
arrayList.add(2, Byte.valueOf(bArrN[2]));
arrayList.add(3, Byte.valueOf(bArrN[1]));
arrayList.add(4, Byte.valueOf(bArrN[0]));  // LSB
```

**Header Format:**
```
Byte 0:  0x07 (SEND_FILE_DATA command)
Bytes 1-4: File size (4 bytes, big-endian)
Bytes 5+: Actual file data
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:1056-1062`

### sendMultiDataV2 - Multi-Packet Transmission

The `sendMultiDataV2()` method in `MultiPackUtilV2.java:506-538` handles the actual multi-packet transmission:

**Process:**
1. Reset internal state
2. Store command list (list of data chunks)
3. Set pack unit from device configuration (`deviceBean.getPackV2Num()`)
4. Call `groupingData()` to organize chunks into groups

**groupingData()** (line 328-340):
1. Clear existing groups
2. Split command list into groups of `mPackUnit` size using `CollectionsKt.chunked()`
3. Set total group count
4. Call `notifySend()` to start transmission

**MultiPackUtilV2 Constants:**
- `SINGLE_PACK_TIME_OFFSET = 20` ms
- `TIMEOUT = 10000` ms (10 seconds)

**Source:** `com/th/common/protocol/command/MultiPackUtilV2.java:506-538, 328-340`

### Transmission Flow

```
DeviceCommand.sendTextData(mac, textName, beans, textMode, defaultColor)
  ↓
DeviceCommand.packTextData(support600Txt, beans, textMode, defaultColor)
  ↓
DeviceCommand.sendFile(mac, textName, packedData)
  ↓
if (needSplitData(packedData.size())) {
    addMultiPacketHeader()
    packMultiple(packedData) → List<List<Byte>> chunks
    sendMultiDataV2(mac, textName, chunks)
} else {
    writeCmd(mac, SEND_FILE_DATA, packedData)
}
  ↓
MultiPackUtilV2.sendMultiData(fileName, chunks)
  ↓
groupingData() → groups of packV2Num chunks
  ↓
notifySend() → sequential transmission with retries
```

## Text Mode Details

### Mode 0: Normal (Left-to-Right)

Standard text rendering:
- Characters are processed in order
- No grouping or reversal
- arabicTag is ignored (treated as 0)

**Use Case:** English, numbers, most European languages

### Mode 1: Special

Modified text rendering with special handling:
- Exact behavior not fully documented in source
- Likely for mixed LTR/RTL text or special formatting

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:676` (parameter i)

### Mode 2: Reverse (RTL - Right-to-Left)

For Arabic, Hebrew, and other RTL languages:
- Characters are grouped by `arabicTag`
- Each group is laid out right-to-left
- Groups are processed in their original order
- Character order within each group is reversed before rendering

**Use Case:** Arabic, Hebrew, Persian, Urdu

**Implementation:**
```java
if (i == 2) {  // textMode == 2
    CollectionsKt.reverse(list3);  // Reverse the group
}
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:686-688, 747-748, 764-766, 782-783`

## BLE Communication

### Connection Parameters

- **MTU:** 512 bytes (default from `AppCommandUtil.MTU_VALUE`)
- **Max Single Packet:** 247 bytes (`SINGLE_PACK_MAX_LENGTH`)
- **Multi-packet support:** For data larger than available MTU

**Source:** `com/th/common/protocol/command/AppCommandUtil.java:38-43`

### Write Process

1. **Prepare data:** Text → Pixel data → Binary format
2. **Check size:** If data > max single packet, split into chunks
3. **Add header:** APP_DEVICE (0xA0) + Command + Length
4. **Calculate CRC:** CRC16 over header + data
5. **Write to characteristic:** A0AD (Write UUID)

### Response Handling

After sending text data:
- Device processes the data
- May send acknowledgment via F0AD (Notice UUID)
- Display updates with the rendered text

## Protocol Constants

From `DeviceCommand.java`:
```java
public static final byte SHOW_TEXT = 10;           // 0x0A
public static final byte SEND_FILE_DATA = 7;       // 0x07
public static final byte SET_REMOTE = 72;          // 0x48
public static final byte READ_REMOTE = 73;         // 0x49
public static final byte SET_PARTITION = 36;       // 0x24
public static final byte READ_COMMUNICATION_VERSION = 76; // 0x4C
```

From `AppCommandUtil.java`:
```java
public static final byte APP_DEVICE = -96;        // 0xA0
public static final int SINGLE_PACK_MAX_LENGTH = 247;
public static final int MTU_VALUE = 512;
public static final byte USER_FILE_TYPE_TXT = 1;
public static final byte SHAKE_HAND_FIRST = 0;    // 0x00
public static final byte SHAKE_HAND_SECOND = 1;   // 0x01
```

**Source:** `com/th/common/protocol/pixel/DeviceCommand.java:88-110`, `com/th/common/protocol/command/AppCommandUtil.java:29-47`

## Node.js Implementation Considerations

### Text to Pixel Conversion

For Node.js implementation, you need to:

1. **Font Rendering:** Use a library like `canvas` to render text to bitmap
2. **Character Splitting:** Split text into individual characters and emojis
3. **Pixel Extraction:** Extract pixel data from the bitmap
4. **Emoji Detection:** Identify emoji characters and handle separately
5. **Arabic Tag Management:** For RTL text, assign arabicTag values to group characters
6. **Bit Packing:** Convert 8-pixel groups to bytes
7. **Format Packing:** Create the binary format matching the Android app

### Required Functionality

```javascript
// Key functions to implement:
function splitTextIntoBeans(text, font, options) {
    // Returns: Array<PixelTextBean>
}

function detectEmoji(char) {
    // Returns: boolean
}

function getEmojiHeight(emoji) {
    // Returns: 12, 14, 16, 24, 30, or 32
}

function assignArabicTags(text) {
    // Returns: Array<{char, arabicTag}>
    // For RTL: assign same tag to connected characters
    // For LTR: tag = 0
}

function packTextData(beans, options) {
    // Returns: Buffer
    // Implement the algorithm from DeviceCommand.java:676-792
}

function needSplitData(dataLength) {
    // Returns: boolean
    // Check against SINGLE_PACK_MAX_LENGTH (247)
}

function packMultiple(data) {
    // Returns: Array<Buffer>
    // Split data into chunks of max 247 bytes
}
```

### BLE Communication

Use `@stoprocent/noble` with async/await:

```javascript
import noble from '@stoprocent/noble';

// Scan for P0AD devices
await noble.startScanningAsync([P0AD_CONFIG.SERVICE_UUID]);

// Connect to device
const peripheral = await noble.waitForDiscoverAsync(
    p => p.advertisement.localName === 'P0AD_XXX'
);

// Subscribe to notifications
const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
const noticeChar = characteristics.find(c => c.uuid === P0AD_CONFIG.NOTICE_UUID);
await noticeChar.subscribeAsync();

// Send data with multi-packet support
async function sendTextData(text) {
    const beans = splitTextIntoBeans(text);
    const packed = packTextData(beans, { textMode: 0 });
    
    if (needSplitData(packed.length)) {
        const chunks = packMultiple(packed);
        await sendMultiDataV2(peripheral, chunks);
    } else {
        await sendSinglePacket(peripheral, P0AD_CONFIG.SEND_FILE_DATA, packed);
    }
    
    // Display the text
    await sendSinglePacket(peripheral, P0AD_CONFIG.SHOW_TEXT, 
        Buffer.from([0x01]) // file type
    );
}
```

## Complete Example: Sending "Hello World" to P0AD Device

```
1. Application splits "Hello World" into 11 PixelTextBean objects
2. packTextData() processes each character:
   - 'H': [0x01, 8, 16, 0x01, pixel_data...]
   - 'e': [0x01, 8, 16, 0x01, pixel_data...]
   - 'l': [0x01, 4, 16, 0x01, pixel_data...]
   - ... etc
3. Data is combined into a file with header:
   - [0x01, filename_length, filename..., text_data...]
4. If data > 247 bytes:
   - Add multi-packet header: [0x07, file_size_4bytes...]
   - Split into chunks
   - Send via sendMultiDataV2()
5. Send SHOW_TEXT command (0x0A) to display
6. Device renders the text on the 96x16 display
```

## Notes

1. The P0AD device uses AC6951C chip, which may have specific timing requirements
2. Text rendering performance depends on the device's processing speed
3. Large text will require multi-packet transmission
4. The device supports both single-color and multi-color (emoji) text
5. Arabic and RTL text requires special handling with textMode=2
6. The device uses a dual-chip architecture (deviceDualChips: 1)
7. Text is sent as files, then displayed with SHOW_TEXT command

## Source Code References

| File | Line | Description |
|------|------|-------------|
| `com/th/common/protocol/pixel/DeviceCommand.java` | 676-792 | `packTextData()` - Main text packing method |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 414-446 | `getTextData()` - Regular text segment creation |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 1031-1069 | `sendFile()` - File transmission with splitting |
| `com/th/common/protocol/pixel/DeviceCommand.java` | 1085-1104 | `sendTextData()` - Text data transmission |
| `com/th/common/utils/TextPixelUtil.java` | 1256-1348 | `text2Data()` - Bit-packing algorithm |
| `com/th/common/protocol/command/AppCommandUtil.java` | 133-135 | `needSplitData()` - Split decision |
| `com/th/common/protocol/command/AppCommandUtil.java` | 256 | `packMultiple()` - Chunk splitting |
| `com/th/common/protocol/command/MultiPackUtilV2.java` | 506-538 | `sendMultiData()` - Multi-packet transmission |
| `com/th/common/protocol/command/MultiPackUtilV2.java` | 328-340 | `groupingData()` - Chunk grouping |
| `com/th/common/bean/PixelTextBean.java` | | Text element structure |
| `android app/assets/th_dev_cfg.json` | | Device configurations (Device ID 22 = P0AD) |
| `android app/assets/deviceSize.json` | | Screen size definitions |
