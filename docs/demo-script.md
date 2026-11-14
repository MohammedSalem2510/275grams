# Demo script: Chirp

**Pitch in one line:** low-power stations that tell ecologists where species are thriving or declining, without shipping hours of audio (or anyone's voice) to the cloud.

## Before going on stage

- [ ] Laptop backend running from the repo root: `python -m uvicorn dashboard.server:app --host 0.0.0.0 --port 8000`, with the dashboard open at http://127.0.0.1:8000/.
- [ ] Synthetic data seeded: `python -m dashboard.seed_simulated` (sim-2 and sim-3 show as **simulated**).
- [ ] The board's `server_url.txt` matches the laptop's current IP. **chirp-1 shows as online** on the map.
- [ ] Knob at **100 %** (press it): the bottom row of the LED matrix is fully lit.
- [ ] The phone has the reference calls ready (Great Tit, Willow Tit, Goldcrest), with the volume at maximum.
- [ ] Station in its printed enclosure, with the camera facing where the phone will be (about 30 cm).

## The demo

1. **The problem (one sentence).** "Ecologists can't tell where species are declining in time to act, because surveys are rare, manual and patchy."

2. **A live detection on the device.** Play a Great Tit from the phone at about 30 cm from the station.
   - The LED matrix shows the "heard it" glyph and the Buzzer chirps.
   - Say: "That was identified *on this board*, by BirdNET running on the UNO Q. No audio went anywhere to decide that."

3. **It reaches the map.** On the dashboard, click **chirp-1**. The detection appears with its time and score.
   - Press **play** on the clip. "Every detection keeps its 3 s of evidence, so a person can check the model. Confidence is not accuracy."

4. **Privacy.** Talk near the station.
   - Nothing appears. "Speech is never stored or uploaded: windows where speech is the top label are thrown away on the device."

5. **Honest numbers.** Point to the station's rate on the map.
   - "The metric is detections per *listening hour*. A station that hasn't listened shows **no data**, never zero birds. Turning the Knob down saves power, and the rate stays correct because we only count time actually analysed."

6. **The early warning (synthetic data, say so).** Click **sim-5** (Espoo Central Park) and show the Willow Tit decline in its early-warning panel. Willow Tit lives in Finland all year, so this isn't migration.
   - "This is clearly labelled synthetic data. The rule compares the last 2 weeks with the 6 before, needs enough listening, and passes a significance test. It flags a *change in detected activity worth investigating*, not a confirmed population loss."

7. **Offline handling.** Unplug the station's power.
   - Within 30 s, chirp-1 turns **offline**, and its past detections are still there.

8. **Why the edge (closing).** "No streaming hours of audio, no voices in the cloud. The data exports as Darwin Core, ready for GBIF and Laji.fi."
   - **Next:** cheap satellite nodes around each UNO Q, and seasonal baselines from real multi-year data.

## If a question comes up

- **How accurate is it?** "In our controlled tests a phone speaker at 30 cm gave scores of 0.8–0.99 on the right species. That's a controlled test, not a field accuracy figure." Report what was actually measured, nothing more.
- **Why did it say Power tools or Brown Rock Chat?** Labels that aren't Finnish species, or aren't birds, are logged as `unlisted` and never counted. That's the filter doing its job.
- **Does it count birds?** No. It counts detections (distinct species-minutes), not individual animals.

## Fallbacks

- **No detection from the phone call:** move closer (about 20 cm), check that the Knob is at 100 %, and play a different species.
- **chirp-1 shows offline:** the laptop IP has probably changed. Update `server_url.txt` on the board and restart the app (see README).
- **The live demo fails completely:** roll the board back to `demo-v2` and play the recorded backup walkthrough.
- **Venue Wi-Fi fails:** switch the board and the laptop to the backup phone hotspot (same SSID and password).
