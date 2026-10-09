# National Trust Sites Directory & Scraper

This repository contains the complete directory of **663 National Trust sites, properties, and open spaces** across England, Wales, and Northern Ireland, scraped directly from [nationaltrust.org.uk](https://www.nationaltrust.org.uk/) and the official National Trust Open Data GIS service.

## Generated Datasets

| File | Format | Description |
| :--- | :---: | :--- |
| [`national_trust_sites.csv`](file:///Users/mns/Desktop/projects/NT/national_trust_sites.csv) | CSV | Spreadsheet-ready dataset with IDs, names, regions, URLs, and GPS coordinates |
| [`national_trust_sites.json`](file:///Users/mns/Desktop/projects/NT/national_trust_sites.json) | JSON | Complete structured JSON dataset |
| [`national_trust_sites.md`](file:///Users/mns/Desktop/projects/NT/national_trust_sites.md) | Markdown | Human-readable directory organized by geographic region with direct links |

## Data Fields

Each site entry contains:
- `id`: National Trust Official Property ID (Vader ID)
- `name`: Official site or property name
- `region`: Geographic region (e.g. *Bath & Bristol*, *Cornwall*, *Lake District*, *Wales*, *Yorkshire*)
- `url`: Direct visit page URL on `https://www.nationaltrust.org.uk/visit/...`
- `latitude`: WGS84 GPS Latitude
- `longitude`: WGS84 GPS Longitude
- `slug`: Canonical URL slug
- `source`: Attribution (`ArcGIS Open Data & nationaltrust.org.uk` or `nationaltrust.org.uk Website Sitemap`)

## How to Run the Scraper

To re-fetch the latest data from the National Trust website and GIS portal:

```bash
python3 scrape_national_trust.py
```
