import csv
import io
import json
import pathlib
import re
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile

BASE_DIR = pathlib.Path(__file__).resolve().parents[1]

SHEET_ID = "1IVvNgQLEdbiBRUj6CQwDl_PA8Eu6QHAmo9Ems1aIsB0"
GID = "901559789"  # Directory sheet
OUTPUT_FILE = BASE_DIR / "src/data/directory.json"
PHOTOS_DIR = BASE_DIR / "public/photos"
SKILL_COLUMNS = ("Garber Arts", "Dragon Arts", "Owl Arts")
KINGDOM = "Northern Lights"
NAMESPACES = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}


def download(url):
    with urllib.request.urlopen(url) as response:
        return response.read()


def make_player_filename(first_name, last_name):
    full_name = " ".join(part for part in [first_name, last_name] if part).strip()
    safe_name = re.sub(r'[^A-Za-z0-9._ -]+', "", full_name).strip()
    safe_name = safe_name.replace(" ", "_")
    return safe_name or "unknown_player"


def extract_photos(rows):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"
    workbook_bytes = download(url)
    photo_paths = {}

    PHOTOS_DIR.mkdir(exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(workbook_bytes)) as workbook:
        drawing_root = ET.fromstring(workbook.read("xl/drawings/drawing2.xml"))
        rels_root = ET.fromstring(workbook.read("xl/drawings/_rels/drawing2.xml.rels"))
        rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_root}

        for anchor in drawing_root:
            row_marker = anchor.find("xdr:from", NAMESPACES)
            picture = anchor.find("xdr:pic", NAMESPACES)
            if row_marker is None or picture is None:
                continue

            row_index = int(row_marker.find("xdr:row", NAMESPACES).text) - 1
            if row_index < 0 or row_index >= len(rows):
                continue

            blip = picture.find(".//a:blip", NAMESPACES)
            image_target = rel_map[blip.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"]]
            image_path = f"xl/{image_target.removeprefix('../')}"
            extension = pathlib.Path(image_path).suffix or ".jpg"

            row = rows[row_index]
            filename = make_player_filename(row["First Name"], row["Last Name"]) + extension
            output_path = PHOTOS_DIR / filename
            output_path.write_bytes(workbook.read(image_path))
            photo_paths[row_index] = f"/photos/{filename}"

    return photo_paths


def split_values(value):
    return [item.strip() for item in value.split(",") if item.strip()]


def merge_skills(row):
    skills = []

    for column in SKILL_COLUMNS:
        for skill in split_values(row.get(column, "")):
            if skill not in skills:
                skills.append(skill)

    return skills


def load_existing_ids():
    if not OUTPUT_FILE.exists():
        return {}

    with OUTPUT_FILE.open(encoding="utf-8") as file:
        profiles = json.load(file)

    return {
        (profile["firstName"].casefold(), profile.get("lastName", "").casefold()):
            profile["id"]
        for profile in profiles
    }


def get_artist_id(row, existing_ids):
    name_key = (
        row.get("First Name", "").strip().casefold(),
        row.get("Last Name", "").strip().casefold(),
    )
    return existing_ids.get(name_key, f"artist-{uuid.uuid4().hex[:12]}")


def normalize_member_since(value):
    value = value.strip()
    return value if value.casefold().startswith("player since ") else None


def normalize_contact(value):
    value = value.strip()
    if ":" not in value:
        return {}

    label, handle = (part.strip() for part in value.split(":", 1))
    contact_field = {
        "discord": "discord",
        "insta": "instagram",
        "instagram": "instagram",
        "tiktok": "tiktok",
    }.get(label.casefold())
    return {contact_field: handle} if contact_field and handle else {}


def normalize_profile(row, existing_ids):
    first_name = row.get("First Name", "").strip()
    last_name = row.get("Last Name", "").strip()
    legacy_member_since = row.get("Member Since", "").strip()
    profile = {
        "id": get_artist_id(row, existing_ids),
        "firstName": first_name,
        "displayName": " ".join(filter(None, (first_name, last_name))),
        "kingdom": KINGDOM,
        "awards": split_values(row.get("Awards", "")),
        "skills": merge_skills(row),
        "contact": normalize_contact(legacy_member_since),
    }

    optional_values = {
        "lastName": last_name,
        "homePark": row.get("Home Park", "").strip(),
        "memberSince": normalize_member_since(legacy_member_since),
    }
    for field, value in optional_values.items():
        if value:
            profile[field] = value

    # Preserve unclassified legacy text instead of silently discarding it.
    if legacy_member_since and not profile["contact"] and "memberSince" not in profile:
        profile["biography"] = legacy_member_since

    return profile


def read_directory_sheet():
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}"
    csv_text = download(url).decode("utf-8")

    reader = csv.DictReader(io.StringIO(csv_text))
    source_rows = list(reader)
    existing_ids = load_existing_ids()
    profiles = [
        normalize_profile(row, existing_ids)
        for row in source_rows
    ]

    photo_paths = extract_photos(source_rows)
    for index, profile in enumerate(profiles):
        if photo_url := photo_paths.get(index):
            profile["photoUrl"] = photo_url

    return profiles


if __name__ == "__main__":
    rows = read_directory_sheet()
    with OUTPUT_FILE.open("w", encoding="utf-8") as file:
        json.dump(rows, file, indent=2, ensure_ascii=False)

    print(f"Wrote {len(rows)} rows to {OUTPUT_FILE}")
