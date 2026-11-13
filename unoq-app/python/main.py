"""UNO Q Linux side: keyword spotting -> MCU (Bridge) + ESP32 nodes (MQTT)."""
import json
import time

import paho.mqtt.client as mqtt
from arduino.app_utils import App, Bridge
from arduino.app_bricks.keyword_spotting import KeywordSpotting

BROKER = "localhost"  # Mosquitto runs on the UNO Q itself
NODE_IDS = (1, 2)

node_status = {i: "unknown" for i in NODE_IDS}
latest_data = {}


# ---------- MQTT ----------
def on_connect(client, userdata, flags, reason_code, properties=None):
    client.subscribe("nodes/+/status")
    client.subscribe("nodes/+/data")
    print(f"[mqtt] connected ({reason_code})")


def on_message(client, userdata, msg):
    _, node, kind = msg.topic.split("/")
    payload = msg.payload.decode()
    if kind == "status":
        node_status[int(node)] = payload.strip('"')
        print(f"[node {node}] {node_status[int(node)]}")
    elif kind == "data":
        latest_data[int(node)] = json.loads(payload)


mqttc = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqttc.on_connect = on_connect
mqttc.on_message = on_message
mqttc.connect(BROKER, 1883)
mqttc.loop_start()  # background thread; App.run() keeps the main thread


def send_cmd(node_id: int, cmd: str, arg=None):
    mqttc.publish(f"unoq/cmd/{node_id}", json.dumps({"cmd": cmd, "arg": arg}))


# ---------- Voice ----------
def on_keyword():
    print("[kws] keyword detected")
    mqttc.publish("unoq/event", json.dumps({"keyword": "hey_arduino", "ts": time.time()}))
    Bridge.call("keyword_detected")  # runs on the MCU
    for node in NODE_IDS:
        if node_status[node] == "online":
            send_cmd(node, "ping")


spotter = KeywordSpotting()
spotter.on_detect("hey_arduino", on_keyword)  # rename to your trained label

App.run()
