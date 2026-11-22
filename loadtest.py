#!/usr/bin/env python3
"""Stress test: many users register, trade, cancel and read data while browsers stream live events.
Usage:  python3 tools/loadtest.py --port 8080 --seconds 10 --users 8
Prints a summary; any 5xx answer or dropped connection is reported as an error."""
import argparse, json, random, socket, threading, time, urllib.request, urllib.error

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8080)
ap.add_argument("--seconds", type=int, default=10)
ap.add_argument("--users", type=int, default=8)
ap.add_argument("--streams", type=int, default=4)
a = ap.parse_args()
BASE = f"http://localhost:{a.port}"
SYMS = ["AAPL", "MSFT", "TSLA", "GOOG", "AMZN", "NVDA"]
BASEP = {"AAPL": 151, "MSFT": 412, "TSLA": 248, "GOOG": 171, "AMZN": 185, "NVDA": 120}
lock = threading.Lock()
codes, errors, events = {}, [], {"n": 0}

def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            code, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, raw = e.code, e.read()
    except Exception as e:
        with lock: errors.append(f"{method} {path}: {e}")
        return 0, None
    with lock:
        codes[code] = codes.get(code, 0) + 1
        if code >= 500: errors.append(f"{method} {path}: HTTP {code}")
    try: return code, json.loads(raw or b"null")
    except Exception: return code, None

def trader(i, stop):
    code, r = call("POST", "/register", {"username": f"load{i}_{random.randint(0, 99999)}", "password": "password1"})
    if code != 200: return
    tok, mine = r["token"], []
    while not stop.is_set():
        s = random.choice(SYMS); p = BASEP[s] * (1 + random.uniform(-0.004, 0.004)); act = random.random()
        if act < 0.35:
            c, o = call("POST", "/order", {"symbol": s, "side": random.choice(["BUY", "SELL"]), "price": round(p, 2), "qty": random.randint(1, 20)}, tok)
            if c == 200 and o["status"] != "FILLED": mine.append(o["order_id"])
        elif act < 0.45:
            call("POST", "/order", {"symbol": s, "side": random.choice(["BUY", "SELL"]), "orderType": "MARKET", "qty": random.randint(1, 10)}, tok)
        elif act < 0.60 and mine:
            call("DELETE", f"/order/{mine.pop(random.randrange(len(mine)))}", None, tok)
        else:
            call("GET", random.choice([f"/book/{s}", "/quotes", "/orders", "/portfolio", "/trades", "/receipts", "/metrics"]), None, tok)

def streamer(stop, tok):
    while not stop.is_set():
        try:
            sk = socket.create_connection(("localhost", a.port), timeout=5)
            sk.sendall(f"GET /stream?symbol={random.choice(SYMS)}&token={tok} HTTP/1.1\r\nHost: x\r\n\r\n".encode())
            end = time.time() + random.uniform(0.5, 2.5)
            while time.time() < end and not stop.is_set():
                sk.settimeout(1)
                try:
                    chunk = sk.recv(65536)
                    if not chunk: break
                    with lock: events["n"] += chunk.count(b"data:")
                except socket.timeout: pass
            sk.close()                       # abrupt disconnect, like closing a browser tab
        except Exception as e:
            with lock: errors.append(f"stream: {e}")

c, r = call("POST", "/register", {"username": f"streamtok{random.randint(0, 999999)}", "password": "password1"})
tok = r["token"]
stop = threading.Event()
ts = [threading.Thread(target=trader, args=(i, stop)) for i in range(a.users)] + [threading.Thread(target=streamer, args=(stop, tok)) for _ in range(a.streams)]
for t in ts: t.start()
time.sleep(a.seconds); stop.set()
for t in ts: t.join()
print("requests by status:", dict(sorted(codes.items())))
print("stream events received:", events["n"])
print("5xx / connection errors:", len(errors))
for e in errors[:5]: print("  ", e)
print("m:", call("GET", "/metrics")[1])
