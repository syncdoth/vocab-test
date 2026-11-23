"""Export the English quiz fields from the two VZIP PDFs using Poppler."""

import argparse
import json
from pathlib import Path
import re
import subprocess
from xml.etree import ElementTree


def read_book(pdf, book, count):
    xml = subprocess.check_output(["pdftotext", "-bbox-layout", str(pdf), "-"])
    entries = []
    for page in ElementTree.fromstring(xml).findall(".//{*}page"):
        words = [
            (float(word.attrib["yMin"]), float(word.attrib["xMin"]), word.text or "")
            for word in page.findall(".//{*}word")
        ]
        header_y, _, _ = next(word for word in words if word[2] == "Definition")
        columns = {
            label: next(x for y, x, value in words if y == header_y and value == label)
            for label in ("Word", "POS", "Definition", "Sample")
        }
        word_x, pos_x, definition_x, sample_x = columns.values()
        rows = sorted(
            (y, int(value))
            for y, x, value in words
            if y > header_y and x < word_x - 0.1 and value.isascii() and value.isdigit()
        )

        for index, (top, number) in enumerate(rows):
            bottom = rows[index + 1][0] if index + 1 < len(rows) else float("inf")
            row = sorted(word for word in words if top <= word[0] < bottom)

            def cell(left, right):
                return " ".join(value for _, x, value in row if left - 0.1 <= x < right - 0.1)

            term = cell(word_x, pos_x)
            part_of_speech = cell(pos_x, definition_x)
            definition, separator, _ = cell(definition_x, sample_x).partition("[KR]")
            definition = definition.strip()

            if (
                number != len(entries) + 1
                or not term or not part_of_speech or not definition or not separator
                or re.search(r"[\uac00-\ud7af\ufffd]", term + part_of_speech + definition)
            ):
                raise ValueError(f"Unexpected row {book} #{number}: {term!r}, {part_of_speech!r}, {definition!r}")

            entries.append({
                "id": f"{book}-{number}",
                "word": term,
                "pos": part_of_speech,
                "definition": definition,
            })

    if len(entries) != count:
        raise ValueError(f"{book}: expected {count} entries, found {len(entries)}")
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ascent_pdf", type=Path)
    parser.add_argument("summit_pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path("site/data/vocabulary.json"))
    args = parser.parse_args()

    entries = read_book(args.ascent_pdf, "ascent", 1600) + read_book(args.summit_pdf, "summit", 800)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Exported {len(entries)} entries to {args.output}")


if __name__ == "__main__":
    main()
