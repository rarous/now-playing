# P0AD Device Handshake Protocol

## Overview

This document describes the initial handshake protocol between the client (PixelJoy app) and the P0AD LED display device. The handshake is required before any commands can be sent to the device.

**Reference:** `com/th/common/protocol/command/AppCommandUtil.java`

## Handshake Sequence

```
Client                          Device
  |                               |
  |------ BLE Connect ------------>|
  |                               |
  |------ MTU Negotiation -------->|
  |                               |
  |------ Subscribe to Notify ----->|
  |                               |
  |------ Handshake First (0x00) ->|
  |                               |
  |<------ Handshake Response ----|
  |                               |
  |------ Handshake Second (0x01)->|
  |                               |
  |<------ Handshake Success -----|
  |                               |
  |------ Device Ready ------------>|
```

## Detailed Handshake Process

### Step 1: BLE Connection

The client connects to the device using standard BLE connection:
- **Service UUID:** `0000E0AD-0000-1000-8000-00805F9B34FB`
- **Write Characteristic:** `0000A0AD-0000-1000-8000-00805F9B34FB`
- **Notice Characteristic:** `0000F0AD-0000-1000-8000-00805F9B34FB`

**Source:** `BleConnectUtil.java:689` - `connect()` method

### Step 2: MTU Negotiation

After successful connection, the client negotiates the MTU:
- **Requested MTU:** 512 bytes (from `AppCommandUtil.MTU_VALUE`)
- **Split Write Num:** 509 if MTU >= 512, otherwise `MTU - 3`

**Source:** `BleConnectUtil.java:502` - `setMtu()` method

### Step 3: Subscribe to Notifications

The client subscribes to the Notice characteristic to receive responses from the device:

```java
BleManager.getInstance().notify(
    bleDevice, 
    serviceUUID, 
    noticeUUID, 
    new BleNotifyCallback() {
        onNotifySuccess() {
            AppCommandUtil.INSTANCE.shakeHandsFirst(bleDevice);
        }
        onCharacteristicChanged(byte[] data) {
            parseDeviceReplyData(bleDevice, data);
        }
    }
);
```

**Source:** `BleConnectUtil.java:527` - `subscribeBle()` method

### Step 4: First Handshake (SHAKE_HAND_FIRST = 0x00)

When notification subscription succeeds, the client initiates the first handshake:

**Command:** `0x00` (SHAKE_HAND_FIRST)

**Payload:** `[67, 67, SET_REMOTE, READ_REMOTE, 80]`

Where:
- `67` = ASCII 'C' (0x43)
- `SET_REMOTE` = 0x48 (72 decimal) - from DeviceCommand.java
- `READ_REMOTE` = 0x49 (73 decimal) - from DeviceCommand.java
- `80` = 0x50 (80 decimal)

**Packet Format:**
```
Header:  [0xA0] [0x00] [0x08]  (APP_DEVICE, SHAKE_HAND_FIRST, length=5+3=8)
Payload: [0x43, 0x43, 0x48, 0x49, 0x50]
CRC:     [2 bytes]
```

**Source:** `AppCommandUtil.java:302`

```java
final byte[] bArrPack = BleDataUtils.INSTANCE.pack(
    (byte) 0, 
    Arrays.copyOf(new byte[]{67, 67, DeviceCommand.SET_REMOTE, 
                            DeviceCommand.READ_REMOTE, 80}, 5)
);
```

### Step 5: First Handshake Response

The device responds with a packet containing:
- **Command:** `0x00` (SHAKE_HAND_FIRST response)
- **Response bytes:** Includes two important bytes at positions [5] and [6]

**Source:** `BleConnectUtil.java:438`

```java
if (b5 == 0) {  // b5 is the command byte
    LogUtil.log(Constants.TAG, "第一次握手回复");  // "First handshake response"
    AppCommandUtil.INSTANCE.shakeHandsSecond(bleDevice, bArr8[5], bArr8[6]);
    return;
}
```

The client extracts bytes [5] and [6] from the response payload and uses them for the second handshake.

### Step 6: Second Handshake (SHAKE_HAND_SECOND = 0x01)

The client sends the second handshake with the values from the first response:

**Command:** `0x01` (SHAKE_HAND_SECOND)

**Payload:** `[67, 67, SET_REMOTE, READ_REMOTE, 80, (b1 ^ SET_PARTITION), (b2 ^ READ_COMMUNICATION_VERSION)]`

Where:
- `b1` = byte [5] from first handshake response
- `b2` = byte [6] from first handshake response
- `SET_PARTITION` = 0x24 (36 decimal) - from DeviceCommand.java:100
- `READ_COMMUNICATION_VERSION` = 0x4C (76 decimal) - from DeviceCommand.java:88

**XOR Operation:** Each byte is XORed with a constant before sending

**Packet Format:**
```
Header:  [0xA0] [0x01] [0x0A]  (APP_DEVICE, SHAKE_HAND_SECOND, length=7+3=10)
Payload: [0x43, 0x43, 0x48, 0x49, 0x50, (b1^0x24), (b2^0x4C)]
CRC:     [2 bytes]
```

**Source:** `AppCommandUtil.java:336`

```java
final byte[] bArrPackByteArray = BleDataUtils.INSTANCE.packByteArray(
    (byte) 1, 
    new byte[]{67, 67, DeviceCommand.SET_REMOTE, DeviceCommand.READ_REMOTE, 
              80, (byte) (b ^ DeviceCommand.SET_PARTITION), 
              (byte) (b2 ^ DeviceCommand.READ_COMMUNICATION_VERSION)}
);
```

### Step 7: Second Handshake Response

The device responds with:
- **Command:** `0x01` (SHAKE_HAND_SECOND response)
- **Response byte [5]:** 0x00 for success, non-zero for failure

**Source:** `BleConnectUtil.java:442`

```java
if (b5 == 1) {  // SHAKE_HAND_SECOND response
    if (bArr8[5] != 0) {
        LogUtil.loge(Constants.TAG, "第二次握手失败");  // "Second handshake failed"
        return;
    }
    AppCommandUtil.INSTANCE.shakeHandsSecondSuccess(bleDevice);
    LogUtil.log(Constants.TAG, "第二次握手成功");  // "Second handshake success"
    shakeSuccess(bleDevice);
    return;
}
```

### Step 8: Handshake Complete

After successful second handshake:
1. `shakeHandsSecondSuccess()` is called - cleans up disposable objects
2. `shakeSuccess()` is called - sends `MSG_CONNECT_SUCCESS` event
3. Device is ready for commands

**Source:** `BleConnectUtil.java:522` and `AppCommandUtil.java:356`

## Handshake Constants

From `AppCommandUtil.java`:

```java
public static final byte SHAKE_HAND_FIRST = 0;     // 0x00
public static final byte SHAKE_HAND_SECOND = 1;    // 0x01
private static final long SHAKE_PERIOD_TIME = 1000;   // 1 second timeout
private static final long SHAKE_RETRY_COUNT = 3;      // 3 retries
```

From `DeviceCommand.java`:

```java
public static final byte SET_REMOTE = 72;           // 0x48
public static final byte READ_REMOTE = 73;          // 0x49
public static final byte SET_PARTITION = 36;        // 0x24
public static final byte READ_COMMUNICATION_VERSION = 76;  // 0x4C
```

## Handshake Magic Bytes

The handshake uses specific magic bytes:

**First Handshake Payload:**
```
[0x43, 0x43, 0x48, 0x49, 0x50]
```

This translates to ASCII: `'C', 'C', 'H', 'I', 'P'`

**Interpretation:** This appears to be a magic string "CC" followed by command codes for SET_REMOTE (H=72), READ_REMOTE (I=73), and the value 80 (P=80).

**Second Handshake Payload:**
```
[0x43, 0x43, 0x48, 0x49, 0x50, (b1^0x24), (b2^0x4C)]
```

Same initial bytes, followed by the XORed challenge values.

## Error Handling

### Timeout

If a handshake step doesn't receive a response within 1 second (SHAKE_PERIOD_TIME), it will:
1. Retry up to 3 times (SHAKE_RETRY_COUNT)
2. Disconnect from the device if all retries fail
3. Send `MSG_CONNECTION_FAIL` event

**Source:** `AppCommandUtil.java:303-319` and `337-354`

### Cleanup

If connection fails at any point:
- `removeShakeDisposable()` is called to clean up any pending handshake operations
- Send queue is reset
- Device is disconnected

**Source:** `BleConnectUtil.java:694, 700, 719`

## State Management

The handshake uses two maps to track state:
- `shake1DisMap` - Tracks first handshake operations (key: MAC address)
- `shake2DisMap` - Tracks second handshake operations (key: MAC address)

These are cleaned up in:
- `removeShakeDisposable()` - Removes entries from both maps
- `shakeHandsSecondSuccess()` - Removes from shake2DisMap
- `shakeHandsSecond()` - Removes from shake1DisMap before starting second handshake

## Node.js Implementation

```javascript
const P0AD_CONFIG = {
  SHAKE_HAND_FIRST: 0x00,
  SHAKE_HAND_SECOND: 0x01,
  SET_REMOTE: 0x48,
  READ_REMOTE: 0x49,
  SET_PARTITION: 0x24,
  READ_COMMUNICATION_VERSION: 0x4C
};

// First handshake payload
const firstHandshakePayload = Buffer.from([
  0x43, 0x43, P0AD_CONFIG.SET_REMOTE, 
  P0AD_CONFIG.READ_REMOTE, 0x50
]);

// Second handshake payload (with challenge bytes b1, b2)
function createSecondHandshakePayload(b1, b2) {
  return Buffer.from([
    0x43, 0x43, P0AD_CONFIG.SET_REMOTE, 
    P0AD_CONFIG.READ_REMOTE, 0x50,
    b1 ^ P0AD_CONFIG.SET_PARTITION,
    b2 ^ P0AD_CONFIG.READ_COMMUNICATION_VERSION
  ]);
}

// Handshake process
async function performHandshake(device) {
  // Step 1: Subscribe to notifications
  await device.subscribeToNotifications();
  
  // Step 2: First handshake
  const firstPacket = createPacket(
    P0AD_CONFIG.SHAKE_HAND_FIRST, 
    firstHandshakePayload
  );
  await device.write(firstPacket);
  
  // Step 3: Wait for response
  const firstResponse = await device.waitForNotification(1000);
  
  if (firstResponse[1] !== P0AD_CONFIG.SHAKE_HAND_FIRST) {
    throw new Error('Unexpected first handshake response');
  }
  
  // Extract challenge bytes from positions 5 and 6 of payload
  const b1 = firstResponse[3 + 5];  // Skip header (3 bytes)
  const b2 = firstResponse[3 + 6];
  
  // Step 4: Second handshake
  const secondPayload = createSecondHandshakePayload(b1, b2);
  const secondPacket = createPacket(
    P0AD_CONFIG.SHAKE_HAND_SECOND,
    secondPayload
  );
  await device.write(secondPacket);
  
  // Step 5: Wait for success
  const secondResponse = await device.waitForNotification(1000);
  
  if (secondResponse[1] !== P0AD_CONFIG.SHAKE_HAND_SECOND) {
    throw new Error('Unexpected second handshake response');
  }
  
  // Check byte 5 of payload
  const resultByte = secondResponse[3 + 5];
  if (resultByte !== 0x00) {
    throw new Error(`Handshake failed: ${resultByte}`);
  }
  
  console.log('Handshake successful!');
}
```

## Handshake Flow Diagram

```
Client                              Device
  |                                  |
  |------ connect() ---------------->|
  |                                  |
  |<----- onConnectSuccess ----------|
  |                                  |
  |------ setMtu(512) -------------->|
  |                                  |
  |<----- onMtuChanged --------------|
  |                                  |
  |------ subscribeBle() ------------>|
  |                                  |
  |<----- onNotifySuccess ------------|
  |                                  |
  |------ shakeHandsFirst() -------->|
  |   [0xA0, 0x00, 0x08,           |
  |    0x43, 0x43, 0x48,           |
  |    0x49, 0x50, CRC]             |
  |                                  |
  |<----- Handshake Response --------|
  |   [0xA0, 0x00, N, ...b5...]    |
  |                                  |
  |------ shakeHandsSecond(b5,b6) ->|
  |   [0xA0, 0x01, 0x0A,           |
  |    0x43, 0x43, 0x48,           |
  |    0x49, 0x50, b5^0x24,        |
  |    b6^0x4C, CRC]                |
  |                                  |
  |<----- Handshake Success --------|
  |   [0xA0, 0x01, N, ...0x00...]   |
  |                                  |
  |------ MSG_CONNECT_SUCCESS ------>|
  |                                  |
```

## Important Notes

1. **Handshake is automatic** - Triggered by `onNotifySuccess()` after subscribing to notifications
2. **Handshake is required** - No commands will work without successful handshake
3. **Handshake uses challenge-response** - Device provides a challenge in first response, client must respond correctly
4. **Handshake cleanup** - Must be properly cleaned up on disconnect or failure
5. **Timeout** - Each handshake step has a 1-second timeout with 3 retries

## Source Code References

| File | Line | Description |
|------|------|-------------|
| `AppCommandUtil.java` | 39-40 | SHAKE_HAND constants |
| `AppCommandUtil.java` | 300-320 | `shakeHandsFirst()` method |
| `AppCommandUtil.java` | 322-354 | `shakeHandsSecond()` method |
| `AppCommandUtil.java` | 356-366 | `shakeHandsSecondSuccess()` method |
| `BleConnectUtil.java` | 438-439 | First handshake response handling |
| `BleConnectUtil.java` | 442-449 | Second handshake response handling |
| `BleConnectUtil.java` | 527-548 | `subscribeBle()` - triggers handshake |
| `BleConnectUtil.java` | 522-524 | `shakeSuccess()` - handshake complete |
| `DeviceCommand.java` | 88, 100 | Command codes used in handshake |
| `DeviceCommand.java` | 72, 88 | READ_REMOTE, READ_COMMUNICATION_VERSION |

## Troubleshooting

### Handshake Fails

1. **Check BLE connection** - Ensure device is connected and notifications are subscribed
2. **Check MTU negotiation** - Verify MTU was successfully set
3. **Check response parsing** - Ensure the response command byte matches expected value
4. **Check challenge values** - Verify bytes [5] and [6] are being extracted correctly
5. **Check XOR calculation** - Ensure challenge bytes are XORed with correct constants

### Timeout Issues

1. **Increase timeout** - Modify `SHAKE_PERIOD_TIME` (currently 1000ms)
2. **Increase retries** - Modify `SHAKE_RETRY_COUNT` (currently 3)
3. **Check BLE signal** - Weak signal may cause delays
4. **Check device state** - Device may be busy processing previous commands

## Security Considerations

The handshake implements a simple challenge-response mechanism:
1. Client sends a fixed magic string
2. Device responds with a challenge (2 bytes)
3. Client XORs the challenge with known constants and sends back
4. Device verifies the response and accepts the connection

**Note:** This is not cryptographically secure, but provides a basic verification that the client understands the protocol.
