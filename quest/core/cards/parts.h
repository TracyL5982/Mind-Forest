// The parts a sheet is assembled from, each drawn as the card of its own kind draws it (sheet.js reads
// them from facts.js, list.js and table.js): figures in rows, a list's dot, and a ruled table.
#pragma once
#include <optional>
#include <string>
#include <vector>

#include "kind.h"

namespace cards {

// facts.cpp: `section.facts` as a facts card lays them out, in rows of 287 and 135 px.
int figuresHeight(const Json& section);
std::vector<std::string> figureWords(const Json& section);
void drawFigures(const Pen& pen, const Look& look, const Json& section, float x, float y, float column);
/// `.detail-figures`: each label beside its value, whole.
void listFigures(Sheet& sheet, const Json& section);

// list.cpp
/// `.list-dot`, 12 px square at (x, y) px.
void entryMark(const Pen& pen, float x, float y, const Look& look);
/// `.list.is-full`: every entry whole, each as the item's text writes it.
void listEntries(Sheet& sheet, const Item& item, const std::vector<std::string>& entries);

// table.cpp: `section.heads` and `section.rows` laid out by the table rule in `room` px.
/// How tall the shown rows stand under their heads, with the line that counts what is left out; nothing with no head.
std::optional<int> tableHeight(const Item& item, const Json& section, int room);
std::vector<std::string> tableWords(const Item& item, const Json& section, int room);
void drawTable(const Pen& pen, const Look& look, const Item& item, const Json& section, int room, float x, float y, float column);
/// `.detail-table`: every row and column.
void listTable(Sheet& sheet, const Json& section);

}  // namespace cards
