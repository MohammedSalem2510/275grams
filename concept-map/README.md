# Chirp bird activity map

Open `index.html` to explore the sample map. Choose a bird and period, toggle the heatmap, and select a numbered station. The four themes work in both map modes.

## Connect Google Maps

1. In Google Cloud, enable billing and the Maps JavaScript API.
2. Create a browser API key. Restrict it to the Maps JavaScript API and to the website origins where Chirp runs.
3. Paste the key into `maps-config.js` locally. Do not commit the populated file.
4. Serve this folder over HTTP (for example, run `python -m http.server 8766 --bind 127.0.0.1` from this folder) and open `http://127.0.0.1:8766/`. Include the matching local origin in your key restrictions.

With a valid key, Google Maps shows the illustrative stations near Nuuksio, Finland. The sample map remains available when the key is blank or Maps fails to load. All bird counts and locations are illustrative. Colours use detections per listening hour; no listening time is shown as no data. The heat overlay is a visual guide around stations, not measured coverage.

Run the calculation and data tests with `node --test model.test.cjs`.
