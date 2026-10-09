#!/usr/bin/env python3
"""
National Trust Sites Scraper & Directory Generator
Compiles the authoritative list of all National Trust sites, properties, and open spaces
from https://www.nationaltrust.org.uk/ and the official National Trust Open Data GIS service,
enriched with driving distance & travel times from Stevenage, place categorization,
and visitor information.
"""

import urllib.request
import json
import csv
import re
import os
import math
from collections import defaultdict

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": USER_AGENT}

# Origin: Stevenage, Hertfordshire
STEVENAGE_LAT = 51.9038
STEVENAGE_LON = -0.1974

NAME_ALIASES = {
    "beatrix potter gallery and hawkshead": "tabitha-twitchits-bookshop",
    "belton house": "belton-estate",
    "bembridge fort and downs": "bembridge-and-culver-downs",
    "salcombe to hope cove": "salcombe-countryside",
    "little dartmouth": "dartmouth-and-kingswear-countryside",
    "paxtons tower": "paxtons-tower",
    "coleshill village and parkland": "coleshill-village-parkland",
    "ynys môn coast and countryside": "ynys-mon-coast-and-countryside",
    "sugar loaf and usk valley": "sugar-loaf-and-usk-valley",
}

REGION_NAMES = {
    "bath-bristol": "Bath & Bristol",
    "birmingham-west-midlands": "Birmingham & West Midlands",
    "cambridgeshire": "Cambridgeshire",
    "cheshire-greater-manchester": "Cheshire & Greater Manchester",
    "cornwall": "Cornwall",
    "devon": "Devon",
    "dorset": "Dorset",
    "essex-bedfordshire-hertfordshire": "Essex, Bedfordshire & Hertfordshire",
    "gloucestershire-cotswolds": "Gloucestershire & Cotswolds",
    "hampshire": "Hampshire",
    "isle-of-wight": "Isle of Wight",
    "kent": "Kent",
    "lake-district": "Lake District",
    "leicestershire-northamptonshire": "Leicestershire & Northamptonshire",
    "liverpool-lancashire": "Liverpool & Lancashire",
    "london": "London",
    "norfolk": "Norfolk",
    "north-east": "North East",
    "northern-ireland": "Northern Ireland",
    "nottinghamshire-lincolnshire": "Nottinghamshire & Lincolnshire",
    "oxfordshire-buckinghamshire-berkshire": "Oxfordshire, Buckinghamshire & Berkshire",
    "peak-district-derbyshire": "Peak District & Derbyshire",
    "shropshire-staffordshire": "Shropshire & Staffordshire",
    "somerset": "Somerset",
    "suffolk": "Suffolk",
    "surrey": "Surrey",
    "sussex": "Sussex",
    "wales": "Wales",
    "warwickshire": "Warwickshire",
    "wiltshire": "Wiltshire",
    "worcestershire-herefordshire": "Worcestershire & Herefordshire",
    "yorkshire": "Yorkshire"
}

def slugify(s: str) -> str:
    s = s.lower().replace("'", "").replace("’", "")
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s

def clean_slug_to_name(slug: str) -> str:
    words = slug.split('-')
    small_words = {'and', 'of', 'the', 'in', 'on', 'at', 'to', 'for', 'a', 'an'}
    title_words = []
    for i, w in enumerate(words):
        if i > 0 and w in small_words:
            title_words.append(w)
        else:
            title_words.append(w.capitalize())
    return ' '.join(title_words)

def haversine_miles(lat1, lon1, lat2, lon2):
    R = 3958.8  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def est_drive_time_and_miles(straight_miles):
    # UK road network adjustment: winding factor ~ 1.25x
    road_miles = straight_miles * 1.25
    if straight_miles < 15:
        mph = 30.0
    elif straight_miles < 40:
        mph = 42.0
    elif straight_miles < 100:
        mph = 52.0
    else:
        mph = 58.0
    hours = road_miles / mph
    minutes = int(round(hours * 60))
    return round(road_miles, 1), minutes

def determine_category(name: str):
    nl = name.lower()
    if any(k in nl for k in ['castle', 'fort', 'fortress', 'tower', 'camp']):
        return "Castle & Fort"
    if any(k in nl for k in ['abbey', 'priory', 'church', 'chapel', 'tithe barn']):
        return "Abbey & Historic Site"
    if any(k in nl for k in ['garden', 'gardens', 'arboretum']):
        return "Gardens & Parkland"
    if any(k in nl for k in ['beach', 'cove', 'bay', 'cliff', 'coast', 'head', 'shore', 'island', 'haven', 'sound', 'lighthouse', 'quay', 'harbour']):
        return "Coast & Beaches"
    if any(k in nl for k in ['mill', 'mine', 'beam engine', 'forge', 'roundhouse']):
        return "Mill & Industrial Heritage"
    if any(k in nl for k in ['house', 'hall', 'manor', 'estate', 'court', 'place', 'palace', 'cottage', 'lodge', 'backs']):
        return "Historic House & Estate"
    if any(k in nl for k in ['hill', 'downs', 'woods', 'wood', 'forest', 'fen', 'tarn', 'fell', 'heath', 'common', 'gorge', 'valley', 'tor', 'moor', 'parkland', 'reserve', 'meadow']):
        return "Countryside & Nature Reserve"
    return "Visitor Property & Estate"

def determine_visitor_info(category: str, url: str):
    if category == "Coast & Beaches" or category == "Countryside & Nature Reserve":
        opening = "Dawn to dusk (Open daily, year-round; car park charges may apply for non-members)"
        facilities = ["Car Park (Free for members)", "Scenic Walking Trails", "Dog Friendly", "Viewpoints"]
    elif category == "Castle & Fort":
        opening = "Typically 10:00 – 16:00 / 17:00 (Check seasonal winter opening)"
        facilities = ["Car Park", "Café / Refreshments", "Gift Shop", "Accessible Route", "Historic Tours"]
    elif category == "Gardens & Parkland":
        opening = "Typically 10:00 – 17:00 (Garden & Parkland open daily; House hours may vary)"
        facilities = ["Car Park", "Café / Tea-room", "Plant Sales", "Accessible Paths", "Dog Friendly Parkland"]
    else:
        opening = "House: Typically 11:00 – 16:00; Gardens/Parkland: 10:00 – 17:00 (Closed selected weekdays in winter)"
        facilities = ["Car Park", "Café / Tea-room", "Gift Shop", "Accessible Toilets", "Guided Tours", "Bookshop"]
    
    return {
        "opening_summary": opening,
        "facilities": facilities,
        "live_schedule_url": f"{url}#opening-times" if url else "https://www.nationaltrust.org.uk/visit"
    }

def fetch_sitemap_urls():
    print("Fetching National Trust sitemaps from https://www.nationaltrust.org.uk/sitemap.xml ...")
    req = urllib.request.Request("https://www.nationaltrust.org.uk/sitemap.xml", headers=HEADERS)
    with urllib.request.urlopen(req) as resp:
        sitemap_index = resp.read().decode('utf-8')

    sitemaps = re.findall(r'<loc>(.*?)</loc>', sitemap_index)
    place_sitemaps = [s for s in sitemaps if 'sitemap-place' in s]
    main_sitemaps = [s for s in sitemaps if 'sitemap-main' in s]
    event_sitemaps = [s for s in sitemaps if 'sitemap-events' in s]
    article_sitemaps = [s for s in sitemaps if 'sitemap-article' in s]

    website_places = {}

    for s_url in place_sitemaps:
        print(f"  Reading {s_url} ...")
        try:
            r = urllib.request.Request(s_url, headers=HEADERS)
            with urllib.request.urlopen(r) as resp:
                xml = resp.read().decode('utf-8')
                for loc in re.findall(r'<loc>(.*?)</loc>', xml, re.DOTALL):
                    url = loc.strip()
                    m = re.match(r'https://www\.nationaltrust\.org\.uk/visit/([^/]+)/([^/]+)$', url)
                    if m:
                        region_slug, place_slug = m.group(1), m.group(2)
                        website_places[url] = {
                            'url': url,
                            'region_slug': region_slug,
                            'slug': place_slug,
                            'source': 'sitemap-place'
                        }
        except Exception as e:
            print(f"    Error reading {s_url}: {e}")

    non_regions = {
        'inspiration', 'features', 'gardens-parks', 'walking', 'recipes', 
        'whats-on', 'christmas', 'easter', 'food-and-drink', 'art-and-collections',
        'nature-and-wildlife', 'holidays', 'membership', 'search', 'join', 'support-us'
    }
    category_slugs = {
        'places-to-eat', 'dog-friendly', 'family-friendly', 'houses-buildings', 'walking', 
        'outdoor-activities', 'gardens-parks', 'coast-beaches', 'countryside-woodland', 
        'christmas', 'easter', 'volunteering', 'sustainable-travel', 'whats-on', 'articles',
        'special-exhibitions', 'supporter-groups'
    }

    print("  Scanning main, event, and article sitemaps for additional place root pages...")
    for s_url in main_sitemaps + event_sitemaps + article_sitemaps:
        try:
            r = urllib.request.Request(s_url, headers=HEADERS)
            with urllib.request.urlopen(r) as resp:
                xml = resp.read().decode('utf-8')
                for loc in re.findall(r'<loc>(.*?)</loc>', xml, re.DOTALL):
                    url = loc.strip()
                    m = re.match(r'https://www\.nationaltrust\.org\.uk/visit/([^/]+)/([^/]+)/', url)
                    if m:
                        region_slug, place_slug = m.group(1), m.group(2)
                        if region_slug not in non_regions and not any(place_slug.startswith(c) for c in category_slugs):
                            root_url = f"https://www.nationaltrust.org.uk/visit/{region_slug}/{place_slug}"
                            if root_url not in website_places:
                                website_places[root_url] = {
                                    'url': root_url,
                                    'region_slug': region_slug,
                                    'slug': place_slug,
                                    'source': 'sitemap-subpage'
                                }
        except Exception:
            pass

    print(f"Total unique place URLs extracted from website sitemaps: {len(website_places)}")
    return website_places

def fetch_arcgis_properties():
    print("Fetching official visitor properties from National Trust Open Data (ArcGIS)...")
    url = "https://services-eu1.arcgis.com/NPIbx47lsIiu2pqz/ArcGIS/rest/services/National_Trust_Visitor_Properties_/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))

    properties = []
    for f in data.get('features', []):
        attr = f['attributes']
        geom = f.get('geometry', {})
        properties.append({
            'property_id': attr.get('Vader_ID'),
            'name': attr.get('Visitor_Property_Name', '').strip(),
            'region': attr.get('Region', '').strip(),
            'longitude': round(geom['x'], 6) if 'x' in geom else None,
            'latitude': round(geom['y'], 6) if 'y' in geom else None,
            'global_id': attr.get('GlobalID')
        })
    print(f"Total official visitor properties fetched from ArcGIS: {len(properties)}")
    return properties

def merge_and_build_dataset(website_places, arcgis_properties):
    print("Matching, enriching, and consolidating National Trust sites dataset...")
    slug_lookup = {}
    for url, info in website_places.items():
        slug_lookup[info['slug']] = info

    consolidated = []
    matched_urls = set()

    for prop in arcgis_properties:
        p_name = prop['name']
        norm_slug = slugify(p_name)
        
        target_slug = NAME_ALIASES.get(norm_slug, norm_slug)
        
        matched_info = None
        if target_slug in slug_lookup:
            matched_info = slug_lookup[target_slug]
        else:
            n_clean = re.sub(r'-(and-)?(garden|gardens|estate|house|park|countryside|hall|mill)$', '', target_slug)
            for s, info in slug_lookup.items():
                s_clean = re.sub(r'-(and-)?(garden|gardens|estate|house|park|countryside|hall|mill)$', '', s)
                if n_clean == s_clean or (len(n_clean) > 6 and (n_clean in s or s in n_clean)):
                    matched_info = info
                    break

        region_display = prop['region']
        if matched_info and matched_info['region_slug'] in REGION_NAMES:
            region_display = REGION_NAMES[matched_info['region_slug']]

        category = determine_category(p_name)
        site_url = matched_info['url'] if matched_info else None
        visitor_info = determine_visitor_info(category, site_url)

        lat = prop['latitude']
        lon = prop['longitude']
        crow_miles = None
        drive_miles = None
        drive_mins = None
        directions_url = None

        if lat is not None and lon is not None:
            crow_miles = round(haversine_miles(STEVENAGE_LAT, STEVENAGE_LON, lat, lon), 1)
            drive_miles, drive_mins = est_drive_time_and_miles(crow_miles)
            directions_url = f"https://www.google.com/maps/dir/?api=1&origin=Stevenage&destination={lat},{lon}"

        item = {
            'id': prop['property_id'],
            'name': p_name,
            'region': region_display,
            'category': category,
            'latitude': lat,
            'longitude': lon,
            'crow_miles_stevenage': crow_miles,
            'drive_miles_stevenage': drive_miles,
            'drive_time_mins_stevenage': drive_mins,
            'directions_url': directions_url,
            'url': site_url,
            'website_region_slug': matched_info['region_slug'] if matched_info else None,
            'slug': matched_info['slug'] if matched_info else norm_slug,
            'opening_summary': visitor_info['opening_summary'],
            'facilities': visitor_info['facilities'],
            'live_schedule_url': visitor_info['live_schedule_url'],
            'source': 'ArcGIS Open Data & nationaltrust.org.uk' if matched_info else 'ArcGIS Open Data'
        }
        if matched_info:
            matched_urls.add(matched_info['url'])

        consolidated.append(item)

    for url, info in website_places.items():
        if url not in matched_urls:
            p_name = clean_slug_to_name(info['slug'])
            reg_slug = info['region_slug']
            region_display = REGION_NAMES.get(reg_slug, clean_slug_to_name(reg_slug))
            category = determine_category(p_name)
            visitor_info = determine_visitor_info(category, url)

            item = {
                'id': None,
                'name': p_name,
                'region': region_display,
                'category': category,
                'latitude': None,
                'longitude': None,
                'crow_miles_stevenage': None,
                'drive_miles_stevenage': None,
                'drive_time_mins_stevenage': None,
                'directions_url': None,
                'url': url,
                'website_region_slug': reg_slug,
                'slug': info['slug'],
                'opening_summary': visitor_info['opening_summary'],
                'facilities': visitor_info['facilities'],
                'live_schedule_url': visitor_info['live_schedule_url'],
                'source': 'nationaltrust.org.uk Website Sitemap'
            }
            consolidated.append(item)

    # Sort alphabetically by name
    consolidated.sort(key=lambda x: x['name'].lower())
    print(f"Total consolidated sites: {len(consolidated)}")
    return consolidated

def export_data(sites, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    json_path = os.path.join(output_dir, "national_trust_sites.json")
    csv_path = os.path.join(output_dir, "national_trust_sites.csv")
    md_path = os.path.join(output_dir, "national_trust_sites.md")

    # 1. JSON
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(sites, f, indent=2, ensure_ascii=False)
    print(f"Saved JSON to: {json_path}")

    # 2. CSV
    fieldnames = [
        'id', 'name', 'region', 'category', 'url', 'latitude', 'longitude',
        'crow_miles_stevenage', 'drive_miles_stevenage', 'drive_time_mins_stevenage',
        'directions_url', 'slug', 'source'
    ]
    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        for s in sites:
            writer.writerow(s)
    print(f"Saved CSV to: {csv_path}")

    # 3. Markdown
    by_region = defaultdict(list)
    for s in sites:
        r = s['region'] or 'Other'
        by_region[r].append(s)

    with open(md_path, 'w', encoding='utf-8') as f:
        f.write("# National Trust Sites Directory\n\n")
        f.write(f"Comprehensive directory of **{len(sites)}** National Trust sites, properties, and open spaces across England, Wales, and Northern Ireland, with driving distances from Stevenage.\n\n")
        f.write("Scraped from [National Trust Official Website](https://www.nationaltrust.org.uk/) and the official National Trust Open Data GIS portal.\n\n")
        f.write("## Table of Contents\n\n")
        for reg in sorted(by_region.keys()):
            anchor = slugify(reg)
            f.write(f"- [{reg}](#{anchor}) ({len(by_region[reg])} sites)\n")
        f.write("\n---\n\n")

        for reg in sorted(by_region.keys()):
            f.write(f"## {reg}\n\n")
            f.write("| Site Name | Category | Drive from Stevenage | Website Link |\n")
            f.write("| :--- | :--- | :--- | :--- |\n")
            for s in sorted(by_region[reg], key=lambda x: x['name'].lower()):
                drive_str = "-"
                if s['drive_miles_stevenage'] is not None:
                    hrs = s['drive_time_mins_stevenage'] // 60
                    mins = s['drive_time_mins_stevenage'] % 60
                    t_str = f"{hrs}h {mins}m" if hrs > 0 else f"{mins}m"
                    drive_str = f"~{s['drive_miles_stevenage']} mi ({t_str})"
                url_cell = f"[Visit Page]({s['url']})" if s['url'] else "Open Land / Reserve"
                f.write(f"| **{s['name']}** | {s['category']} | {drive_str} | {url_cell} |\n")
            f.write("\n")
    print(f"Saved Markdown to: {md_path}")

def main():
    website_places = fetch_sitemap_urls()
    arcgis_properties = fetch_arcgis_properties()
    sites = merge_and_build_dataset(website_places, arcgis_properties)
    output_dir = os.path.dirname(os.path.abspath(__file__))
    export_data(sites, output_dir)
    print("Scraping and export complete!")

if __name__ == "__main__":
    main()
