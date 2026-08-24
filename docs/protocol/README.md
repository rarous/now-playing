# P0AD LED Display Protocol Documentation

This directory contains documentation for the P0AD LED display device protocol, extracted from the PixelJoy Android application decompiled sources.

## Device Information

**P0AD Device (Device ID: 22)**
- **Display:** 96 x 16 pixels
- **Chip:** AC6951C
- **BLE Service UUID:** `0000E0AD-0000-1000-8000-00805F9B34FB`
- **BLE Write Characteristic:** `0000A0AD-0000-1000-8000-00805F9B34FB`
- **BLE Notice Characteristic:** `0000F0AD-0000-1000-8000-00805F9B34FB`
- **Mold PID:** P0AD
- **Mold Number:** D53601

## Documentation Files

### [P0AD Text Rendering Protocol](p0ad-text-rendering.md)
High-level overview of the text rendering protocol for the P0AD device.

**Contents:**
- Device configuration and capabilities
- Protocol stack overview
- Text rendering commands and flow
- Text data packet structure
- Color representation
- Special features (Arabic RTL, Emoji support)
- BLE communication parameters
- Node.js implementation considerations

### [P0AD Binary Protocol Specification](p0ad-binary-format.md)
Detailed binary format specifications for the P0AD protocol.

**Contents:**
- Device identification and UUIDs
- Packet structure and CRC16 algorithm
- Complete command code reference
- Binary format for text segments
- Pixel data encoding algorithms
- Bit-packing details
- Complete transmission flow
- Multi-packet transmission
- Working Node.js code examples

### [P0AD Handshake Protocol](p0ad-handshake.md)
Complete documentation of the initial BLE handshake required before sending commands.

**Contents:**
- Handshake sequence diagram (BLE connect → MTU → subscribe → handshake)
- First handshake (0x00) with magic bytes "CCHIP"
- Second handshake (0x01) with XORed challenge bytes
- Handshake constants and timing (1000ms timeout, 3 retries)
- Challenge-response mechanism details
- Error handling and cleanup
- Node.js implementation example
- Source code references

## Quick Reference

### Command Codes (from DeviceCommand.java)

```
SHOW_TEXT       = 0x0A (10)  - Display text
SHOW_IMG        = 0x0B (11)  - Display image
SHOW_GIF       = 0x0C (12)  - Display GIF animation
SHOW_CLOCK     = 0x0D (13)  - Display clock
SEND_FILE_DATA = 0x07 (7)   - Send file data (used for text)

// Handshake Commands
SHAKE_HAND_FIRST  = 0x00 (0)   - First handshake (client → device)
SHAKE_HAND_SECOND = 0x01 (1)   - Second handshake (client → device)
```

### Handshake Constants (from DeviceCommand.java)

```
SET_REMOTE                  = 0x48 (72)  - 'H'
READ_REMOTE                 = 0x49 (73)  - 'I'
SET_PARTITION               = 0x24 (36)  - XOR mask for b1
READ_COMMUNICATION_VERSION = 0x4C (76)  - XOR mask for b2
```

### Handshake Magic Bytes

First handshake payload: `[0x43, 0x43, 0x48, 0x49, 0x50]` = "CCHIP"

### Packet Format

```
Byte 0:  0xA0 (APP_DEVICE header)
Byte 1:  Command code
Byte 2:  Payload length + 3
Bytes 3..N+2: Payload
Bytes N+3..N+4: CRC16 (big-endian)
```

### Text Segment Format

**Regular Text (Type 0x01):**
```
0x01, width, height, color_mode, [pixel_data...]
```

**Emoji (Type 0x02):**
```
0x02, width, height, color_mode, [RGB_pixel_data...]
```

### Pixel Data Encoding

- 1 bit per pixel (0 = off, 1 = on)
- 8 pixels per byte (bit 0 = leftmost)
- Row-major order (top to bottom, left to right)
- Bytes grouped by 8-column strips

## Source Code References

All protocol information was extracted from the following files in the decompiled Android app:

**Core Protocol Files:**
- `com/th/common/protocol/pixel/DeviceCommand.java` - Device commands and text packing
- `com/th/common/protocol/pixel/PixelProtocol.java` - Protocol implementation
- `com/th/common/protocol/command/AppCommandUtil.java` - Command constants
- `com/th/common/utils/TextPixelUtil.java` - Text to pixel conversion
- `com/th/common/utils/BleDataUtils.java` - BLE packet packing
- `com/th/common/utils/BleConnectUtil.java` - BLE connection management

**Configuration Files:**
- `android app/assets/th_dev_cfg.json` - Device configurations (Device ID 22 = P0AD)
- `android app/assets/deviceSize.json` - Screen size definitions

**Data Structures:**
- `com/th/common/bean/PixelTextBean.java` - Text pixel data
- `com/th/common/bean/DeviceBean.java` - Device properties

## Node.js Implementation

For a complete Node.js implementation, you will need:

1. **BLE Library:** `@abandonware/noble` or similar
2. **Graphics Library:** `canvas` for text rendering
3. **CRC16:** Custom implementation (see examples in documentation)

### Minimal Dependencies

```bash
npm install @abandonware/noble canvas
```

### Key Implementation Steps

1. **Scan and connect** to P0AD device using BLE UUIDs
2. **Subscribe to notifications** on Notice characteristic
3. **Perform handshake** (automatic in P0ADDevice class)
   - Send first handshake with magic bytes "CCHIP"
   - Wait for challenge bytes and XOR with constants
   - Send second handshake with XORed values
   - Wait for success confirmation
4. **Render text** to bitmap using canvas
5. **Extract pixel data** and convert to monochrome
6. **Bit-pack** the pixel data (8 pixels per byte)
7. **Create segments** with proper headers
8. **Build packets** with APP_DEVICE header and CRC16
9. **Send data** via BLE write characteristic
10. **Display text** with SHOW_TEXT command

## Protocol Features

✅ **Text Rendering** - Single and multi-color text  
✅ **Emoji Support** - Various emoji sizes (12px, 14px, 16px, 24px, 30px, 32px)  
✅ **RTL Text** - Arabic, Hebrew, and other right-to-left languages  
✅ **Multi-packet Transmission** - Handles data larger than MTU  
✅ **CRC16 Checksum** - Data integrity verification  
✅ **Color Support** - Single color and RGB per-pixel  
✅ **Challenge-Response Handshake** - Required before sending commands  

## Notes

- The P0AD device uses a dual-chip architecture (deviceDualChips: 1)
- Default display size is 96x16 pixels
- Maximum single packet: 247 bytes
- Default MTU: 512 bytes
- Text is sent as files, then displayed

## Contributing

If you find any inaccuracies or have additional information about the protocol, please verify against the original source code in:
```
/Users/rarous/Developer/rarous/now-playing/android app/sources/com/th/
```

All references in the documentation use the format: `path/to/file.java:line_number`

## License

This documentation is derived from decompiled Android application code and is provided for protocol compatibility purposes.
