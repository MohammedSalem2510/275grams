# Protocol

The only contract is HTTP between the station and the laptop backend: **[http.md](http.md)**.

To change it, edit `http.md` in its own `protocol:` commit **before** touching any code.

The MQTT contract for the Atech ESP32 nodes was dropped on 14 Nov 2026, together with the nodes. Nothing on the station uses MQTT. Station online/offline comes from window uploads (see `/api/stations`). It's in git history (before `protocol: drop MQTT contract`) if satellite nodes come back.
