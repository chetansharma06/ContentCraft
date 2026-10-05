import re
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any

from app.qc.structure import QCCheckResult

NUMBER_WITH_UNIT = re.compile(
    r"(?<!\w)(?P<number>\d+(?:[.,]\d+)?)(?:\s*)(?P<unit>%|°[CF]|[A-Za-zµ]+(?:/[A-Za-z]+)?)?",
    re.IGNORECASE,
)
UNIT_ALIASES = {
    "millimeter": "mm", "millimeters": "mm", "millimetre": "mm", "millimetres": "mm",
    "centimeter": "cm", "centimeters": "cm", "centimetre": "cm", "centimetres": "cm",
    "meter": "m", "meters": "m", "metre": "m", "metres": "m",
    "inch": "in", "inches": "in", "in.": "in",
    "foot": "ft", "feet": "ft", "pound": "lb", "pounds": "lb", "lbs": "lb",
    "gram": "g", "grams": "g", "kilogram": "kg", "kilograms": "kg",
    "milliliter": "ml", "milliliters": "ml", "millilitre": "ml", "millilitres": "ml",
    "liter": "l", "liters": "l", "litre": "l", "litres": "l",
    "ounce": "oz", "ounces": "oz", "watt": "w", "watts": "w",
    "volts": "v", "volt": "v", "kilowatt-hours": "kwh", "kilowatt-hour": "kwh",
    "degrees celsius": "°c", "celsius": "°c", "degrees fahrenheit": "°f",
    "fahrenheit": "°f", "°c": "°c", "°f": "°f",
    "ml": "ml", "kg": "kg", "mg": "mg", "cm": "cm", "mm": "mm",
    "km": "km", "m": "m", "l": "l", "g": "g", "oz": "oz", "lb": "lb",
    "ft": "ft", "in": "in", "w": "w", "kw": "kw", "kwh": "kwh", "v": "v",
    "%": "%",
}
UNIT_PATTERN = re.compile(
    r"(?<![a-z])(" + "|".join(
        re.escape(unit) for unit in sorted(UNIT_ALIASES, key=len, reverse=True)
    ) + r")(?![a-z])",
    re.IGNORECASE,
)


def _number_key(raw: str) -> Decimal | None:
    try:
        return Decimal(raw.replace(",", ".")).normalize()
    except InvalidOperation:
        return None


def _canonical_unit(raw: str | None) -> str | None:
    if not raw:
        return None
    normalized = raw.casefold().strip().rstrip(".")
    return UNIT_ALIASES.get(normalized, normalized)


def _unit_from_key(key: str) -> str | None:
    match = UNIT_PATTERN.search(key.replace("_", " ").casefold())
    return _canonical_unit(match.group(1)) if match else None


def _allowed_specifications(
    product: Any,
) -> tuple[set[Decimal], dict[Decimal, set[str]], set[str]]:
    allowed_numbers: set[Decimal] = set()
    allowed_units: dict[Decimal, set[str]] = {}
    all_units: set[str] = set()

    def add_value(value: Any, key_path: str) -> None:
        if isinstance(value, bool) or value is None:
            return
        if isinstance(value, (int, float, Decimal)):
            entries = [(str(value), None)]
        elif isinstance(value, str):
            entries = [
                (match.group("number"), match.group("unit"))
                for match in NUMBER_WITH_UNIT.finditer(value)
            ]
        elif isinstance(value, Mapping):
            for key, nested in value.items():
                add_value(nested, f"{key_path} {key}")
            return
        elif isinstance(value, (list, tuple)):
            for nested in value:
                add_value(nested, key_path)
            return
        else:
            return

        for raw_number, raw_unit in entries:
            number = _number_key(raw_number)
            if number is None:
                continue
            allowed_numbers.add(number)
            unit = _canonical_unit(raw_unit) or _unit_from_key(key_path)
            if unit:
                allowed_units.setdefault(number, set()).add(unit)
                all_units.add(unit)

    price = getattr(product, "price", None)
    add_value(price, "price")
    specifications = getattr(product, "specifications", {})
    add_value(specifications, "")
    add_value(getattr(product, "description", ""), "description")
    return allowed_numbers, allowed_units, all_units


def check_product_facts(text: str, product: Any) -> QCCheckResult:
    allowed_numbers, allowed_units, all_units = _allowed_specifications(product)
    issues: list[str] = []
    checked: list[dict[str, str | bool]] = []

    for match in NUMBER_WITH_UNIT.finditer(text):
        raw_number = match.group("number")
        number = _number_key(raw_number)
        if number is None:
            continue
        raw_unit = match.group("unit")
        unit = _canonical_unit(raw_unit)
        supported_number = number in allowed_numbers
        checked.append({"number": raw_number, "unit": raw_unit or "", "supported": supported_number})
        if not supported_number:
            issues.append(f"Number {raw_number} is not supported by product facts")
            if unit and all_units and unit not in all_units:
                issues.append(
                    f"Unit {raw_unit} does not match product facts; "
                    f"supported units: {', '.join(sorted(all_units))}"
                )
            continue
        if unit:
            expected_units = allowed_units.get(number, set())
            if unit not in expected_units:
                expected = ", ".join(sorted(expected_units)) or "no unit specified"
                issues.append(
                    f"Unit {raw_unit} does not match product facts for {raw_number} ({expected})"
                )

    return QCCheckResult(
        "factcheck",
        not issues,
        100.0 if not issues else 0.0,
        issues,
        details={"numbers_checked": checked},
    )