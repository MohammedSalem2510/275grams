# MQTT protocol

Broker: Mosquitto on the UNO Q, port 1883, reached as `<unoq-hostname>.local`.
All payloads are JSON. `<id>` is the node number (`1`, `2`).

| Topic | Direction | Retained | Payload |
|---|---|---|---|
| `nodes/<id>/status` | node → UNO Q | yes | `"online"` / `"offline"` (`offline` is the MQTT last will) |
| `nodes/<id>/data` | node → UNO Q | no | `{"ts": <millis>, "value": <float>}`, extend per sensor |
| `unoq/cmd/<id>` | UNO Q → node | no | `{"cmd": "<name>", "arg": <optional>}` |
| `unoq/event` | UNO Q → all | no | `{"keyword": "<label>", "score": <0-1>}` |

## Commands
| `cmd` | Effect |
|---|---|
| `ping` | node replies on `nodes/<id>/status` with `"online"` |
| _add yours here_ | |

To change this contract, edit this file in a `protocol/…` PR **before** touching any code.
