# Waste Analytics Dashboard

Static web app (no build step). Serve the folder (e.g. `python3 -m http.server`) and open `index.html`.

- **Upload waste report**: xlsx with a write-off records sheet (`Wastage Value`, `Write-off storage`, `Category`…) and a `Net Sales` sheet (`Store`, `Write-off storage`, `Net Sales`). **Download template** gives the exact layout.
- **Area manager mapping**: built in (from the AM/ROM file); replace via *Area manager mapping → Upload*. Stores are assigned by store code (B##).
- Thresholds: high > 1.4 %, unusually low < 1.0 % of net sales (editable).
