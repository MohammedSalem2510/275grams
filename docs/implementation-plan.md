# Chirp hackathon roadmap: real audio to map

This document records the proposed implementation plan. It is not a record of completed implementation or hardware validation. Times below are relative to the start of the build.

## Goal and working assumptions

Build a live demonstration in **24 hours**, then use any remaining time up to 48 hours for expansion and rehearsal.

The core demonstration must show:

**Microphone → species prediction on UNO Q → laptop database → station marker → playable evidence.**

Hardware is currently unverified. The existing repository provides MQTT scaffolding, not a working wildlife detector. A laptop may host the website and database; species inference stays on the UNO Q.

## Team responsibilities

These are proposed roles; swap people to match individual strengths while retaining one owner per workstream.

| Person | Primary responsibility | Deliverable |
|---|---|---|
| Mechatronic engineer 1 | UNO Q integration and inference | Local audio classification producing detection events |
| EEE engineer | Microphones, power and remote-node networking | Verified audio capture, wiring notes and reliable connectivity |
| Computer scientist | Backend, storage and dashboard integration | Detection ingestion, queries and evidence playback |
| Mechatronic engineer 2 | Map interface, test recordings and demo validation | Station map, filters, test results and demonstration script |

The UNO Q owner controls board deployments. Commit straight to `main` (see CLAUDE.md for the rules).

## Milestones and checkpoints

### Hours 0–4: prove feasibility

- Confirm UNO Q access, power, microphone availability and LAN connectivity.
- Record and replay microphone audio. Inspect the Atech microphone interface before treating it as a remote audio source.
- Test a pretrained bird classifier on the UNO Q using a known recording.
- Measure inference time and memory use.
- Choose three bird species with labelled reference recordings that the model supports.
- Start the dashboard in parallel using clearly labelled fixtures.

**Pass condition:** usable audio and at least one successful species prediction on the UNO Q.

**Fallback:** if Atech audio is unsuitable, use a verified USB microphone at the UNO Q for the core demo. If inference cannot run on the board, mark edge inference as blocked; recorded results may demonstrate the interface but must not be presented as live inference.

### Hours 4–10: establish one complete data path

- Replace the voice-keyword demonstration path with bird-audio classification.
- Capture non-overlapping audio windows using the model’s required format.
- Give every analysed window a unique ID and preserve its station and capture time.
- Upload predictions and their audio evidence to the laptop.
- Store records in SQLite and clips on disk.
- Display one configured station on the map and its latest detections.

**Pass condition:** a newly captured call appears on the map and its evidence plays in the browser.

### Hours 10–16: make the core demo usable

- Add species and date filters.
- Add station details showing timestamps, model confidence and audio playback.
- Show online/offline status and explicit empty-result states.
- Record successfully analysed listening duration independently of detections.
- Prevent retried uploads from creating duplicate records.
- Clearly distinguish live records from demonstration fixtures.

**Pass condition:** a user can find a species, select its station and review the underlying recording.

### Hours 16–24: stabilise and freeze the core

- Test the three selected species alongside speech, silence and background noise.
- Record observed correct predictions, missed calls and false positives.
- Test node disconnection, application restart and upload retries.
- Confirm clips and detections remain available after restarting the backend.
- Rehearse the complete demo three times.
- Tag the working build and prepare a labelled recorded walkthrough as backup.

**Pass condition:** three successful rehearsals with no lost or duplicated demonstration events.

### Hours 24–48, if available: expand in priority order

1. Add a second real audio station only if its microphone and transport pass the initial feasibility checks.
2. Add station colours based on detections per analysed listening hour; show unsampled areas and no-data stations explicitly.
3. Add on-demand camera streaming only if it does not disrupt audio inference.
4. Add trend charts using explicitly labelled historical or synthetic data.
5. Reserve the final four hours for integration, presentation and rehearsal rather than new features.

## Implementation decisions and interfaces

- **UNO Q:** Python audio capture and local model inference; benchmark BirdNET first. Do not train a new model during the core build.
- **Laptop:** Python FastAPI, SQLite and local evidence files; a simple HTML/JavaScript dashboard with Leaflet.
- **Map:** fixed station coordinates and selectable markers. Keep a local park image fallback so the demonstration does not depend on online map tiles.
- **Transport:** retain MQTT for node status/control. Use HTTP uploads for audio evidence and detection metadata.
- **Minimum records:** station ID/location; recording ID/capture time/duration; species prediction/confidence/model version; evidence reference; analysed listening intervals.
- **Minimum API:** upload a recording and its predictions; list stations; query detections by station/species/time; retrieve evidence.
- **Detection definition:** one accepted species prediction per analysed window. Label displayed totals as detection windows, not individual animals.
- **Recovery:** buffer pending uploads locally and retry using the same recording ID.
- **Deployment:** laptop and UNO Q share a LAN; no public hosting is required for the core demonstration.

## Audio quality (open problem: "audio needs to be cleaned up")

First, find out what "inaccurate" means, because each symptom has a different fix: wrong species, missed calls, or false detections in silence or noise. Then work through these steps in order and re-test after each one, using the same reference clips at the same distance.

1. **Fix the input before processing it.** On the board, run `alsamixer -c Camera`, press F4 for capture, and set the level just below clipping. Turn off automatic gain if the camera has it. In demos, play calls from 0.5–1 m away, facing the camera.
2. **Add a high-pass filter at about 150 Hz** in `bird_audio.predict()`. It removes hum from fans, air conditioning and mains power, and almost no birdsong is that low. This is cheap and safe.
3. **Don't apply heavy spectral noise reduction.** BirdNET was trained on noisy field recordings, and the artefacts denoising leaves usually make accuracy worse, not better.
4. **Overlap the windows.** Analyse a 3 s window every 1.5 s so a call that falls across two windows isn't split. Do this only if `inference_s` stays well under 1.5 s. Count only the analysed listening time.
5. **Use the location filter.** Accept only species expected in Finland (`FINNISH_SPECIES` in `main.py`, or BirdNET's location/week metadata model), and log unexpected strong matches for review.
6. **Tune the threshold on measurements, not by feel.** Record hits, misses and false positives for the three demo species, speech, silence and room noise at thresholds of 0.3, 0.5 and 0.7, then pick one value and write down why.

## Acceptance tests and scope boundaries

- A real microphone recording creates a new, correctly attributed map result.
- Evidence playback matches the selected detection.
- Species/date filters return known expected records.
- Re-uploading a recording does not increase its detection count.
- Disconnecting the device changes its status without deleting previous results.
- A period with no analysed audio displays **no data**, not zero wildlife activity.
- Inference speed supports the chosen recording schedule; if it cannot process continuously, use an explicit sampling schedule and count only analysed duration.
- Playback of reference bird calls through a speaker is labelled a controlled test, not a wild sighting.

Defer population-decline claims, year-long field validation, general wildlife identification, custom model training and weatherproof deployment. The hackathon result demonstrates a working monitoring pipeline and reviewable predictions.
