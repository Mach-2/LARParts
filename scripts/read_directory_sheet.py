import csv
import io
import json
import pathlib
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

BASE_DIR = pathlib.Path(__file__).resolve().parents[1]

SHEET_ID = "1IVvNgQLEdbiBRUj6CQwDl_PA8Eu6QHAmo9Ems1aIsB0"
GID = "901559789"  # Directory sheet
OUTPUT_FILE = BASE_DIR / "src/data/directory.json"
PHOTOS_DIR = BASE_DIR / "public/photos"
REMOVED_COLUMNS = {"Promotion", "b"}
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
            photo_paths[row_index] = f"photos/{filename}"

    return photo_paths


def read_directory_sheet():
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}"
    csv_text = download(url).decode("utf-8")

    reader = csv.DictReader(io.StringIO(csv_text))
    rows = []

    for row in reader:
        cleaned_row = {
            key: value
            for key, value in row.items()
            if key not in REMOVED_COLUMNS
        }
        cleaned_row["Kingdom"] = KINGDOM
        rows.append(cleaned_row)

    photo_paths = extract_photos(rows)
    for index, row in enumerate(rows):
        row["Photo"] = photo_paths.get(index, "")

    return rows


if __name__ == "__main__":
    rows = read_directory_sheet()
    with OUTPUT_FILE.open("w", encoding="utf-8") as file:
        json.dump(rows, file, indent=2, ensure_ascii=False)

    print(f"Wrote {len(rows)} rows to {OUTPUT_FILE}")
