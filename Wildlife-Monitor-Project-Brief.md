# Junction 2026 wildlife monitoring handoff

Ryan's team is entering the Arduino Make Europe Green through Edge AI challenge. Work in the existing 275grams checkout. Read README.md and the current unoq-app, atech-node, protocol, hardware and demo files before editing. The team already has a scaffold.

## Product
Fixed listening stations in parks or forests. Scientists search a species and date range on a website, compare coloured station pins, inspect trends and replay timestamped evidence. Record station ID, time, species, raw model score and clip reference. Track monitored minutes, including quiet periods, so activity can be compared per listening hour. Detections can repeat for the same animal. For Finnish species use station coordinates and season as a preference and keep unexpected strong matches reviewable.

## Hardware and scope
Start with one Arduino UNO Q running local inference on its Debian side. The boxed Arduino USB camera has a microphone. Test a saved file first, then try live audio with the camera on a powered USB-C hub. Two Atech boards are optional later as fixed sensor nodes sending tagged clips over a shared 2.4 GHz network. One station gives one real pin. Label any illustrative multi-site or historical data.

## Verified progress
BirdNET V3.0 ran locally in Chrome on the Windows laptop. Its two-minute sample took 8.7 seconds and returned 73 detections across eight predicted species at the default 15% threshold. This verifies laptop inference only. The UNO Q showed its boot heartbeat and Ryan began Arduino App Lab setup. Board shell access, Python version, runtime compatibility, inference speed and microphone capture are still unverified.

## Resume here
Check the current repo's model integration first. Establish a shell on the UNO Q and verify board architecture, Python and available resources. Run one known bird recording through BirdNET locally on the board and report the predicted species, score and timing. Then test a second species and room noise before live microphone capture. Ryan wants hands-on execution and one physical instruction at a time when his input is needed.
