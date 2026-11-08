"""Minimal Greenglass client for the JamMan USB serial port.

Never write under /mnt/nandfs/usr/: that is the pedal's own software.

Frame: <u16 msgID><u32 payloadLen><payload>, all little endian.
Requests start their payload with a u32 serial number; responses echo it.
Strings: <i32 byteLen><utf8 bytes>.
"""
import os, sys, struct, termios, time, select, json

INT_PROPS_MAX = 17
PROP_NAMES = {
    0: "DoubleClickTime", 1: "FamilyID", 2: "DeviceID", 3: "ProtocolVersion", 4: "FirmwareVersion",
    5: "RemovableMediaIsPresent", 6: "SampleRate", 7: "ChannelCount", 8: "BitDepth",
    9: "FileDialogAllowMultiselect", 10: "KilobytesAvailableOnNand", 11: "KilobytesCapacityOnNand",
    12: "KilobytesAvailableOnSd", 13: "KilobytesCapacityOnSd", 14: "DiskState",
    15: "CurrentBankAndPatch", 16: "AudioIsDirty", 17: "SettingsAreDirty",
    32768: "CurrentAppPath", 32769: "UserHomeFolderPath", 32770: "UserDocumentsFolderPath",
    32771: "UserDesktopFolderPath", 32772: "UserAppDataFolderPath", 32773: "UserMusicFolderPath",
    32774: "CommonAppDataFolderPath", 32775: "AppsFolderPath", 32776: "TempFolderPath", 32777: "Name",
    32778: "Guid", 32779: "InternalPatchFolderPath", 32780: "RemovablePatchFolderPath",
    32781: "DirectorySeparator", 32782: "FileDialogCaption", 32783: "FileDialogDefaultFileName",
    32784: "FileDialogDefaultExtension", 32785: "FileDialogInitialFolder", 32786: "FileDialogFilter",
    32787: "FileDialogFileNames", 32788: "QueueCurrentBehavior", 32789: "QueueEmptyBehavior",
    32790: "LeftButtonCommand", 32791: "MiddleButtonCommand", 32792: "RightButtonCommand",
}


class Reader:
    def __init__(self, b): self.b, self.p = b, 0
    def take(self, n):
        v = self.b[self.p:self.p + n]; self.p += n; return v
    def u8(self): return self.take(1)[0]
    def u16(self): return struct.unpack("<H", self.take(2))[0]
    def i16(self): return struct.unpack("<h", self.take(2))[0]
    def u32(self): return struct.unpack("<I", self.take(4))[0]
    def i32(self): return struct.unpack("<i", self.take(4))[0]
    def i64(self): return struct.unpack("<q", self.take(8))[0]
    def s(self): return self.take(self.i32()).decode("utf-8", "replace")


def gstr(s):
    b = s.encode("utf-8"); return struct.pack("<i", len(b)) + b


class Port:
    def __init__(self, dev):
        self.fd = os.open(dev, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        a = termios.tcgetattr(self.fd)
        a[0] = 0; a[1] = 0; a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL; a[3] = 0
        a[4] = a[5] = termios.B115200
        termios.tcsetattr(self.fd, termios.TCSANOW, a)
        self.buf = b""; self.serial = 1; self.notifications = []

    def close(self): os.close(self.fd)

    def _fill(self, timeout):
        r, _, _ = select.select([self.fd], [], [], timeout)
        if r:
            try: self.buf += os.read(self.fd, 65536)
            except BlockingIOError: pass

    def _write_all(self, frame, timeout=10.0):
        # The fd is non-blocking: os.write may send only part of a large frame.
        # A short write desyncs the pedal's parser, so loop until every byte is out.
        view = memoryview(frame); end = time.time() + timeout
        while view:
            if time.time() > end: raise TimeoutError("serial write stalled")
            select.select([], [self.fd], [], 0.2)
            try: view = view[os.write(self.fd, view):]
            except BlockingIOError: pass
        termios.tcdrain(self.fd)

    def read_msg(self, timeout=3.0):
        end = time.time() + timeout
        while True:
            if len(self.buf) >= 6:
                mid, ln = struct.unpack("<HI", self.buf[:6])
                if len(self.buf) >= 6 + ln:
                    payload = self.buf[6:6 + ln]; self.buf = self.buf[6 + ln:]
                    return mid, payload
            left = end - time.time()
            if left <= 0: return None
            self._fill(min(left, 0.2))

    def request(self, mid, body=b"", timeout=3.0):
        ser = self.serial; self.serial += 1
        payload = struct.pack("<I", ser) + body
        self._write_all(struct.pack("<HI", mid, len(payload)) + payload)
        end = time.time() + timeout
        while time.time() < end:
            m = self.read_msg(end - time.time())
            if m is None: break
            rid, p = m
            if rid >= 0x8000:
                self.notifications.append(decode_notification(rid, p)); continue
            r = Reader(p); rs = r.u32()
            if rs != ser:
                print(f"  (skip reply for serial {rs}, msg {rid})", file=sys.stderr); continue
            if rid == 3: raise RuntimeError(f"FailureResponse: {r.s()}")
            return rid, r
        raise TimeoutError(f"no reply to msg {mid}")

    # --- read-only requests ---
    def who_am_i(self):
        rid, r = self.request(0)
        return dict(familyID=r.u16(), productID=r.u16(), reserved=r.u16(),
                    softwareVersionBcd=hex(r.u16()), guid=r.s(), name=r.s())

    def get_properties(self):
        rid, r = self.request(19, struct.pack("<B", 0))
        props = {}
        for _ in range(r.i16()):
            k = r.u16(); props[PROP_NAMES.get(k, k)] = r.i32()
        for _ in range(r.i16()):
            k = r.u16(); props[PROP_NAMES.get(k, k)] = r.s()
        return props

    def folder_contents(self, path):
        rid, r = self.request(17, gstr(path))
        files = [r.s() for _ in range(r.i32())]
        dirs = [r.s() for _ in range(r.i32())]
        return files, dirs

    def entry_info(self, path, is_folder):
        rid, r = self.request(4, struct.pack("<?", is_folder) + gstr(path))
        def dt():
            y = r.i16(); mo, d, h, mi = (struct.unpack("<b", r.take(1))[0] for _ in range(4))
            return f"{y:04d}-{mo + 1:02d}-{d:02d} {h:02d}:{mi:02d}"
        return dict(isFolder=r.u8() == 1, name=r.s(), exists=r.u8() == 1, size=r.i64(),
                    readOnly=r.u8() == 1, hidden=r.u8() == 1, created=dt(), modified=dt(), accessed=dt())

    def read_file(self, path, chunk=8162):
        # FileOpenRequest: access Read (=1 in .NET FileAccess), mode OpenExisting (=1)
        rid, r = self.request(10, gstr(path) + bytes([1, 1]))
        handle, size = r.i64(), r.i64()
        data = b""
        try:
            while len(data) < size:
                rid, rr = self.request(12, struct.pack("<qi", handle, min(chunk, size - len(data))), timeout=10)
                rr.i64(); n = rr.i32(); part = rr.take(n)
                if not part: break
                data += part
        finally:
            self.request(16, struct.pack("<q", handle))
        return data

    # --- properties and commands ---
    def get_property(self, prop):
        rid, r = self.request(26, struct.pack("<BH", 0, prop))
        k = r.u16()
        return PROP_NAMES.get(k, k), (r.i32() if k <= INT_PROPS_MAX else r.s())

    def set_property(self, prop, value):
        body = struct.pack("<BH", 0, prop) + (struct.pack("<i", int(value)) if prop <= INT_PROPS_MAX else gstr(str(value)))
        rid, _ = self.request(21, body)
        if rid != 2: raise RuntimeError(f"expected SuccessResponse, got msg {rid}")

    def issue_command(self, command, argument=0):
        rid, _ = self.request(22, struct.pack("<Hq", command, argument))
        if rid != 2: raise RuntimeError(f"expected SuccessResponse, got msg {rid}")

    def watch(self, seconds):
        """Prints every notification for `seconds` (switch patches, insert or remove the SD...)."""
        end = time.time() + seconds
        while time.time() < end:
            m = self.read_msg(min(0.5, max(end - time.time(), 0.01)))
            if m and m[0] >= 0x8000:
                print(time.strftime("%H:%M:%S"), decode_notification(*m), flush=True)

    # --- write requests ---
    def _expect_success(self, reply):
        rid, _ = reply
        if rid != 2: raise RuntimeError(f"expected SuccessResponse, got msg {rid}")

    def create(self, path, is_folder, overwrite=False):
        self._expect_success(self.request(7, struct.pack("<?", is_folder) + gstr(path) + struct.pack("<?", overwrite)))

    def move(self, src, dst, is_folder=False, keep_original=False, overwrite=False):
        self._expect_success(self.request(
            8, struct.pack("<?", is_folder) + gstr(src) + gstr(dst) + struct.pack("<??", keep_original, overwrite)))

    def delete(self, path, is_folder, recursive=False):
        # moveToTrash is always false: the pedal has no trash
        self._expect_success(self.request(9, struct.pack("<?", is_folder) + gstr(path) + struct.pack("<??", recursive, False)))

    def write_file(self, path, data, chunk=8158):
        # FileOpenRequest: access Write (=2), mode CreateOrTruncate (=0)
        rid, r = self.request(10, gstr(path) + bytes([2, 0]))
        handle = r.i64(); r.i64()
        try:
            for off in range(0, len(data), chunk):
                part = data[off:off + chunk]
                self._expect_success(self.request(14, struct.pack("<qi", handle, len(part)) + part, timeout=10))
        finally:
            self._expect_success(self.request(16, struct.pack("<q", handle)))


def decode_notification(mid, p):
    r = Reader(p)
    if mid == 0x8006:
        path = [r.u16() for _ in range(r.u8())]
        k = r.u16(); v = r.i32() if k <= INT_PROPS_MAX else r.s()
        return ("PropertyChanged", PROP_NAMES.get(k, k), v)
    return (hex(mid), p.hex())


if __name__ == "__main__":
    dev, cmd, *args = sys.argv[1:]
    port = Port(dev)
    try:
        time.sleep(0.3)
        while (m := port.read_msg(0.5)) is not None:  # drain the greeting notifications
            port.notifications.append(decode_notification(*m))
        if cmd == "info":
            out = dict(whoAmI=port.who_am_i(), properties=port.get_properties())
        elif cmd == "ls":
            files, dirs = port.folder_contents(args[0]); out = dict(files=files, dirs=dirs)
        elif cmd == "stat":
            out = port.entry_info(args[0], args[1] == "dir")
        elif cmd == "get":
            data = port.read_file(args[0])
            with open(args[1], "wb") as f: f.write(data)
            out = dict(bytes=len(data), saved=args[1])
        elif cmd == "getprop":
            name, value = port.get_property(int(args[0], 0)); out = dict(property=name, value=value)
        elif cmd == "setprop":
            prop = int(args[0], 0)
            before = port.get_property(prop)[1]
            port.set_property(prop, args[1])
            out = dict(property=PROP_NAMES.get(prop, prop), before=before, after=port.get_property(prop)[1])
        elif cmd == "command":
            port.issue_command(int(args[0], 0), int(args[1], 0) if len(args) > 1 else 0)
            out = dict(command=args[0], result="success")
        elif cmd == "watch":
            port.watch(float(args[0])); out = dict(watched=float(args[0]))
        elif cmd == "put":
            with open(args[0], "rb") as f: data = f.read()
            port.write_file(args[1], data); out = dict(bytes=len(data), written=args[1])
        elif cmd == "mkdir":
            port.create(args[0], True); out = dict(created=args[0])
        elif cmd == "mv":
            port.move(args[0], args[1], is_folder=args[0].endswith("/"), overwrite=True)
            out = dict(moved=args[0], to=args[1])
        elif cmd == "rm":
            port.delete(args[0], args[0].endswith("/"), recursive=args[0].endswith("/")); out = dict(deleted=args[0])
        else:
            raise SystemExit("commands: info | ls PATH | stat PATH file|dir | get PATH OUT"
                             " | put LOCAL PATH | mkdir PATH | mv SRC DST | rm PATH (trailing / = folder)"
                             " | getprop ID | setprop ID VALUE | command ID [ARG] | watch SECONDS")
        out["notifications"] = port.notifications
        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        port.close()
