export const SERIAL_PROTOCOL_COLOR = 0x01
export const SERIAL_PROTOCOL_WIRELESS = 0x03
export const SERIAL_PROTOCOL_MAX_PAYLOAD_LENGTH = 32

const SERIAL_PROTOCOL_MAGIC = new Uint8Array([0x4C, 0x53, 0x50, 0x01]) // "LSP" + version 1
const SERIAL_PROTOCOL_HEADER_LENGTH = SERIAL_PROTOCOL_MAGIC.length + 3

let serialProtocolSequence = 0

const crc8 = (data: Uint8Array): number => {
  let crc = 0
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) !== 0
        ? ((crc << 1) ^ 0x07) & 0xFF
        : (crc << 1) & 0xFF
    }
  }
  return crc
}

export const encodeSerialProtocolFrame = (
  messageType: number,
  payload: Uint8Array
): Uint8Array => {
  if (payload.length > SERIAL_PROTOCOL_MAX_PAYLOAD_LENGTH) {
    throw new RangeError(`Serial protocol payload exceeds ${SERIAL_PROTOCOL_MAX_PAYLOAD_LENGTH} bytes`)
  }

  const frameLength = SERIAL_PROTOCOL_HEADER_LENGTH + payload.length + 1
  const frame = new Uint8Array(frameLength)

  frame.set(SERIAL_PROTOCOL_MAGIC, 0)
  frame[4] = messageType & 0xFF
  frame[5] = serialProtocolSequence & 0xFF
  frame[6] = payload.length
  frame.set(payload, SERIAL_PROTOCOL_HEADER_LENGTH)
  frame[frameLength - 1] = crc8(frame.subarray(0, frameLength - 1))

  serialProtocolSequence = (serialProtocolSequence + 1) & 0xFF
  return frame
}
