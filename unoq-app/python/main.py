"""UNO Q Linux side: keyword spotting -> MCU over Bridge. No MQTT until after demo-v1."""
from arduino.app_utils import App, Bridge
from arduino.app_bricks.keyword_spotting import KeywordSpotting

KEYWORD = "hey_arduino"  # stock model label; rename when our model lands


def on_keyword():
    # Runs on the detection thread and audio is dropped meanwhile: keep it short.
    print(f"[kws] {KEYWORD}")
    Bridge.call("keyword_detected")


spotter = KeywordSpotting()  # default mic = first USB mic, confidence 0.8
spotter.on_detect(KEYWORD, on_keyword)

App.run()
